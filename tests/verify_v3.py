# たびえま v3b の画面をPlaywrightで確認し、スクショを撮る
#   1) サーバーを起動:  PLANNER_DB_PATH=<一時DB> PLANNER_DISABLE_AI=1 ..\.venv\Scripts\python.exe -m uvicorn server.main:app --port 8123
#   2) ..\.venv\Scripts\python.exe tests\verify_v3.py
# 本番DBを汚さないよう、PLANNER_DB_PATH で一時DBを指したサーバーに対して実行すること。
# PLANNER_DISABLE_AI=1 で Claude API（課金）を呼ばずルールベース生成で通す
import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = os.environ.get("VERIFY_BASE", "http://127.0.0.1:8123")
OUT = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(OUT, exist_ok=True)
ok = ng = 0


def check(name, cond):
    global ok, ng
    if cond:
        ok += 1
        print("  OK:", name)
    else:
        ng += 1
        print("  NG:", name)


def api(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------- 前回のデータを消してから用意（API経由） ----------
print("[0] データ準備")
for x in api("GET", "/api/projects"):
    api("DELETE", f"/api/projects/{x['id']}")
for x in api("GET", "/api/history/places?limit=1000"):
    api("DELETE", f"/api/history/places/{x['id']}")
for x in api("GET", "/api/history/trips"):
    api("DELETE", f"/api/history/trips/{x['id']}")
KYOTO = [
    {"id": "kyoto-1", "name": "清水寺", "category": "sightseeing", "lat": 34.9949, "lng": 135.7850, "stayMin": 90, "cost": 400},
    {"id": "kyoto-2", "name": "伏見稲荷大社", "category": "sightseeing", "lat": 34.9671, "lng": 135.7727, "stayMin": 90, "cost": 0},
    {"id": "kyoto-3", "name": "金閣寺（鹿苑寺）", "category": "sightseeing", "lat": 35.0394, "lng": 135.7292, "stayMin": 60, "cost": 500},
    {"id": "kyoto-4", "name": "嵐山・竹林の小径", "category": "sightseeing", "lat": 35.0170, "lng": 135.6710, "stayMin": 90, "cost": 0},
    {"id": "kyoto-5", "name": "錦市場", "category": "food", "lat": 35.0050, "lng": 135.7649, "stayMin": 60, "cost": 1500},
    {"id": "kyoto-6", "name": "二条城", "category": "sightseeing", "lat": 35.0142, "lng": 135.7481, "stayMin": 90, "cost": 800},
    {"id": "kyoto-7", "name": "祇園・花見小路", "category": "sightseeing", "lat": 35.0037, "lng": 135.7752, "stayMin": 60, "cost": 0},
    {"id": "kyoto-8", "name": "茶寮都路里 祇園本店", "category": "food", "lat": 35.0039, "lng": 135.7745, "stayMin": 60, "cost": 1300},
]
plan = {
    "region": "京都", "customDest": None, "heroSeen": True, "startDate": "2026-10-10", "numDays": 2, "activeDay": 0,
    "days": [
        {"startTime": "09:00", "items": [{"spotId": "kyoto-2", "stayMin": 90, "cost": 0, "travelMin": 0}, {"spotId": "kyoto-5", "stayMin": 60, "cost": 1500, "travelMin": 20}, {"spotId": "kyoto-1", "stayMin": 90, "cost": 400, "travelMin": 25}], "hotel": None},
        {"startTime": "09:30", "items": [], "hotel": None},
    ],
    "customSpots": [], "transport": {"out": None, "ret": None}, "origin": None,
}
# 終わった旅（福岡）→ 履歴
p2 = api("POST", "/api/projects", {"plan": dict(plan, region="福岡", startDate="2026-05-02")})
api("POST", f"/api/projects/{p2['id']}/archive", {"places": [
    {"name": "一蘭 天神西通り店", "category": "food", "region": "福岡", "lat": 33.589, "lng": 130.397, "rating": 4.1, "ratingCount": 2300, "address": "福岡市中央区天神2丁目", "cost": 1200, "memo": "並ぶが回転は早い"},
    {"name": "太宰府天満宮", "category": "sightseeing", "region": "福岡", "lat": 33.521, "lng": 130.535, "rating": 4.5, "ratingCount": 18000, "address": "太宰府市宰府4丁目", "cost": 0},
    {"name": "ホテルニューオータニ博多", "category": "hotel", "region": "福岡", "cost": 15000},
], "totalCost": 42000})
api("POST", "/api/history/places", {"name": "錦市場", "category": "food", "region": "京都", "lat": 35.0050, "lng": 135.7649, "memo": "朝10時前が空いている", "rating": 4.2})
# 計画中の旅（京都）：絵馬3枚・案3つ・投票中
p = api("POST", "/api/projects", {"plan": plan})
pid, token = p["id"], p["shareToken"]
api("PATCH", f"/api/projects/{pid}", {"name": "秋の京都 作戦会議"})
for w in [
    {"nickname": "さとう", "vibes": ["グルメ", "のんびり"], "transport": "電車・バス", "budget": "1〜3万円", "places": "伏見稲荷、錦市場で食べ歩き", "avoid": "長い階段"},
    {"nickname": "たなか", "vibes": ["絶景・自然", "写真映え", "グルメ"], "transport": "電車・バス", "places": "嵐山の竹林", "foods": "抹茶パフェ", "must": "夜は鴨川を歩きたい"},
    {"nickname": "", "vibes": ["歴史・文化"], "transport": "徒歩中心", "freeText": "二条城は行ったことがないので入れてほしい"},
]:
    api("POST", f"/api/s/{token}/wishes", w)
gen = api("POST", f"/api/projects/{pid}/proposals/generate", {"candidates": KYOTO, "count": 3})
props = gen["proposals"]
api("PATCH", f"/api/projects/{pid}", {"status": "voting"})
api("POST", f"/api/s/{token}/vote", {"proposalId": props[0]["id"], "voterId": "seed-1", "nickname": "さとう"})
api("POST", f"/api/s/{token}/vote", {"proposalId": props[0]["id"], "voterId": "seed-2", "nickname": "たなか"})
api("POST", f"/api/s/{token}/vote", {"proposalId": props[1]["id"], "voterId": "seed-3", "nickname": "すずき"})
check("データ準備", len(props) == 3 and gen["source"] == "rules")

errors = []


def watch(page, tag=""):
    page.on("pageerror", lambda e: errors.append(tag + str(e)))
    page.on("console", lambda m: errors.append(tag + m.text) if m.type == "error" and "favicon" not in m.text and "net::ERR" not in m.text else None)


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 820}, device_scale_factor=1)
    page = ctx.new_page()
    watch(page)

    print("[1] ホーム（どこへ行きますか？＋これまでの旅）")
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_selector("#hero-screen:not([hidden])", timeout=15000)
    page.wait_for_selector("#hero-trips .project-card", timeout=10000)
    page.wait_for_timeout(600)
    check("ホーム＝ヒーロー表示", page.is_visible("#hero-screen"))
    check("これまでの旅 2件", page.locator("#hero-trips .project-card").count() == 2)
    check("人気の行き先カードあり", page.locator("#hero-region-cards .hero-card").count() >= 6)
    check("旅未選択なので✕は出ない", page.locator("#hero-close").get_attribute("hidden") is not None)
    page.screenshot(path=os.path.join(OUT, "v3_home.png"), full_page=True)

    print("[2] これまでの旅から開く → 計画画面")
    page.locator("#hero-trips .project-card", has_text="秋の京都 作戦会議").locator(".project-card-main").click()
    page.wait_for_selector("#hero-screen", state="hidden", timeout=10000)
    page.wait_for_timeout(1500)
    check("旅の名前がヘッダーに", page.input_value("#project-name-input") == "秋の京都 作戦会議")
    check("状態スタンプ=投票中", "投票中" in page.text_content("#project-status"))
    check("タイムラインに3件", page.locator("#timeline .tl-entry").count() == 3)
    check("保存状態の表示", "保存" in page.text_content("#save-status"))
    check("以前行った場所（錦市場）が候補下に出る", page.is_visible("#history-spots") and "錦市場" in page.text_content("#history-results"))
    page.screenshot(path=os.path.join(OUT, "v3_plan.png"))

    print("[3] 保存ボタン")
    page.fill("#day-start-time", "10:00")
    page.dispatch_event("#day-start-time", "change")
    page.wait_for_timeout(100)
    page.click("#save-btn")
    page.wait_for_selector("#hero-screen:not([hidden])", timeout=10000)
    page.wait_for_timeout(600)
    check("保存するとホームに戻る", page.is_visible("#hero-screen") and page.locator("#hero-trips .project-card.is-current").count() == 1)
    got = api("GET", f"/api/projects/{pid}")
    check("サーバーに反映", got["plan"]["days"][0]["startTime"] == "10:00")
    page.screenshot(path=os.path.join(OUT, "v3_saved_home.png"), full_page=True)
    page.locator("#hero-trips .project-card", has_text="秋の京都 作戦会議").locator(".project-card-main").click()
    page.wait_for_selector("#hero-screen", state="hidden", timeout=10000)
    page.wait_for_timeout(1000)
    check("カードからまた開ける（変更も残る）", page.input_value("#day-start-time") == "10:00" and "保存" in page.text_content("#save-status"))

    print("[4] みんなで決める")
    page.click('#mode-tabs [data-mode="collab"]')
    page.wait_for_selector("#collab-view:not([hidden])")
    page.wait_for_selector("#share-qr img", timeout=10000)
    page.wait_for_selector(".ema", timeout=10000)
    page.wait_for_timeout(800)
    check("絵馬3枚", page.locator(".ema").count() == 3)
    check("食べたいものが絵馬に出る", "抹茶パフェ" in page.text_content("#wish-board"))
    check("旅程案3枚", page.locator("#proposal-grid .proposal").count() == 3)
    check("1位の案に印", page.locator("#proposal-grid .proposal.leading").count() == 1)
    check("朱印3つ", page.locator("#proposal-grid .stamp").count() == 3)
    check("共有URLが /s/ を含む", "/s/" in page.input_value("#share-url"))
    page.screenshot(path=os.path.join(OUT, "v3_collab.png"), full_page=True)

    print("[5] 行った場所")
    page.click('#mode-tabs [data-mode="history"]')
    page.wait_for_selector(".history-card", timeout=10000)
    page.wait_for_timeout(500)
    check("履歴カード4件", page.locator(".history-card").count() == 4)
    check("おわった旅1件", page.locator(".trip-row").count() == 1)
    page.screenshot(path=os.path.join(OUT, "v3_history.png"), full_page=True)

    print("[6] 採用→日程に反映（みんなで決めるタブ）")
    page.click('#mode-tabs [data-mode="collab"]')
    page.wait_for_selector("#proposal-grid .proposal", timeout=10000)
    page.once("dialog", lambda d: d.accept())
    page.locator('#proposal-grid .proposal [data-act="adopt"]').first.click()
    page.wait_for_selector("#plan-view:not([hidden])", timeout=10000)
    page.wait_for_timeout(1200)
    check("採用後に日程が入る", page.locator("#timeline .tl-entry").count() >= 3)
    check("状態=行き先決定", "決定" in page.text_content("#project-status"))
    page.screenshot(path=os.path.join(OUT, "v3_plan_adopted.png"))

    print("[7] 新しい旅のウィザード（行き先→いつ行く→みんなの希望→旅程案→地図）")
    page.click("#home-btn")
    page.wait_for_selector("#hero-screen:not([hidden])", timeout=10000)
    page.wait_for_timeout(300)
    check("旅を開いているので✕あり", page.locator("#hero-close").get_attribute("hidden") is None)
    page.locator("#hero-region-cards .hero-card").first.click()  # 京都
    page.wait_for_selector("#wizard-screen:not([hidden])", timeout=10000)
    page.wait_for_timeout(500)
    check("ウィザード開始（いつ行く）", "いつ行きますか" in page.text_content("#wizard-title"))
    check("新しい旅が作られた", len(api("GET", "/api/projects")) == 3)
    import datetime as _dt
    d0 = _dt.date.today() + _dt.timedelta(days=20)   # 表示中の2ヶ月に必ず入る日
    d1 = d0 + _dt.timedelta(days=2)
    check("カレンダーが出る", page.locator("#wz-cal-months .drp-day[data-date]").count() >= 28)
    page.click(f'#wz-cal-months .drp-day[data-date="{d0.isoformat()}"]')
    page.wait_for_timeout(150)
    check("開始日を選ぶと終了待ち", "終了日" in page.text_content("#wz-range-days") and page.is_disabled("#wz-next"))
    page.click(f'#wz-cal-months .drp-day[data-date="{d1.isoformat()}"]')
    page.wait_for_timeout(150)
    check("終了日で3日間", "3日間" in page.text_content("#wz-range-days") and page.locator("#wz-cal-months .drp-day.in-range").count() == 1)
    page.screenshot(path=os.path.join(OUT, "v3_wizard_dates.png"))
    page.click("#wz-next")
    page.wait_for_selector("#wz-wish-form", timeout=10000)
    page.wait_for_selector("#wz-qr img", timeout=10000)
    page.wait_for_timeout(400)
    check("ステップ3：希望フォームとQR", page.is_visible("#wz-wish-form") and page.is_visible("#wz-qr img"))
    page.fill('#wz-wish-form input[name="nickname"]', "ぬし")
    page.click('#wz-wish-form .chip-set[data-multi="1"] .chip:has-text("グルメ")')
    page.fill('#wz-wish-form textarea[name="places"]', "伏見稲荷大社")
    page.fill('#wz-wish-form input[name="foods"]', "湯豆腐")
    page.screenshot(path=os.path.join(OUT, "v3_wizard_wishes.png"), full_page=True)
    page.click("#wz-next")
    page.wait_for_selector("#wz-proposals .proposal", timeout=60000)
    page.wait_for_timeout(500)
    check("ステップ4：案3つ", page.locator("#wz-proposals .proposal").count() == 3)
    check("絵馬が送られた", "行きたい場所" in page.text_content("#wz-proposals"))
    page.screenshot(path=os.path.join(OUT, "v3_wizard_proposals.png"), full_page=True)
    page.locator('#wz-proposals [data-act="adopt"]').first.click()
    page.wait_for_selector("#wizard-screen", state="hidden", timeout=15000)
    page.wait_for_timeout(1200)
    check("採用で計画画面へ", page.is_visible("#plan-view") and page.locator("#timeline .tl-entry").count() >= 2)
    check("新しい旅は行き先決定", "決定" in page.text_content("#project-status"))
    check("日程が反映", f"{d0.month}月{d0.day}日" in page.text_content("#date-field-start-value") and page.locator("#day-tabs .day-tab").count() == 3)
    page.screenshot(path=os.path.join(OUT, "v3_wizard_done.png"))

    print("[8] 参加者ページ（スマホ）")
    api("PATCH", f"/api/projects/{pid}", {"status": "collecting"})
    m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    mp = m.new_page()
    watch(mp, "share: ")
    mp.goto(f"{BASE}/s/{token}", wait_until="networkidle")
    mp.wait_for_selector("#wish-form", timeout=10000)
    mp.wait_for_timeout(500)
    check("絵馬フォーム表示", mp.is_visible("#wish-form") and "たびえま" in mp.text_content(".sh-brand"))
    mp.screenshot(path=os.path.join(OUT, "v3_share_form.png"), full_page=True)
    mp.fill('input[name="nickname"]', "やまだ")
    mp.click('.chip-set[data-multi="1"] .chip:has-text("温泉")')
    mp.fill('input[name="foods"]', "湯葉")
    mp.click('#wish-form button[type="submit"]')
    mp.wait_for_selector(".sh-thanks", timeout=10000)
    check("送信後に受付画面", "絵馬を掛けました" in mp.text_content(".sh-thanks"))
    api("PATCH", f"/api/projects/{pid}", {"status": "voting"})
    mp.goto(f"{BASE}/s/{token}", wait_until="networkidle")
    mp.wait_for_selector(".proposal", timeout=10000)
    mp.locator("[data-vote]").nth(2).click()
    mp.wait_for_selector(".proposal.mine", timeout=10000)
    mp.wait_for_timeout(600)
    check("投票できる", mp.locator(".proposal.mine").count() == 1)
    mp.screenshot(path=os.path.join(OUT, "v3_share_vote.png"), full_page=True)

    print("[9] スマホの本体画面")
    mp2 = m.new_page()
    watch(mp2, "mobile: ")
    mp2.goto(BASE + "/", wait_until="networkidle")
    mp2.wait_for_selector("#hero-screen:not([hidden])", timeout=10000)
    mp2.wait_for_timeout(800)
    mp2.screenshot(path=os.path.join(OUT, "v3_mobile_home.png"), full_page=True)
    mp2.locator("#hero-trips .project-card", has_text="秋の京都 作戦会議").locator(".project-card-main").click()
    mp2.wait_for_timeout(1500)
    check("スマホで横スクロールしない", mp2.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    mp2.screenshot(path=os.path.join(OUT, "v3_mobile_plan.png"))
    mp2.click("#home-btn")
    mp2.wait_for_selector("#hero-screen:not([hidden])", timeout=10000)
    mp2.locator("#hero-region-cards .hero-card").nth(1).click()  # 大阪
    mp2.wait_for_selector("#wz-next", timeout=10000)
    mp2.click("#wz-next")
    mp2.wait_for_selector("#wz-wish-form", timeout=10000)
    mp2.wait_for_timeout(600)
    check("スマホでもウィザードが横にあふれない", mp2.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    mp2.screenshot(path=os.path.join(OUT, "v3_mobile_wizard.png"), full_page=True)

    print("[10] ローカル保存モード（サーバーなしでも動く）")
    lctx = browser.new_context(viewport={"width": 1280, "height": 820})  # localStorage を共有しない新しいコンテキスト
    lp = lctx.new_page()
    watch(lp, "legacy: ")
    lp.route("**/api/info", lambda route: route.abort())
    lp.goto(BASE + "/", wait_until="networkidle")
    lp.wait_for_selector("#hero-screen:not([hidden])", timeout=10000)
    lp.wait_for_timeout(600)
    check("ローカル保存モードの表示", lp.is_visible("#offline-note"))
    check("これまでの旅は出ない", lp.locator("#hero-trips-section").get_attribute("hidden") is not None)
    lp.locator("#hero-region-cards .hero-card").first.click()
    lp.wait_for_selector("#wizard-screen:not([hidden])", timeout=10000)
    lp.wait_for_timeout(300)
    check("ローカル：日程ステップだけ", lp.locator("#wizard-steps li[data-step='3']").get_attribute("hidden") is not None)
    lp.click("#wz-next")
    lp.wait_for_selector("#wizard-screen", state="hidden", timeout=10000)
    check("ローカル：計画画面へ", lp.is_visible("#plan-view") and lp.locator("#mode-tabs").get_attribute("hidden") is not None)
    lp.click("#save-btn")
    lp.wait_for_selector("#hero-screen:not([hidden])", timeout=10000)
    lp.wait_for_timeout(400)
    check("ローカル：保存でホームへ・この端末の旅カード", lp.locator("#hero-trips .project-card").count() == 1 and "この端末に保存" in lp.text_content("#hero-trips"))
    lp.locator("#hero-trips .project-card-main").first.click()
    lp.wait_for_selector("#hero-screen", state="hidden", timeout=10000)
    check("ローカル：カードから計画画面に戻る", lp.is_visible("#plan-view"))
    # 2つ目の旅を作っても1つ目が残る
    lp.click("#home-btn")
    lp.wait_for_selector("#hero-screen:not([hidden])", timeout=10000)
    lp.locator("#hero-region-cards .hero-card").nth(1).click()  # 大阪
    lp.wait_for_selector("#wz-next", timeout=10000)
    lp.click("#wz-next")
    lp.wait_for_selector("#wizard-screen", state="hidden", timeout=10000)
    lp.click("#save-btn")
    lp.wait_for_selector("#hero-screen:not([hidden])", timeout=10000)
    lp.wait_for_timeout(400)
    names = lp.locator("#hero-trips .project-card-name").all_text_contents()
    check("ローカル：2つ目を保存しても1つ目が残る", len(names) == 2 and any("大阪" in n for n in names) and any("京都" in n for n in names))
    stored = lp.evaluate("JSON.parse(localStorage.getItem('travel-planner-local-trips-v1')).trips.length")
    check("ローカル：localStorage にも2件", stored == 2)
    lp.once("dialog", lambda d: d.accept())
    lp.locator("#hero-trips .project-card", has_text="京都").locator('[data-act="del"]').click()
    lp.wait_for_timeout(400)
    check("ローカル：カードを削除できる", lp.locator("#hero-trips .project-card").count() == 1 and "大阪" in lp.text_content("#hero-trips"))
    # 開いている（最後に作った）旅を削除しても「編集中」として残らない
    lp.once("dialog", lambda d: d.accept())
    lp.locator("#hero-trips .project-card", has_text="大阪").locator('[data-act="del"]').click()
    lp.wait_for_timeout(400)
    check("ローカル：開いている旅を削除しても残らない", lp.locator("#hero-trips .project-card").count() == 0 and lp.locator("#hero-trips .trips-empty").count() == 1)
    lp.click("#hero-close")
    lp.wait_for_selector("#hero-screen", state="hidden", timeout=10000)
    check("ローカル：削除後の計画画面は空", lp.locator("#timeline .tl-entry").count() == 0)
    lp.screenshot(path=os.path.join(OUT, "v3_legacy_home.png"), full_page=True)
    lp.screenshot(path=os.path.join(OUT, "v3_legacy.png"))

    browser.close()

check("JSエラーなし", len(errors) == 0)
for e in errors:
    print("   ERR:", e[:300])
print(f"\n合計: OK {ok} / NG {ng}")
sys.exit(1 if ng else 0)
