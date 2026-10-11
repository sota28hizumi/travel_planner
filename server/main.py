# ============================================================
# 旅程プランナー API サーバー（FastAPI）
#   起動: ..\.venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000
#   - 静的ファイル（index.html / css / js）もここから配信する
#   - /s/{token} が参加者向けの匿名ページ（要望フォーム・投票）
#   - データは data/planner.db（SQLite）
# ============================================================
import io
import json
import os
import socket
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ai, db

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

app = FastAPI(title="旅程プランナー API", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

db.init_db()


@app.middleware("http")
async def no_stale_assets(request: Request, call_next):
    """画面のHTML・JS・CSSは毎回サーバーに問い合わせさせる（更新直後に古いJSが残る事故を防ぐ）"""
    response = await call_next(request)
    p = request.url.path
    if p == "/" or p.endswith(".html") or p.startswith("/js/") or p.startswith("/css/") or p.startswith("/s/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


# ---------- 共通ヘルパー ----------
def lan_ip() -> str:
    """同じWi-Fi内の端末から届くこのPCのIPv4（UDPソケットの経路選択で求める。送信はしない）"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def share_base(request: Request) -> str:
    """共有リンクの土台URL。PLANNER_PUBLIC_URL があればそれ（トンネル等）、なければ LAN IP"""
    env = os.environ.get("PLANNER_PUBLIC_URL")
    if env:
        return env.rstrip("/")
    port = request.url.port or (443 if request.url.scheme == "https" else 80)
    return f"{request.url.scheme}://{lan_ip()}:{port}"


def get_project_row(con, pid: str):
    row = con.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    if row is None:
        raise HTTPException(404, "プロジェクトが見つかりません")
    return row


def get_project_by_token(con, token: str):
    row = con.execute("SELECT * FROM projects WHERE share_token = ?", (token,)).fetchone()
    if row is None:
        raise HTTPException(404, "この共有リンクは無効です")
    return row


def wishes_of(con, pid: str) -> list:
    rows = con.execute("SELECT * FROM wishes WHERE project_id = ? ORDER BY created_at", (pid,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["vibes"] = db.loads(d.get("vibes"), [])
        d["freeText"] = d.pop("free_text", "")
        d["createdAt"] = d.pop("created_at", None)
        d.pop("project_id", None)
        out.append(d)
    return out


def proposals_of(con, pid: str) -> list:
    rows = con.execute(
        "SELECT * FROM proposals WHERE project_id = ? ORDER BY round DESC, idx", (pid,)
    ).fetchall()
    votes = con.execute(
        "SELECT proposal_id, nickname, comment FROM votes WHERE project_id = ?", (pid,)
    ).fetchall()
    by_prop: dict = {}
    for v in votes:
        by_prop.setdefault(v["proposal_id"], []).append({"nickname": v["nickname"] or "", "comment": v["comment"] or ""})
    out = []
    latest_round = rows[0]["round"] if rows else 0
    for r in rows:
        if r["round"] != latest_round:
            continue  # 最新ラウンドだけ返す
        d = {
            "id": r["id"], "round": r["round"], "idx": r["idx"], "title": r["title"],
            "concept": r["concept"], "matched": db.loads(r["matched"], []),
            "days": db.loads(r["days_json"], []), "source": r["source"],
            "createdAt": r["created_at"],
            "voters": by_prop.get(r["id"], []),
        }
        d["votes"] = len(d["voters"])
        out.append(d)
    return out


def project_status_info(row) -> dict:
    return {
        "id": row["id"], "name": row["name"], "region": row["region"],
        "startDate": row["start_date"], "numDays": row["num_days"], "status": row["status"],
    }


# ---------- 情報 ----------
@app.get("/api/info")
def api_info(request: Request):
    return {
        "ok": True,
        "ai": ai.ai_configured(),
        "aiModel": ai.MODEL,
        "lanIp": lan_ip(),
        "shareBase": share_base(request),
    }


# ---------- プロジェクト ----------
class ProjectCreate(BaseModel):
    name: Optional[str] = None
    plan: Optional[dict] = None


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


class PlanPut(BaseModel):
    plan: dict


@app.get("/api/projects")
def list_projects():
    with db.connect() as con:
        rows = con.execute(
            "SELECT id, name, name_auto, region, start_date, num_days, status, share_token, created_at, updated_at "
            "FROM projects ORDER BY updated_at DESC, rowid DESC"
        ).fetchall()
        out = []
        for r in rows:
            d = db.project_public(r)
            d.pop("plan", None)
            d["wishCount"] = con.execute("SELECT COUNT(*) FROM wishes WHERE project_id = ?", (r["id"],)).fetchone()[0]
            d["proposalCount"] = len(proposals_of(con, r["id"]))
            out.append(d)
        return out


@app.post("/api/projects")
def create_project(body: ProjectCreate):
    pid = db.new_id("p")
    now = db.now_iso()
    region, start, n = db.plan_summary(body.plan)
    has_name = bool(body.name and body.name.strip())
    name = body.name.strip() if has_name else db.auto_name(region, start, n)
    with db.connect() as con:
        con.execute(
            "INSERT INTO projects (id, name, name_auto, region, start_date, num_days, status, plan_json, share_token, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?)",
            (pid, name, 0 if has_name else 1, region, start, n,
             json.dumps(body.plan, ensure_ascii=False) if body.plan is not None else None,
             db.new_token(), now, now),
        )
        return db.project_public(get_project_row(con, pid))


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    with db.connect() as con:
        return db.project_public(get_project_row(con, pid))


@app.patch("/api/projects/{pid}")
def patch_project(pid: str, body: ProjectPatch):
    with db.connect() as con:
        get_project_row(con, pid)
        if body.name is not None and body.name.strip():
            con.execute("UPDATE projects SET name = ?, name_auto = 0, updated_at = ? WHERE id = ?",
                        (body.name.strip()[:80], db.now_iso(), pid))
        if body.status is not None:
            if body.status not in ("collecting", "voting", "decided", "done"):
                raise HTTPException(400, "status が不正です")
            con.execute("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
                        (body.status, db.now_iso(), pid))
        return db.project_public(get_project_row(con, pid))


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    with db.connect() as con:
        get_project_row(con, pid)
        for t in ("wishes", "proposals", "votes"):
            con.execute(f"DELETE FROM {t} WHERE project_id = ?", (pid,))
        con.execute("DELETE FROM projects WHERE id = ?", (pid,))
    return {"ok": True}


@app.put("/api/projects/{pid}/plan")
def put_plan(pid: str, body: PlanPut):
    region, start, n = db.plan_summary(body.plan)
    with db.connect() as con:
        row = get_project_row(con, pid)
        name = row["name"]
        if row["name_auto"]:
            name = db.auto_name(region, start, n)
        con.execute(
            "UPDATE projects SET plan_json = ?, region = ?, start_date = ?, num_days = ?, name = ?, updated_at = ? WHERE id = ?",
            (json.dumps(body.plan, ensure_ascii=False), region, start, n, name, db.now_iso(), pid),
        )
        d = db.project_public(get_project_row(con, pid))
        d.pop("plan", None)
        return d


@app.post("/api/projects/{pid}/duplicate")
def duplicate_project(pid: str):
    """過去の旅を土台に新しい旅を作る（候補リスト・出発地は引き継ぎ、日程は新規）"""
    with db.connect() as con:
        row = get_project_row(con, pid)
        plan = db.loads(row["plan_json"], None)
        if isinstance(plan, dict):
            plan = dict(plan)
            days = plan.get("days") or []
            plan["days"] = [{"startTime": d.get("startTime", "09:00"), "items": [], "hotel": None} for d in days] or [
                {"startTime": "09:00", "items": [], "hotel": None}]
            plan["transport"] = {"out": None, "ret": None}
            plan["activeDay"] = 0
            plan["heroSeen"] = True
        new_pid = db.new_id("p")
        now = db.now_iso()
        region, start, n = db.plan_summary(plan)
        con.execute(
            "INSERT INTO projects (id, name, name_auto, region, start_date, num_days, status, plan_json, share_token, created_at, updated_at) "
            "VALUES (?, ?, 0, ?, ?, ?, 'collecting', ?, ?, ?, ?)",
            (new_pid, f"{row['name']}（コピー）", region, start, n,
             json.dumps(plan, ensure_ascii=False) if plan is not None else None, db.new_token(), now, now),
        )
        return db.project_public(get_project_row(con, new_pid))


# ---------- 共有リンク・QR ----------
@app.post("/api/projects/{pid}/share")
def create_share(pid: str, request: Request):
    with db.connect() as con:
        row = get_project_row(con, pid)
        token = row["share_token"]
        if not token:
            token = db.new_token()
            con.execute("UPDATE projects SET share_token = ? WHERE id = ?", (token, pid))
        return {"token": token, "url": f"{share_base(request)}/s/{token}"}


@app.get("/api/projects/{pid}/qr.svg")
def share_qr(pid: str, request: Request):
    import segno

    with db.connect() as con:
        row = get_project_row(con, pid)
        token = row["share_token"]
        if not token:
            raise HTTPException(404, "共有リンクが未作成です")
    url = f"{share_base(request)}/s/{token}"
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="svg", scale=6, border=2, dark="#1f2a30", light=None)
    return Response(content=buf.getvalue(), media_type="image/svg+xml",
                    headers={"Cache-Control": "no-store"})


# ---------- 要望 ----------
class WishIn(BaseModel):
    nickname: Optional[str] = ""
    vibes: Optional[list[str]] = []
    transport: Optional[str] = ""
    places: Optional[str] = ""
    foods: Optional[str] = ""
    budget: Optional[str] = ""
    must: Optional[str] = ""
    avoid: Optional[str] = ""
    freeText: Optional[str] = ""


def _clip(s: Optional[str], n: int = 400) -> str:
    return (s or "").strip()[:n]


def insert_wish(con, pid: str, w: WishIn) -> dict:
    wid = db.new_id("w")
    con.execute(
        "INSERT INTO wishes (id, project_id, nickname, vibes, transport, places, foods, budget, must, avoid, free_text, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (wid, pid, _clip(w.nickname, 40), json.dumps([v for v in (w.vibes or []) if v][:10], ensure_ascii=False),
         _clip(w.transport, 40), _clip(w.places), _clip(w.foods), _clip(w.budget, 40), _clip(w.must), _clip(w.avoid),
         _clip(w.freeText, 800), db.now_iso()),
    )
    con.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (db.now_iso(), pid))
    return {"id": wid}


@app.get("/api/projects/{pid}/wishes")
def list_wishes(pid: str):
    with db.connect() as con:
        get_project_row(con, pid)
        return wishes_of(con, pid)


@app.post("/api/projects/{pid}/wishes")
def add_wish_owner(pid: str, body: WishIn):
    with db.connect() as con:
        get_project_row(con, pid)
        return insert_wish(con, pid, body)


@app.delete("/api/projects/{pid}/wishes/{wid}")
def delete_wish(pid: str, wid: str):
    with db.connect() as con:
        con.execute("DELETE FROM wishes WHERE project_id = ? AND id = ?", (pid, wid))
    return {"ok": True}


# ---------- 旅程案・投票 ----------
class GenerateIn(BaseModel):
    candidates: list[dict] = []
    count: int = 3


class VoteIn(BaseModel):
    proposalId: str
    voterId: str
    nickname: Optional[str] = ""
    comment: Optional[str] = ""


@app.get("/api/projects/{pid}/proposals")
def list_proposals(pid: str):
    with db.connect() as con:
        get_project_row(con, pid)
        return proposals_of(con, pid)


@app.post("/api/projects/{pid}/proposals/generate")
def generate(pid: str, body: GenerateIn):
    with db.connect() as con:
        row = get_project_row(con, pid)
        wishes = wishes_of(con, pid)
        project = project_status_info(row)
    props, source, note = ai.generate_proposals(project, wishes, body.candidates, body.count)
    if not props:
        raise HTTPException(400, "候補地がないため案を作れません。スポットを候補リストに入れるか、要望に行きたい場所を書いてもらってください")
    with db.connect() as con:
        cur = con.execute("SELECT COALESCE(MAX(round), 0) FROM proposals WHERE project_id = ?", (pid,)).fetchone()[0]
        rnd = int(cur) + 1
        con.execute("DELETE FROM votes WHERE project_id = ?", (pid,))  # 新しい案なので投票はやり直し
        now = db.now_iso()
        for i, p in enumerate(props):
            con.execute(
                "INSERT INTO proposals (id, project_id, round, idx, title, concept, matched, days_json, source, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (db.new_id("q"), pid, rnd, i, p["title"], p["concept"],
                 json.dumps(p["matched"], ensure_ascii=False), json.dumps(p["days"], ensure_ascii=False), source, now),
            )
        con.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, pid))
        return {"proposals": proposals_of(con, pid), "source": source, "note": note, "round": rnd}


@app.delete("/api/projects/{pid}/proposals")
def clear_proposals(pid: str):
    with db.connect() as con:
        con.execute("DELETE FROM proposals WHERE project_id = ?", (pid,))
        con.execute("DELETE FROM votes WHERE project_id = ?", (pid,))
    return {"ok": True}


def upsert_vote(con, pid: str, v: VoteIn) -> None:
    ok = con.execute("SELECT 1 FROM proposals WHERE id = ? AND project_id = ?", (v.proposalId, pid)).fetchone()
    if not ok:
        raise HTTPException(404, "その案は見つかりません（作り直された可能性があります）")
    con.execute(
        "INSERT INTO votes (project_id, proposal_id, voter_id, nickname, comment, created_at) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(project_id, voter_id) DO UPDATE SET proposal_id = excluded.proposal_id, nickname = excluded.nickname, "
        "comment = excluded.comment, created_at = excluded.created_at",
        (pid, v.proposalId, v.voterId[:64], (v.nickname or "")[:40], (v.comment or "")[:300], db.now_iso()),
    )


@app.post("/api/projects/{pid}/vote")
def vote_owner(pid: str, body: VoteIn):
    with db.connect() as con:
        get_project_row(con, pid)
        upsert_vote(con, pid, body)
        return proposals_of(con, pid)


# ---------- 履歴（行った場所のDB） ----------
class HistoryPlaceIn(BaseModel):
    name: str
    category: Optional[str] = "sightseeing"
    region: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    placeId: Optional[str] = None
    address: Optional[str] = None
    rating: Optional[float] = None
    ratingCount: Optional[int] = None
    photoUrl: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    memo: Optional[str] = None
    stayMin: Optional[int] = None
    cost: Optional[int] = None
    visited: Optional[str] = None  # 訪問日（YYYY-MM-DD）


class HistoryPlacePatch(BaseModel):
    memo: Optional[str] = None
    stayMin: Optional[int] = None
    cost: Optional[int] = None
    category: Optional[str] = None


class ArchiveIn(BaseModel):
    places: list[HistoryPlaceIn] = []
    totalCost: Optional[int] = None


def history_row_public(r) -> dict:
    d = dict(r)
    return {
        "id": d["id"], "name": d["name"], "category": d["category"], "region": d["region"],
        "lat": d["lat"], "lng": d["lng"], "placeId": d["place_id"], "address": d["address"],
        "rating": d["rating"], "ratingCount": d["rating_count"], "photoUrl": d["photo_url"],
        "website": d["website"], "phone": d["phone"], "memo": d["memo"], "stayMin": d["stay_min"],
        "cost": d["cost"], "visitCount": d["visit_count"], "firstVisited": d["first_visited"],
        "lastVisited": d["last_visited"], "updatedAt": d["updated_at"],
    }


def upsert_history_place(con, p: HistoryPlaceIn, count_visit: bool) -> str:
    """placeId（なければ 名前＋地域）で同一判定し、訪問回数を積む"""
    row = None
    if p.placeId:
        row = con.execute("SELECT * FROM history_places WHERE place_id = ?", (p.placeId,)).fetchone()
    if row is None:
        row = con.execute("SELECT * FROM history_places WHERE name = ? AND IFNULL(region,'') = IFNULL(?,'')",
                          (p.name.strip(), p.region)).fetchone()
    now = db.now_iso()
    visited = p.visited or now[:10]
    if row is None:
        hid = db.new_id("h")
        con.execute(
            "INSERT INTO history_places (id, name, category, region, lat, lng, place_id, address, rating, rating_count, "
            "photo_url, website, phone, memo, stay_min, cost, visit_count, first_visited, last_visited, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (hid, p.name.strip(), p.category or "sightseeing", p.region, p.lat, p.lng, p.placeId, p.address, p.rating,
             p.ratingCount, p.photoUrl, p.website, p.phone, p.memo, p.stayMin, p.cost, 1 if count_visit else 0,
             visited if count_visit else None, visited if count_visit else None, now, now),
        )
        return hid
    # 既存：新しい情報で埋め、訪問なら回数と日付を更新
    fields = {
        "category": p.category or row["category"], "region": p.region or row["region"],
        "lat": p.lat if p.lat is not None else row["lat"], "lng": p.lng if p.lng is not None else row["lng"],
        "place_id": p.placeId or row["place_id"], "address": p.address or row["address"],
        "rating": p.rating if p.rating is not None else row["rating"],
        "rating_count": p.ratingCount if p.ratingCount is not None else row["rating_count"],
        "photo_url": p.photoUrl or row["photo_url"], "website": p.website or row["website"],
        "phone": p.phone or row["phone"], "memo": p.memo if p.memo is not None else row["memo"],
        "stay_min": p.stayMin if p.stayMin is not None else row["stay_min"],
        "cost": p.cost if p.cost is not None else row["cost"],
        "updated_at": now,
    }
    if count_visit:
        fields["visit_count"] = (row["visit_count"] or 0) + 1
        fields["first_visited"] = row["first_visited"] or visited
        fields["last_visited"] = max(row["last_visited"] or "", visited)
    sets = ", ".join(f"{k} = ?" for k in fields)
    con.execute(f"UPDATE history_places SET {sets} WHERE id = ?", (*fields.values(), row["id"]))
    return row["id"]


@app.get("/api/history/places")
def list_history_places(q: Optional[str] = None, region: Optional[str] = None, limit: int = 200):
    sql = "SELECT * FROM history_places WHERE 1=1"
    args: list[Any] = []
    if region:
        sql += " AND region = ?"
        args.append(region)
    if q:
        sql += " AND (name LIKE ? OR IFNULL(address,'') LIKE ? OR IFNULL(memo,'') LIKE ? OR IFNULL(region,'') LIKE ?)"
        args += [f"%{q}%"] * 4
    sql += " ORDER BY IFNULL(last_visited,'') DESC, updated_at DESC LIMIT ?"
    args.append(max(1, min(limit, 1000)))
    with db.connect() as con:
        return [history_row_public(r) for r in con.execute(sql, args).fetchall()]


@app.post("/api/history/places")
def add_history_place(body: HistoryPlaceIn):
    if not body.name or not body.name.strip():
        raise HTTPException(400, "name は必須です")
    with db.connect() as con:
        hid = upsert_history_place(con, body, count_visit=False)
        return history_row_public(con.execute("SELECT * FROM history_places WHERE id = ?", (hid,)).fetchone())


@app.patch("/api/history/places/{hid}")
def patch_history_place(hid: str, body: HistoryPlacePatch):
    with db.connect() as con:
        row = con.execute("SELECT * FROM history_places WHERE id = ?", (hid,)).fetchone()
        if row is None:
            raise HTTPException(404, "見つかりません")
        fields = {}
        if body.memo is not None:
            fields["memo"] = body.memo[:500]
        if body.stayMin is not None:
            fields["stay_min"] = body.stayMin
        if body.cost is not None:
            fields["cost"] = body.cost
        if body.category is not None:
            fields["category"] = body.category
        fields["updated_at"] = db.now_iso()
        sets = ", ".join(f"{k} = ?" for k in fields)
        con.execute(f"UPDATE history_places SET {sets} WHERE id = ?", (*fields.values(), hid))
        return history_row_public(con.execute("SELECT * FROM history_places WHERE id = ?", (hid,)).fetchone())


@app.delete("/api/history/places/{hid}")
def delete_history_place(hid: str):
    with db.connect() as con:
        con.execute("DELETE FROM history_places WHERE id = ?", (hid,))
    return {"ok": True}


@app.get("/api/history/trips")
def list_history_trips():
    with db.connect() as con:
        rows = con.execute("SELECT * FROM history_trips ORDER BY IFNULL(start_date,'') DESC, archived_at DESC").fetchall()
        out = []
        for r in rows:
            out.append({
                "id": r["id"], "projectId": r["project_id"], "name": r["name"], "region": r["region"],
                "startDate": r["start_date"], "numDays": r["num_days"], "places": db.loads(r["places_json"], []),
                "totalCost": r["total_cost"], "archivedAt": r["archived_at"],
            })
        return out


@app.delete("/api/history/trips/{tid}")
def delete_history_trip(tid: str):
    with db.connect() as con:
        con.execute("DELETE FROM history_trips WHERE id = ?", (tid,))
    return {"ok": True}


@app.post("/api/projects/{pid}/archive")
def archive_project(pid: str, body: ArchiveIn):
    """旅を完了扱いにして、訪問した場所を履歴DBに積む"""
    with db.connect() as con:
        row = get_project_row(con, pid)
        visited = row["start_date"]
        saved = []
        for p in body.places:
            if not p.name or not p.name.strip():
                continue
            if not p.region:
                p.region = row["region"]
            if not p.visited:
                p.visited = visited
            hid = upsert_history_place(con, p, count_visit=True)
            saved.append({"id": hid, "name": p.name, "category": p.category})
        tid = db.new_id("t")
        con.execute(
            "INSERT INTO history_trips (id, project_id, name, region, start_date, num_days, places_json, total_cost, archived_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (tid, pid, row["name"], row["region"], row["start_date"], row["num_days"],
             json.dumps(saved, ensure_ascii=False), body.totalCost, db.now_iso()),
        )
        con.execute("UPDATE projects SET status = 'done', updated_at = ? WHERE id = ?", (db.now_iso(), pid))
        return {"ok": True, "tripId": tid, "savedPlaces": len(saved)}


# ---------- 参加者向け（匿名・トークン） ----------
@app.get("/api/s/{token}")
def share_info(token: str, voter: Optional[str] = None):
    with db.connect() as con:
        row = get_project_by_token(con, token)
        pid = row["id"]
        info = project_status_info(row)
        info["wishCount"] = con.execute("SELECT COUNT(*) FROM wishes WHERE project_id = ?", (pid,)).fetchone()[0]
        # 要望の集計（匿名。個別の本文は返さず、雰囲気と移動手段の票数だけ）
        vibes: dict = {}
        transports: dict = {}
        for w in wishes_of(con, pid):
            for v in w["vibes"]:
                vibes[v] = vibes.get(v, 0) + 1
            if w.get("transport"):
                transports[w["transport"]] = transports.get(w["transport"], 0) + 1
        info["vibeTally"] = vibes
        info["transportTally"] = transports
        # 投票中・決定後だけ案を見せる
        if row["status"] in ("voting", "decided", "done"):
            info["proposals"] = proposals_of(con, pid)
        else:
            info["proposals"] = []
        my = None
        if voter:
            r = con.execute("SELECT proposal_id FROM votes WHERE project_id = ? AND voter_id = ?", (pid, voter)).fetchone()
            my = r["proposal_id"] if r else None
        info["myVote"] = my
        return info


@app.post("/api/s/{token}/wishes")
def share_add_wish(token: str, body: WishIn):
    with db.connect() as con:
        row = get_project_by_token(con, token)
        if row["status"] in ("decided", "done"):
            raise HTTPException(400, "この旅の要望募集は終了しています")
        res = insert_wish(con, row["id"], body)
        res["wishCount"] = con.execute("SELECT COUNT(*) FROM wishes WHERE project_id = ?", (row["id"],)).fetchone()[0]
        return res


@app.post("/api/s/{token}/vote")
def share_vote(token: str, body: VoteIn):
    with db.connect() as con:
        row = get_project_by_token(con, token)
        if row["status"] != "voting":
            raise HTTPException(400, "いまは投票を受け付けていません")
        upsert_vote(con, row["id"], body)
        return {"ok": True, "proposals": proposals_of(con, row["id"]), "myVote": body.proposalId}


# ---------- 静的ファイル ----------
@app.get("/")
@app.get("/index.html")
def index_page():
    return FileResponse(os.path.join(ROOT, "index.html"))


@app.get("/s/{token}")
@app.get("/share.html")
def share_page(token: Optional[str] = None):
    return FileResponse(os.path.join(ROOT, "share.html"))


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(os.path.join(ROOT, "manifest.webmanifest"), media_type="application/manifest+json")


@app.get("/favicon.ico")
def favicon():
    return FileResponse(os.path.join(ROOT, "assets", "favicon.ico"), media_type="image/x-icon")


app.mount("/css", StaticFiles(directory=os.path.join(ROOT, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(ROOT, "js")), name="js")
app.mount("/assets", StaticFiles(directory=os.path.join(ROOT, "assets")), name="assets")
