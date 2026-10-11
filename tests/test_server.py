# サーバーAPIの一連の流れを検証する（一時DBを使うので本番 data/planner.db には触れない）
#   ..\.venv\Scripts\python.exe tests\test_server.py
import os
import sys
import tempfile

TMP = tempfile.mkdtemp()
os.environ["PLANNER_DB_PATH"] = os.path.join(TMP, "test.db")
os.environ.pop("ANTHROPIC_API_KEY", None)  # テストは必ずルールベース生成で通す
os.environ.pop("ANTHROPIC_AUTH_TOKEN", None)
os.environ["HOME"] = TMP  # ~/.config/anthropic の検出も無効化
os.environ["USERPROFILE"] = TMP

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from fastapi.testclient import TestClient  # noqa: E402

from server.main import app  # noqa: E402

c = TestClient(app)
ok = 0
ng = 0


def check(name, cond):
    global ok, ng
    if cond:
        ok += 1
        print("  OK:", name)
    else:
        ng += 1
        print("  NG:", name)


print("[1] info")
r = c.get("/api/info")
check("info 200", r.status_code == 200)
check("ai はテストでは無効", r.json()["ai"] is False)

print("[2] プロジェクト")
plan = {"region": "京都", "startDate": "2026-10-03",
        "days": [{"startTime": "09:00", "items": [], "hotel": None}, {"startTime": "09:00", "items": [], "hotel": None}],
        "customSpots": [], "transport": {"out": None, "ret": None}, "origin": None, "heroSeen": True, "activeDay": 0}
r = c.post("/api/projects", json={"plan": plan})
check("作成 200", r.status_code == 200)
p = r.json()
check("自動命名", p["name"] == "京都の旅（10/3〜 2日間）")
check("共有トークンあり", bool(p["shareToken"]))
check("status=collecting", p["status"] == "collecting")
pid = p["id"]
r = c.get("/api/projects")
check("一覧に1件", len(r.json()) == 1 and r.json()[0]["wishCount"] == 0)
r = c.patch(f"/api/projects/{pid}", json={"name": "秋の京都"})
check("改名", r.json()["name"] == "秋の京都" and r.json()["nameAuto"] is False)
plan["startDate"] = "2026-11-01"
r = c.put(f"/api/projects/{pid}/plan", json={"plan": plan})
check("plan保存・改名済みは名前維持", r.json()["startDate"] == "2026-11-01" and r.json()["name"] == "秋の京都")
r = c.get(f"/api/projects/{pid}")
check("plan復元", r.json()["plan"]["startDate"] == "2026-11-01")

print("[3] 共有リンク・QR")
r = c.post(f"/api/projects/{pid}/share")
check("share 200", r.status_code == 200 and "/s/" in r.json()["url"])
token = r.json()["token"]
r = c.get(f"/api/projects/{pid}/qr.svg")
check("QR svg", r.status_code == 200 and r.headers["content-type"].startswith("image/svg") and b"<svg" in r.content)
r = c.get(f"/s/{token}")
check("参加者ページが返る", r.status_code == 200 and "share.js" in r.text)
check("アイコン配信", c.get("/assets/icon-32.png").status_code == 200 and c.get("/assets/icon-192.png").status_code == 200)
check("manifest と favicon", c.get("/manifest.webmanifest").status_code == 200 and c.get("/favicon.ico").status_code == 200)
check("index に favicon/manifest リンク", all(x in c.get("/").text for x in ("icon-32.png", "apple-touch-icon", "manifest.webmanifest")))

print("[4] 匿名の要望")
r = c.get(f"/api/s/{token}")
check("公開情報", r.status_code == 200 and r.json()["name"] == "秋の京都" and r.json()["proposals"] == [])
r = c.post(f"/api/s/{token}/wishes", json={"nickname": "A", "vibes": ["グルメ", "のんびり"], "transport": "電車・バス",
                                            "places": "伏見稲荷大社、錦市場", "budget": "1〜3万", "avoid": "金閣寺"})
check("要望1", r.status_code == 200 and r.json()["wishCount"] == 1)
r = c.post(f"/api/s/{token}/wishes", json={"nickname": "B", "vibes": ["グルメ", "絶景・自然"], "transport": "電車・バス",
                                            "places": "嵐山", "foods": "抹茶パフェ", "freeText": "抹茶パフェ食べたい"})
check("要望2", r.status_code == 200 and r.json()["wishCount"] == 2)
r = c.get(f"/api/s/{token}")
check("集計", r.json()["vibeTally"]["グルメ"] == 2 and r.json()["transportTally"]["電車・バス"] == 2)
r = c.get(f"/api/projects/{pid}/wishes")
check("オーナーから要望一覧", len(r.json()) == 2 and r.json()[1]["freeText"] == "抹茶パフェ食べたい" and r.json()[1]["foods"] == "抹茶パフェ")
r = c.get("/api/s/xxxx")
check("無効トークンは404", r.status_code == 404)

print("[5] 旅程案（ルールベース）")
cands = [
    {"id": "kyoto-1", "name": "清水寺", "category": "sightseeing", "lat": 34.9949, "lng": 135.7850, "stayMin": 90, "cost": 400},
    {"id": "kyoto-2", "name": "伏見稲荷大社", "category": "sightseeing", "lat": 34.9671, "lng": 135.7727, "stayMin": 90, "cost": 0},
    {"id": "kyoto-3", "name": "金閣寺（鹿苑寺）", "category": "sightseeing", "lat": 35.0394, "lng": 135.7292, "stayMin": 60, "cost": 500},
    {"id": "kyoto-4", "name": "嵐山・竹林の小径", "category": "sightseeing", "lat": 35.0170, "lng": 135.6710, "stayMin": 90, "cost": 0},
    {"id": "kyoto-5", "name": "錦市場", "category": "food", "lat": 35.0050, "lng": 135.7649, "stayMin": 60, "cost": 1500},
    {"id": "kyoto-6", "name": "二条城", "category": "sightseeing", "lat": 35.0142, "lng": 135.7481, "stayMin": 90, "cost": 800},
    {"id": "kyoto-7", "name": "祇園・花見小路", "category": "sightseeing", "lat": 35.0037, "lng": 135.7752, "stayMin": 60, "cost": 0},
    {"id": "kyoto-8", "name": "茶寮都路里 祇園本店", "category": "food", "lat": 35.0039, "lng": 135.7745, "stayMin": 60, "cost": 1300},
]
r = c.post(f"/api/projects/{pid}/proposals/generate", json={"candidates": cands, "count": 3})
check("生成 200", r.status_code == 200)
res = r.json()
check("ルールベース", res["source"] == "rules")
props = res["proposals"]
check("3案", len(props) == 3)
check("各案2日分", all(len(p["days"]) == 2 for p in props))
names = {s["name"] for p in props for d in p["days"] for s in d["spots"]}
check("要望の場所が入る", "伏見稲荷大社" in names and "錦市場" in names)
check("避けたい場所が入らない", "金閣寺（鹿苑寺）" not in names)
check("グルメ重視案が先頭", props[0]["title"] == "食いしん坊コース")
check("反映した要望の要約", any("行きたい場所" in m for m in props[0]["matched"]))
r = c.post(f"/api/projects/{pid}/proposals/generate", json={"candidates": [], "count": 3})
check("候補なしは400", r.status_code == 400)

print("[6] 投票")
r = c.post(f"/api/s/{token}/vote", json={"proposalId": props[0]["id"], "voterId": "dev1"})
check("投票中でないと400", r.status_code == 400)
c.patch(f"/api/projects/{pid}", json={"status": "voting"})
r = c.post(f"/api/s/{token}/vote", json={"proposalId": props[0]["id"], "voterId": "dev1", "nickname": "A"})
check("投票1", r.status_code == 200 and r.json()["myVote"] == props[0]["id"])
r = c.post(f"/api/s/{token}/vote", json={"proposalId": props[1]["id"], "voterId": "dev2"})
r = c.post(f"/api/s/{token}/vote", json={"proposalId": props[1]["id"], "voterId": "dev1"})  # 変更
r = c.get(f"/api/s/{token}", params={"voter": "dev1"})
tally = {p["id"]: p["votes"] for p in r.json()["proposals"]}
check("1人1票で変更できる", tally[props[0]["id"]] == 0 and tally[props[1]["id"]] == 2)
check("自分の票が分かる", r.json()["myVote"] == props[1]["id"])
r = c.post(f"/api/projects/{pid}/vote", json={"proposalId": props[2]["id"], "voterId": "owner"})
check("オーナー投票", r.status_code == 200)

print("[7] 履歴")
r = c.post(f"/api/projects/{pid}/archive", json={"places": [
    {"name": "清水寺", "category": "sightseeing", "lat": 34.9949, "lng": 135.7850, "rating": 4.5, "stayMin": 90, "cost": 400},
    {"name": "錦市場", "category": "food", "placeId": "pl-nishiki", "address": "京都市中京区", "cost": 1500},
    {"name": "ホテルグランヴィア京都", "category": "hotel", "cost": 18000},
], "totalCost": 30000})
check("archive 200", r.status_code == 200 and r.json()["savedPlaces"] == 3)
r = c.get(f"/api/projects/{pid}")
check("status=done", r.json()["status"] == "done")
r = c.get("/api/history/places", params={"region": "京都"})
check("履歴3件", len(r.json()) == 3)
hp = next(x for x in r.json() if x["name"] == "錦市場")
check("訪問日=出発日", hp["lastVisited"] == "2026-11-01" and hp["visitCount"] == 1)
r = c.post("/api/history/places", json={"name": "錦市場", "region": "京都", "placeId": "pl-nishiki", "memo": "朝が空いてる", "rating": 4.2})
check("upsert（placeIdで同一）", r.json()["id"] == hp["id"] and r.json()["memo"] == "朝が空いてる" and r.json()["visitCount"] == 1)
r = c.get("/api/history/places", params={"q": "朝が"})
check("メモ検索", len(r.json()) == 1)
r = c.patch(f"/api/history/places/{hp['id']}", json={"memo": "混む", "stayMin": 45})
check("メモ編集", r.json()["memo"] == "混む" and r.json()["stayMin"] == 45)
r = c.get("/api/history/trips")
check("旅の履歴1件", len(r.json()) == 1 and r.json()[0]["totalCost"] == 30000)
r = c.post(f"/api/projects/{pid}/archive", json={"places": [{"name": "錦市場", "placeId": "pl-nishiki"}]})
r = c.get("/api/history/places", params={"q": "錦市場"})
check("再訪で回数2", r.json()[0]["visitCount"] == 2)
r = c.delete(f"/api/history/places/{hp['id']}")
check("履歴削除", r.status_code == 200 and c.get("/api/history/places", params={"q": "錦市場"}).json() == [])

print("[8] 複製・削除")
r = c.post(f"/api/projects/{pid}/duplicate")
check("複製", r.status_code == 200 and r.json()["name"].endswith("（コピー）") and r.json()["plan"]["days"][0]["items"] == [])
r = c.delete(f"/api/projects/{pid}")
check("削除", r.status_code == 200 and c.get(f"/api/projects/{pid}").status_code == 404)
r = c.get(f"/api/s/{token}")
check("削除後は共有リンクも無効", r.status_code == 404)

print(f"\n合計: OK {ok} / NG {ng}")
sys.exit(1 if ng else 0)
