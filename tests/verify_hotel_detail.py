# ホテル詳細モーダル（一覧・泊カード・地図の🏨ピン）の実ブラウザ検証
# 使い方: .venv の python で実行（サーバーは 127.0.0.1:8123 で起動済みであること）
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8123"
SHOTS = r"C:\Users\imura-lab\myGoogleDrive\playgraund\travel_planner\tests\screenshots"

results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("  OK: " if cond else "  NG: ") + name)


def setup(p, keyless=False):
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, locale="ja-JP")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    if keyless:
        page.route("**/js/config.js", lambda route: route.fulfill(
            content_type="application/javascript",
            body='const CONFIG = { GOOGLE_MAPS_API_KEY: "" };'))
    page.goto(BASE, wait_until="domcontentloaded")
    page.evaluate("localStorage.clear()")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(3500)
    # 京都を選び、2日間（宿泊あり）にする
    page.locator(".hero-card", has_text="京都").first.click()
    page.wait_for_timeout(1500)
    # 宿泊ありにする（1泊2日）
    page.evaluate("if (state.days.length < 2) { state.days.push(newDay()); saveState(); renderAll(); }")
    page.wait_for_timeout(800)
    return browser, page, errors


def run(p, keyless=False):
    label = "キーなし" if keyless else "Googleモード"
    print(f"[{label}]")
    browser, page, errors = setup(p, keyless)

    # ---- ホテル一覧から詳細 ----
    page.click('.ptab[data-tab="hotels"]')
    page.wait_for_timeout(500)
    items = page.locator("#hotel-list li")
    check("ホテル一覧が出る", items.count() > 0)
    items.first.locator(".spot-info").click()
    page.wait_for_timeout(3000 if not keyless else 500)
    overlay = page.locator("#detail-overlay")
    check("一覧クリックで詳細モーダルが開く", overlay.is_visible())
    body = page.locator("#detail-content").inner_text()
    check("宿バッジが出る", page.locator("#detail-content .cat-hotel").count() == 1)
    check("料金が表示される", "1泊" in body or "料金未設定" in body)
    if not keyless:
        check("Googleの写真が出る", page.locator("#detail-content .detail-photos img").count() > 0)
        check("クチコミが出る", page.locator("#detail-content .detail-reviews .review").count() > 0)
        check("読み込み中のまま止まらない", "読み込み中" not in body)
    page.screenshot(path=f"{SHOTS}\\hotel_detail_list_{'keyless' if keyless else 'google'}_1280.png")
    page.click("#detail-close")
    page.wait_for_timeout(300)
    check("モーダルを閉じられる", not overlay.is_visible())

    # ---- 宿にする → 泊カードから詳細 ----
    hotel_name = items.first.locator(".spot-name").inner_text()
    items.first.locator(".add-spot-btn").click()
    page.wait_for_timeout(1200)
    check("泊カードに宿が入る", page.locator("#hotel-slot .hc-detail-btn").count() == 1)
    check("state.hotel に placeId 欄がある",
          page.evaluate("'placeId' in (state.days[0].hotel || {})"))
    page.locator("#hotel-slot .hc-detail-btn").click()
    page.wait_for_timeout(2500 if not keyless else 500)
    check("泊カードの宿名から詳細が開く", overlay.is_visible())
    check("同じ宿の詳細が開く", hotel_name.strip() in page.locator("#detail-content .detail-name").inner_text())
    page.screenshot(path=f"{SHOTS}\\hotel_detail_slot_{'keyless' if keyless else 'google'}_1280.png")
    page.click("#detail-close")
    page.wait_for_timeout(300)

    # ---- 地図の🏨ピンから詳細 ----
    page.evaluate("hideSpotMapPopup()")  # 直前の詳細で出たポップアップを閉じてからピンを押す
    page.wait_for_timeout(300)
    pin = page.locator(".hotel-marker")
    check("地図に宿ピンがある", pin.count() > 0)
    if pin.count() > 0:
        pin.first.click()
        page.wait_for_timeout(2500 if not keyless else 800)
        opener = page.locator(".spot-popup.spot-popup-open")
        check("宿ピンのポップアップに詳細動線が出る", opener.count() > 0)
        if opener.count() > 0:
            opener.first.click()
            page.wait_for_timeout(2500 if not keyless else 500)
            check("宿ピンから詳細モーダルが開く", overlay.is_visible())
            page.screenshot(path=f"{SHOTS}\\hotel_detail_pin_{'keyless' if keyless else 'google'}_1280.png")

    check("ページエラーなし", len(errors) == 0)
    if errors:
        print("    errors:", errors[:5])
    browser.close()


with sync_playwright() as p:
    run(p, keyless=False)
    run(p, keyless=True)

ng = [n for n, ok in results if not ok]
print(f"\n結果: {len(results) - len(ng)} 件成功 / {len(ng)} 件失敗")
for n in ng:
    print("  NG:", n)
sys.exit(1 if ng else 0)
