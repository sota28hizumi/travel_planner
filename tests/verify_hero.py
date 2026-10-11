# フェーズ1（行き先全国化＋ヒーロー画面）の実ブラウザ検証
# 使い方: .venv の python で実行（サーバーは 127.0.0.1:8123 で起動済みであること）
#   Google モード: 実キー（config.js）で検証
#   キーなしモード: config.js をルートインターセプトで空キーに差し替えて検証
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8123"
SHOTS = r"C:\Users\imura-lab\myGoogleDrive\playgraund\travel_planner\tests\screenshots"

results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("  OK: " if cond else "  NG: ") + name)


def run_google_mode(p):
    print("[1] Googleモード（実キー）")
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, locale="ja-JP")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE, wait_until="domcontentloaded")
    page.evaluate("localStorage.clear()")  # 初回状態（ヒーロー表示条件）にする
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(4000)  # Googleスクリプト・写真の読み込み待ち

    # ヒーロー画面が出る
    hero = page.locator("#hero-screen")
    check("初回はヒーロー画面が表示される", hero.is_visible())
    check("Googleモードでは全国検索欄が出る", page.locator("#hero-search").is_visible())
    check("キーなし案内は出ない", not page.locator("#hero-keyless-note").is_visible())
    cards = page.locator(".hero-card")
    n_regions = page.evaluate("Object.keys(SPOT_DATA).length")
    check("行き先カードがサンプル地域数と同じ", cards.count() == n_regions)
    page.wait_for_timeout(3000)  # 写真の非同期差し込み待ち
    with_photo = page.locator(".hero-card.has-photo").count()
    print(f"    写真が入ったカード: {with_photo}/{n_regions}")
    check("写真が1枚以上入る（Places写真取得）", with_photo >= 1)
    page.screenshot(path=f"{SHOTS}\\hero_google_1280.png")

    # 全国検索 → 金沢を選ぶ
    page.fill("#hero-dest-query", "金沢")
    page.click("#hero-search-btn")
    page.wait_for_timeout(3000)
    rs = page.locator(".hero-result")
    check("検索結果が出る", rs.count() >= 1)
    page.screenshot(path=f"{SHOTS}\\hero_google_search_1280.png")
    rs.first.click()
    page.wait_for_timeout(2500)
    check("選択後ヒーローが閉じる", not hero.is_visible())
    sel_text = page.locator("#region-select option:checked").text_content()
    print(f"    行き先セレクト: {sel_text}")
    check("行き先セレクトに選んだ行き先が出る", "金沢" in (sel_text or ""))
    check("スポットタブは空でも壊れない", page.locator("#spot-list").count() == 1)
    check("任意行き先用の空状態案内が出る", page.locator("#spot-list .spot-empty-dest").count() == 1)
    page.screenshot(path=f"{SHOTS}\\hero_google_selected_1280.png")

    # 状態の中身（customDest・天気座標）
    dest = page.evaluate("state.customDest")
    check("customDest が保存される", dest and abs(dest["lat"] - 36.56) < 0.5)
    center = page.evaluate("destCenter()")
    check("destCenter が選択座標", center and abs(center["lat"] - dest["lat"]) < 1e-6)

    # セレクトからサンプル地域に戻す（confirmは自動承諾）
    page.on("dialog", lambda d: d.accept())
    page.select_option("#region-select", "京都")
    page.wait_for_timeout(1500)
    check("サンプル地域に戻すと customDest が消える", page.evaluate("state.customDest") is None)
    check("京都のスポットが出る", page.locator("#spot-list .spot-card, #spot-list li").count() > 0)

    # セレクトの「全国から探す」でヒーロー再表示
    page.select_option("#region-select", "__search__")
    page.wait_for_timeout(800)
    check("「全国から探す」でヒーローが再表示される", hero.is_visible())
    sel_text2 = page.locator("#region-select option:checked").text_content()
    check("セレクト表示は現在の行き先のまま", "京都" in (sel_text2 or ""))
    page.click("#hero-close")
    page.wait_for_timeout(500)
    check("✕でヒーローが閉じる", not hero.is_visible())

    # モバイル幅
    page.set_viewport_size({"width": 375, "height": 740})
    page.evaluate("localStorage.clear()")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    check("モバイルでもヒーローが出る", page.locator("#hero-screen").is_visible())
    page.screenshot(path=f"{SHOTS}\\hero_google_375.png")

    check("ページエラーなし（Google）", len(errors) == 0)
    if errors:
        print("    errors:", errors[:5])
    browser.close()


def run_keyless_mode(p):
    print("[2] キーなしモード（config.jsを空キーに差し替え）")
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, locale="ja-JP")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/js/config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body='const CONFIG = { GOOGLE_MAPS_API_KEY: "" };'))
    page.goto(BASE, wait_until="domcontentloaded")
    page.evaluate("localStorage.clear()")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(3000)

    hero = page.locator("#hero-screen")
    check("キーなしでもヒーローが出る", hero.is_visible())
    check("全国検索欄は出ない", not page.locator("#hero-search").is_visible())
    check("キーなし案内が出る", page.locator("#hero-keyless-note").is_visible())
    n_regions = page.evaluate("Object.keys(SPOT_DATA).length")
    check("グラデーションカードがサンプル地域数と同じ", page.locator(".hero-card").count() == n_regions)
    opts = page.locator("#region-select option").all_text_contents()
    check("セレクトに「全国から探す」が無い", not any("全国" in o for o in opts))
    page.screenshot(path=f"{SHOTS}\\hero_keyless_1280.png")

    # カードから札幌・小樽を選ぶ
    page.locator(".hero-card", has_text="札幌・小樽").click()
    page.wait_for_timeout(1500)
    check("カード選択でヒーローが閉じる", not hero.is_visible())
    check("行き先が札幌・小樽になる", page.evaluate("state.region") == "札幌・小樽")
    check("スポット一覧が出る", page.locator("#spot-list li").count() > 0)
    page.screenshot(path=f"{SHOTS}\\hero_keyless_selected_1280.png")

    # リロードしてもヒーローは出ない（heroSeen）
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(2000)
    check("一度選んだらリロードで出ない", not page.locator("#hero-screen").is_visible())

    # リセットでヒーローが戻る
    page.on("dialog", lambda d: d.accept())
    page.click("#reset-btn")
    page.wait_for_timeout(1000)
    check("リセットでヒーローが再表示される", page.locator("#hero-screen").is_visible())

    check("ページエラーなし（キーなし）", len(errors) == 0)
    if errors:
        print("    errors:", errors[:5])
    browser.close()


with sync_playwright() as p:
    run_google_mode(p)
    run_keyless_mode(p)

ng = [n for n, ok in results if not ok]
print(f"\n結果: {len(results) - len(ng)} 件成功 / {len(ng)} 件失敗")
if ng:
    for n in ng:
        print("  NG:", n)
sys.exit(1 if ng else 0)
