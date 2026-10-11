# ============================================================
# 旅程案の生成
#  1) Claude API（ANTHROPIC_API_KEY があるとき）：みんなの要望と候補地から
#     性格の異なる案を構造化出力（JSON）で作る
#  2) ルールベース（キー未設定・API失敗時）：要望のキーワードと雰囲気チップから
#     候補地を採点し、性格の違う案を機械的に組む
# どちらも同じ形の dict を返すので、フロントは出どころを気にしなくてよい。
# ============================================================
import math
import os
import re
from collections import Counter
from typing import Optional

from pydantic import BaseModel

MODEL = "claude-opus-5"

# 参加者フォームの雰囲気チップ（share.js と同じ語彙）
VIBES = ["グルメ", "絶景・自然", "歴史・文化", "のんびり", "アクティブ",
         "ショッピング", "温泉", "夜景・夜遊び", "写真映え", "子連れ・家族"]
SIGHT_VIBES = {"絶景・自然", "歴史・文化", "写真映え", "温泉", "夜景・夜遊び", "ショッピング", "子連れ・家族"}


def _load_dotenv() -> None:
    """server/.env があれば環境変数に読み込む（既存の値は上書きしない）"""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(path):
        return
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except OSError:
        pass


_load_dotenv()


def ai_configured() -> bool:
    """Claude API を呼べる見込みがあるか（キー or CLIログインのプロファイル）"""
    if os.environ.get("PLANNER_DISABLE_AI"):
        return False  # テスト・検証用：課金する呼び出しを確実に止める
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    profile_dir = os.path.join(os.path.expanduser("~"), ".config", "anthropic")
    try:
        return os.path.isdir(profile_dir) and bool(os.listdir(profile_dir))
    except OSError:
        return False


# ---------- 構造化出力のスキーマ ----------
class ProposalSpot(BaseModel):
    name: str
    category: str            # "sightseeing" | "food"
    stay_min: int
    note: str
    from_candidates: bool    # 候補リストの名前をそのまま使ったか
    lat: Optional[float] = None
    lng: Optional[float] = None


class ProposalDay(BaseModel):
    title: str
    spots: list[ProposalSpot]


class Proposal(BaseModel):
    title: str
    concept: str
    matched_wishes: list[str]
    days: list[ProposalDay]


class ProposalSet(BaseModel):
    proposals: list[Proposal]


# ---------- 共通 ----------
def _fmt_wish(i: int, w: dict) -> str:
    parts = []
    if w.get("nickname"):
        parts.append(f"名前:{w['nickname']}")
    if w.get("vibes"):
        parts.append("雰囲気:" + "/".join(w["vibes"]))
    if w.get("transport"):
        parts.append(f"移動:{w['transport']}")
    if w.get("budget"):
        parts.append(f"予算:{w['budget']}")
    if w.get("places"):
        parts.append(f"行きたい:{w['places']}")
    if w.get("foods"):
        parts.append(f"食べたい:{w['foods']}")
    if w.get("must"):
        parts.append(f"これだけは:{w['must']}")
    if w.get("avoid"):
        parts.append(f"避けたい:{w['avoid']}")
    free = w.get("free_text") or w.get("freeText")
    if free:
        parts.append(f"自由記入:{free}")
    return f"{i}. " + "　".join(parts)


def _fmt_candidate(c: dict) -> str:
    cat = "グルメ" if c.get("category") == "food" else "観光"
    bits = [f"{c.get('name')}［{cat}］"]
    if c.get("stayMin"):
        bits.append(f"滞在{c['stayMin']}分")
    if c.get("cost") is not None:
        bits.append(f"{c['cost']}円")
    if c.get("rating"):
        bits.append(f"★{c['rating']}")
    if c.get("source") == "history":
        bits.append("※以前行った場所")
    if c.get("desc"):
        bits.append(str(c["desc"])[:40])
    return " / ".join(bits)


def _normalize(proposals, source: str) -> list:
    """フロント向けの形（camelCase）に揃える"""
    out = []
    for p in proposals:
        days = []
        for d in p.get("days", []):
            spots = []
            for s in d.get("spots", []):
                if not s.get("name"):
                    continue
                cat = s.get("category")
                spots.append({
                    "name": str(s["name"]).strip(),
                    "category": "food" if cat == "food" else "sightseeing",
                    "stayMin": int(s.get("stayMin") or s.get("stay_min") or 60),
                    "note": str(s.get("note") or ""),
                    "lat": s.get("lat"),
                    "lng": s.get("lng"),
                    "fromCandidates": bool(s.get("fromCandidates", s.get("from_candidates", False))),
                })
            days.append({"title": str(d.get("title") or ""), "spots": spots})
        out.append({
            "title": str(p.get("title") or "旅程案"),
            "concept": str(p.get("concept") or ""),
            "matched": [str(m) for m in (p.get("matched") or p.get("matched_wishes") or [])],
            "days": days,
            "source": source,
        })
    return out


# ---------- Claude API ----------
def generate_with_claude(project: dict, wishes: list, candidates: list, count: int) -> list:
    import anthropic  # キー未設定環境でも import 失敗で落ちないよう遅延import

    num_days = int(project.get("numDays") or 1)
    region = project.get("region") or "（未設定）"
    wish_lines = "\n".join(_fmt_wish(i + 1, w) for i, w in enumerate(wishes)) or "（まだ要望はありません）"
    cand_lines = "\n".join("- " + _fmt_candidate(c) for c in candidates) or "（候補リストは空です）"

    system = (
        "あなたは日本国内旅行の熟練プランナーです。友人グループの「みんなの要望」と「候補地リスト」から、"
        "性格のはっきり違う旅程案を作ります。旅行者が投票で選ぶので、各案は誰の要望を強く反映したかが分かるようにします。"
    )
    user = f"""# 旅の条件
- 行き先: {region}
- 出発日: {project.get('startDate') or '未定'}
- 日数: {num_days}日間

# みんなの要望
{wish_lines}

# 候補地リスト（できるだけこの中から選ぶ。名前は一字一句そのまま使う）
{cand_lines}

# 作る案の数
{count}案

# ルール
- 各案は {num_days} 日分の days を持ち、1日あたり3〜5か所（のんびり志向なら3か所、アクティブ志向なら5か所）。
- グルメ（category=food）は昼（2〜3番目）と夜（最後）に置く。連続してグルメを並べない。
- 移動手段の希望を反映する（電車・バス／徒歩中心なら近いスポットでまとめる。車なら郊外も可）。
- 候補地リストにある場所は from_candidates=true にして名前をそのまま使う。
- 要望にあって候補にない有名な実在スポットは from_candidates=false で追加してよい（lat/lng は概算でよいので必ず入れる。存在が不確かな場所は入れない）。
- 「避けたい」に該当する場所は入れない。
- 各案の title は12文字以内でその案の性格が伝わる名前、concept は1〜2文。
- matched_wishes には「誰のどの要望をどう反映したか」を短い句で最大4つ。
- note は各スポット1文（なぜこの案でここに行くか）。stay_min は分単位の整数。
- 案どうしで同じ場所ばかりにならないよう、重視する要望を変えて差をつける。
"""
    client = anthropic.Anthropic()
    response = client.messages.parse(
        model=MODEL,
        max_tokens=16000,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_format=ProposalSet,
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("モデルが応答を拒否しました")
    parsed = response.parsed_output
    if parsed is None:
        raise RuntimeError("構造化出力を取得できませんでした")
    return _normalize([p.model_dump() for p in parsed.proposals], "claude")


# ---------- ルールベース ----------
_SPLIT_RE = re.compile(r"[、,，。．\s／/・\n]+")


def _tokens(text) -> list:
    if not text:
        return []
    return [t.strip() for t in _SPLIT_RE.split(str(text)) if len(t.strip()) >= 2]


def _dist(a: dict, b: dict) -> float:
    if a.get("lat") is None or b.get("lat") is None:
        return 1.0
    dx = (float(a["lng"]) - float(b["lng"])) * math.cos(math.radians(float(a["lat"])))
    dy = float(a["lat"]) - float(b["lat"])
    return math.hypot(dx, dy)


def _nearest_order(spots: list) -> list:
    """一番西の地点から最近傍で並べる（同じ日の中の巡回順）"""
    if len(spots) <= 2:
        return spots
    rest = sorted(spots, key=lambda s: (s.get("lng") is None, s.get("lng") or 0))
    ordered = [rest.pop(0)]
    while rest:
        cur = ordered[-1]
        nxt = min(rest, key=lambda s: _dist(cur, s))
        rest.remove(nxt)
        ordered.append(nxt)
    return ordered


def _place_food(day: list) -> list:
    """グルメを昼（2番目）と夜（最後）の位置へ寄せる"""
    foods = [s for s in day if s.get("category") == "food"]
    sights = [s for s in day if s.get("category") != "food"]
    if not foods:
        return day
    out = list(sights)
    if len(foods) >= 2:
        out.insert(min(1, len(out)), foods[0])
        out.append(foods[1])
        for f in foods[2:]:
            out.insert(len(out) // 2, f)
    else:
        out.insert(min(1, len(out)), foods[0])
    return out


def generate_rule_based(project: dict, wishes: list, candidates: list, count: int) -> list:
    num_days = max(1, int(project.get("numDays") or 1))
    cands = [dict(c) for c in candidates if c.get("name")]
    if not cands:
        return []

    place_tokens, must_tokens, avoid_tokens = [], [], []
    vibes, transports = Counter(), Counter()
    for w in wishes:
        for v in w.get("vibes") or []:
            vibes[v] += 1
        if w.get("transport"):
            transports[w["transport"]] += 1
        place_tokens += _tokens(w.get("places")) + _tokens(w.get("foods"))
        must_tokens += _tokens(w.get("must"))
        avoid_tokens += _tokens(w.get("avoid"))

    def score(c: dict) -> float:
        s = 0.0
        name = c["name"]
        for t in place_tokens:
            if t in name or name in t:
                s += 3
        for t in must_tokens:
            if t in name or name in t:
                s += 5
        for t in avoid_tokens:
            if t in name:
                s -= 10
        if c.get("rating"):
            s += float(c["rating"]) * 0.4
        if c.get("source") == "history":
            s += 0.5  # 以前行って良かった場所は少し優遇
        if c.get("category") == "food":
            s += vibes.get("グルメ", 0) * 0.6
        else:
            s += sum(vibes.get(v, 0) for v in SIGHT_VIBES) * 0.3
        return s

    scored = sorted(cands, key=score, reverse=True)
    scored = [c for c in scored if score(c) > -5]  # 避けたい場所は除外
    foods = [c for c in scored if c.get("category") == "food"]
    sights = [c for c in scored if c.get("category") != "food"]
    top_vibes = [v for v, _ in vibes.most_common(2)]
    top_transport = transports.most_common(1)[0][0] if transports else None
    relaxed = vibes.get("のんびり", 0) >= vibes.get("アクティブ", 0)

    variants = [
        {"title": "みんなの推し詰め合わせ", "concept": "行きたい場所の声が多いスポットを、無理のない順で回る王道の案。",
         "per_day": 3 if relaxed else 4, "food_ratio": 0.35, "stay": 1.0, "skip": 0},
        {"title": "食いしん坊コース", "concept": "グルメの要望を最優先。昼も夜もご当地の味を外さない案。",
         "per_day": 4, "food_ratio": 0.5, "stay": 1.0, "skip": 1},
        {"title": "のんびり絶景コース", "concept": "訪問数を絞り、1か所ごとにゆっくり過ごす案。景色と文化を中心に。",
         "per_day": 3, "food_ratio": 0.3, "stay": 1.35, "skip": 2},
        {"title": "欲張り全部盛り", "concept": "1日5か所のアクティブ案。移動は詰め気味だが見どころを網羅。",
         "per_day": 5, "food_ratio": 0.4, "stay": 0.85, "skip": 3},
    ]
    if vibes.get("アクティブ", 0) > vibes.get("のんびり", 0):
        variants = [variants[0], variants[3], variants[1], variants[2]]
    if vibes.get("グルメ", 0) >= 2:
        variants = [variants[1]] + [v for v in variants if v is not variants[1]]

    requested_tokens = place_tokens + must_tokens

    def pick(lst, n, skip):
        # 明示的に要望された場所は残し、それ以外は案ごとに先頭をずらして顔ぶれを変える
        requested = [c for c in lst if any(t in c["name"] for t in requested_tokens)]
        others = [c for c in lst if c not in requested]
        rotated = others[skip:] + others[:skip] if others else []
        return (requested + rotated)[:n]

    proposals = []
    for v in variants[:max(1, count)]:
        total = v["per_day"] * num_days
        n_food = min(len(foods), max(1 if foods else 0, round(total * v["food_ratio"])))
        n_sight = min(len(sights), total - n_food)
        picks = pick(sights, n_sight, v["skip"]) + pick(foods, n_food, v["skip"])
        if not picks:
            continue
        # 日ごとの割り当て：経度順に並べて日数で分割（近い場所を同じ日に）
        picks_geo = sorted(picks, key=lambda s: (s.get("lng") is None, s.get("lng") or 0))
        per = math.ceil(len(picks_geo) / num_days)
        days = []
        for i in range(num_days):
            chunk = picks_geo[i * per:(i + 1) * per]
            chunk = _place_food(_nearest_order(chunk))
            spots = []
            for c in chunk:
                stay = int(round((c.get("stayMin") or 60) * v["stay"] / 5.0) * 5)
                spots.append({
                    "name": c["name"], "category": c.get("category") or "sightseeing",
                    "stayMin": max(15, stay), "note": (c.get("desc") or "")[:60],
                    "lat": c.get("lat"), "lng": c.get("lng"), "fromCandidates": True,
                })
            days.append({"title": f"{i + 1}日目", "spots": spots})
        matched = []
        hit = [c["name"] for c in picks if any(t in c["name"] for t in requested_tokens)]
        if hit:
            matched.append("行きたい場所: " + "、".join(hit[:4]))
        if top_vibes:
            matched.append("雰囲気: " + "・".join(top_vibes))
        if top_transport:
            matched.append("移動: " + top_transport)
        if avoid_tokens:
            matched.append("避けた: " + "、".join(avoid_tokens[:3]))
        proposals.append({"title": v["title"], "concept": v["concept"], "matched": matched, "days": days})
    return _normalize(proposals, "rules")


def generate_proposals(project: dict, wishes: list, candidates: list, count: int = 3) -> tuple:
    """(proposals, source, note) を返す。Claude が使えなければルールベースへ"""
    count = max(1, min(int(count or 3), 4))
    if ai_configured():
        try:
            props = generate_with_claude(project, wishes, candidates, count)
            if props:
                return props, "claude", None
        except Exception as e:  # noqa: BLE001 - 失敗理由を画面に出してルールベースへ倒す
            note = f"Claude API の呼び出しに失敗したため簡易生成に切り替えました（{type(e).__name__}）"
            return generate_rule_based(project, wishes, candidates, count), "rules", note
    return generate_rule_based(project, wishes, candidates, count), "rules", None
