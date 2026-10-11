# 「このエリアの人気スポット」機能の実ブラウザ検証
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8123"
SHOTS = r"C:\Users\imura-lab\myGoogleDrive\playgraund\travel_planner\tests\screenshots"

results = []


def check(name, cond):
    results.append((name, bool(cond)))
    print(("  OK: " if cond else "  NG: ") + name)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # --- Googleモード ---
    print("[1] Googleモード：人気スポットの表示と追加")
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, locale="ja-JP")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.goto(BASE, wait_until="domcontentloaded")
    page.evaluate("localStorage.clear()")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(3500)

    # ヒーローから京都を選ぶ
    page.locator(".hero-card", has_text="京都").click()
    page.wait_for_timeout(4000)  # Nearby Search 2本の完了待ち

    check("人気スポット欄が表示される", page.locator("#popular-spots").is_visible())
    # サンプル候補が人気スポットに押し潰されず見えていること（レイアウト回帰の検知）
    check("サンプル候補8件が描画される", page.locator("#spot-list .spot-item").count() == 8)
    sl_h = page.evaluate("document.getElementById('spot-list').getBoundingClientRect().height")
    check("候補リストが潰れていない（高さ200px以上）", sl_h >= 200)
    first_spot_y = page.evaluate("document.querySelector('#spot-list .spot-item').getBoundingClientRect().y")
    pop_y = page.evaluate("document.getElementById('popular-spots').getBoundingClientRect().y")
    check("人気スポットは候補リストの下に並ぶ", first_spot_y < pop_y)
    rows = page.locator("#popular-results .place-result")
    n = rows.count()
    print(f"    人気スポット件数: {n}")
    check("人気スポットが出る（サンプル以外の候補が増えた）", n > 0)
    badges = page.locator("#popular-results .cat-badge").all_text_contents()
    check("観光とグルメの両方が出る", ("観光" in badges) and ("グルメ" in badges))
    check("評価（★）付きで表示される", page.locator("#popular-results .pr-rating").count() > 0)
    page.screenshot(path=f"{SHOTS}\\popular_kyoto_1280.png")

    # 候補に追加できる
    first_name = page.locator("#popular-results .pr-name").first.text_content()
    rows.first.locator(".add-spot-btn").click()
    page.wait_for_timeout(1200)
    check("「候補に追加」で追加済みになる",
          page.locator("#popular-results .add-spot-btn").first.text_content() == "追加済み")
    check("候補リスト（マイ追加）に入る", page.evaluate("state.customSpots.length") >= 1)

    # 絞り込みチップが人気スポットにも効く
    page.locator('#tab-spots .filter-btns .chip[data-filter="food"]').click()
    page.wait_for_timeout(600)
    badges2 = set(page.locator("#popular-results .cat-badge").all_text_contents())
    check("「グルメ」絞り込みでグルメのみになる", badges2 == {"グルメ"} or badges2 == set())
    page.locator('#tab-spots .filter-btns .chip[data-filter="all"]').click()
    page.wait_for_timeout(400)

    # 行クリック（スポット名）で詳細モーダルが開き、地図もそこへ移動する
    target = page.evaluate("popularResults[1]")  # 2行目（1行目は追加済み）
    page.locator("#popular-results .pr-info").nth(1).click()
    page.wait_for_timeout(2500)
    check("人気スポットの行クリックで詳細が開く", page.locator("#detail-overlay").is_visible())
    dn = page.locator(".detail-name").text_content() or ""
    check("詳細はクリックしたスポットのもの", target["name"] in dn)
    center = page.evaluate("TravelMap.getCenter()")
    moved = abs(center["lat"] - target["lat"]) < 0.02 and abs(center["lng"] - target["lng"]) < 0.02
    check("地図がそのスポットへ移動する", moved)
    # ピンの上にポップアップ（名称＋評価、詳細取得後に写真）が出る
    check("ピンにポップアップが出る", page.locator(".spot-popup").count() == 1)
    check("ポップアップに名称が出る",
          target["name"] in (page.locator(".spot-popup-name").first.text_content() or ""))
    page.wait_for_timeout(2000)
    check("ポップアップに写真が入る（詳細取得後）", page.locator(".spot-popup-photo").count() >= 1)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("モーダルを閉じてもポップアップは残る", page.locator(".spot-popup").count() == 1)
    page.screenshot(path=f"{SHOTS}\\popup_on_map_1280.png")
    # サンプル候補のカードクリックでも地図が移動し、ポップアップが切り替わる
    page.locator('#spot-list .spot-item[data-spot-id="kyoto-2"] .spot-info').click()  # 伏見稲荷
    page.wait_for_timeout(1500)
    c2 = page.evaluate("TravelMap.getCenter()")
    check("候補カードのクリックでも地図が移動する", abs(c2["lat"] - 34.9671) < 0.02 and abs(c2["lng"] - 135.7727) < 0.02)
    check("ポップアップが伏見稲荷に切り替わる",
          "伏見稲荷" in (page.locator(".spot-popup-name").first.text_content() or ""))
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    # ポップアップの✕で閉じられる
    page.locator(".spot-popup-close").click()
    page.wait_for_timeout(300)
    check("✕でポップアップが閉じる", page.locator(".spot-popup").count() == 0)

    # 地図のピンクリックでも同じポップアップが出る
    page.locator(".dot-marker").first.click()
    page.wait_for_timeout(1500)
    check("丸ピンのクリックでポップアップが出る", page.locator(".spot-popup").count() == 1)
    pin_name = (page.locator(".spot-popup-name").first.text_content() or "").strip()
    check("ピンのポップアップに名称が出る", len(pin_name) > 0)
    page.wait_for_timeout(2500)
    check("ピンのポップアップにも写真が入る", page.locator(".spot-popup-photo").count() >= 1)
    page.screenshot(path=f"{SHOTS}\\popup_from_pin_1280.png")
    # 日程に追加した番号ピンでも出る（開いているポップアップがピンに被るので先に閉じる）
    page.locator(".spot-popup-close").click()
    page.wait_for_timeout(300)
    page.evaluate("addToDay('kyoto-1')")  # 清水寺を1日目へ
    page.wait_for_timeout(800)
    page.locator(".num-marker").first.click()
    page.wait_for_timeout(1500)
    check("番号ピンのクリックでポップアップが出る（清水寺）",
          "清水寺" in (page.locator(".spot-popup-name").first.text_content() or ""))

    # 地図上の「この範囲の人気スポット」ボタンで更新できる
    check("更新ボタンは地図上にある", page.locator("#popular-map-btn").is_visible())
    check("左パネルに更新ボタンは無い", page.locator("#popular-refresh-btn").count() == 0)
    page.click("#popular-map-btn")
    page.wait_for_timeout(4000)
    check("範囲更新後も結果が出る", page.locator("#popular-results .place-result").count() > 0)

    # --- 任意行き先（雲仙市相当）での表示 ---
    print("[1b] 任意行き先（雲仙市）での表示")
    page.evaluate("applyDestination({ name: '雲仙市', lat: 32.8353, lng: 130.2571, placeId: 'test-unzen' })")
    page.wait_for_timeout(5000)  # 人気スポット＋宿の取得待ち
    check("空状態の点線枠が出ない（人気スポットが案内を兼ねる）",
          page.locator("#spot-list .spot-empty").count() == 0)
    check("人気スポットが出る（任意行き先）", page.locator("#popular-results .place-result").count() > 0)
    check("地図に候補ピン（丸ピン）が立つ", page.locator(".dot-marker").count() > 0)
    page.screenshot(path=f"{SHOTS}\\popular_unzen_spots_1280.png")
    # ホテルタブ：Places lodging の宿候補
    page.locator('.panel-tabs .ptab[data-tab="hotels"]').click()
    page.wait_for_timeout(600)
    check("宿候補が出る（Places lodging）",
          page.locator("#hotel-list .spot-item:not(.spot-empty)").count() > 0)
    check("料金未設定の表示がある", "料金未設定" in page.locator("#hotel-list").inner_text())
    page.screenshot(path=f"{SHOTS}\\popular_unzen_hotels_1280.png")
    # 交通タブ：出発地登録を促す案内
    page.locator('.panel-tabs .ptab[data-tab="transport"]').click()
    page.wait_for_timeout(400)
    check("交通に出発地登録の案内が出る", "出発地" in page.locator("#transport-out").inner_text())

    check("ページエラーなし（Google）", len(errors) == 0)
    if errors:
        print("    errors:", errors[:5])
    ctx.close()

    # --- キーなしモード ---
    print("[2] キーなしモード：人気スポット欄は出ない")
    ctx2 = browser.new_context(viewport={"width": 1280, "height": 800}, locale="ja-JP")
    page2 = ctx2.new_page()
    errors2 = []
    page2.on("pageerror", lambda e: errors2.append(str(e)))
    page2.route("**/js/config.js", lambda route: route.fulfill(
        content_type="application/javascript",
        body='const CONFIG = { GOOGLE_MAPS_API_KEY: "" };'))
    page2.goto(BASE, wait_until="domcontentloaded")
    page2.evaluate("localStorage.clear()")
    page2.reload(wait_until="domcontentloaded")
    page2.wait_for_timeout(2500)
    page2.locator(".hero-card", has_text="京都").click()
    page2.wait_for_timeout(1200)
    check("キーなしでは人気スポット欄が出ない", not page2.locator("#popular-spots").is_visible())
    check("キーなしでは地図上の更新ボタンも出ない", not page2.locator("#popular-map-btn").is_visible())
    check("ページエラーなし（キーなし）", len(errors2) == 0)
    ctx2.close()
    browser.close()

ng = [nm for nm, ok in results if not ok]
print(f"\n結果: {len(results) - len(ng)} 件成功 / {len(ng)} 件失敗")
sys.exit(1 if ng else 0)
