// 旅程プランナーのロジックをDOMスタブ上で動かすスモークテスト
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP_DIR = require("path").join(__dirname, "..");

// ---- 最小限のDOMスタブ ----
function stubElement() {
  const el = {
    innerHTML: "", textContent: "", value: "", className: "",
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {},
    setAttribute() {}, getAttribute() { return null; }, focus() {},
    querySelector() { return stubElement(); },
    querySelectorAll() { return []; }
  };
  return el;
}
const elements = {};
const sandbox = {
  console,
  document: {
    getElementById(id) { if (!elements[id]) elements[id] = stubElement(); return elements[id]; },
    createElement() { return stubElement(); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  },
  setTimeout() { return 0; },
  clearTimeout() {},
  requestAnimationFrame(cb) { cb(); },
  localStorage: {
    _s: {},
    getItem(k) { return this._s[k] || null; },
    setItem(k, v) { this._s[k] = v; },
    removeItem(k) { delete this._s[k]; }
  },
  alert(msg) { sandbox.__lastAlert = msg; },
  confirm() { return true; },
  Date, JSON, Math, Number, String, Array, Object, isNaN
  // L（Leaflet）は未定義のまま → オフライン分岐を通る
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APP_DIR, "js/data.js"), "utf8"), sandbox);
// index.html と同じ順（weather.js → app.js）。fetch 未定義のため天気は取得スキップの分岐を通る
vm.runInContext(fs.readFileSync(path.join(APP_DIR, "js/weather.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(APP_DIR, "js/app.js"), "utf8"), sandbox);

// ---- テスト ----
let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log("  OK:", name); }
  else { fail++; console.log("  NG:", name); }
}
function run(code) { return vm.runInContext(code, sandbox); }

console.log("[1] 初期状態");
assert("デフォルトは2日間", run("state.days.length") === 2);
assert("地域は京都", run("state.region") === "京都");

console.log("[2] スポット追加");
run("addToDay('kyoto-1'); addToDay('kyoto-2'); addToDay('kyoto-5')");
assert("1日目に3件追加された", run("state.days[0].items.length") === 3);
assert("追加済み判定が効く", run("isAdded('kyoto-1')") === true);
assert("未追加判定が効く", run("isAdded('kyoto-3')") === false);

console.log("[3] 時刻計算（9:00発, 各移動30分）");
// 追加時は距離から移動時間が見積もられるため、このテストでは30分に固定して計算だけ検証する
run("state.days[0].items.forEach(it => { it.travelMin = 30; })");
// 清水寺: 9:30着 + 滞在90分 = 11:00発 → 伏見稲荷: 11:30着
const sched = run("JSON.parse(JSON.stringify(computeSchedule(state.days[0])))");
assert("1件目の到着 9:30", sched[0].arrive === 570);
assert("1件目の出発 11:00", sched[0].depart === 660);
assert("2件目の到着 11:30", sched[1].arrive === 690);
assert("翌日跨ぎ表示", run("minToTime(1500)") === "翌1:00");

console.log("[4] 並び替え");
run("moveItem(0, 2, 0)"); // 3番目(錦市場)を先頭へ
assert("先頭が錦市場になった", run("state.days[0].items[0].spotId") === "kyoto-5");

console.log("[5] 費用合計");
// 錦市場1500 + 清水寺400 + 伏見稲荷0 = 1900
assert("1日目合計 1900円", run("dayTotal(state.days[0])") === 1900);
assert("スポット間の移動費が見積もられる", run("moveTotal()") > 0);
assert("全体合計 = スポット + 移動費", run("grandTotal()") === 1900 + run("moveTotal()"));

console.log("[6] 自作スポット");
run(`
  document.getElementById('custom-name').value = 'テスト食堂';
  document.getElementById('custom-category').value = 'food';
  document.getElementById('custom-stay').value = '45';
  document.getElementById('custom-cost').value = '1200';
  pickedLatLng = { lat: 35.0, lng: 135.75 };
  addCustomSpot();
`);
assert("自作スポットが登録された", run("state.customSpots.length") === 1);
assert("現在地域の一覧に出る", run("spotsForRegion().some(s => s.name === 'テスト食堂')") === true);
run("addToDay(state.customSpots[0].id)");
assert("自作スポットを日程に追加できる", run("state.days[0].items.length") === 4);
assert("費用に反映される", run("grandTotal()") === 3100 + run("moveTotal()"));
run("deleteCustomSpot(state.customSpots[0].id)");
assert("削除で日程からも消える", run("state.days[0].items.length") === 3);

console.log("[7] 日数変更（予定の退避）");
run("state.activeDay = 1; addToDay('kyoto-3'); setNumDays(1)");
assert("2日目の予定が1日目に移動", run("state.days[0].items.length") === 4);
assert("日数が1になった", run("state.days.length") === 1);
run("setNumDays(3)");
assert("3日に増やせる", run("state.days.length") === 3);

console.log("[8] 保存・復元");
const saved = run(`
  state.region = '大阪'; saveState();
  JSON.parse(localStorage.getItem('travel-planner-v1')).region
`);
assert("localStorageに保存される", saved === "大阪");
assert("復元できる", run("loadState().days[0].items.length") === 4);

console.log("[9] Google検索結果の追加");
run(`addPlaceAsSpot({
  name: 'テストラーメン', lat: 35.0, lng: 135.7, address: '京都市中京区',
  types: ['ramen_restaurant', 'restaurant'], rating: 4.2, ratingCount: 100
})`);
assert("customSpotsに登録される", run("state.customSpots.some(s => s.name === 'テストラーメン')") === true);
assert("カテゴリがグルメと判定される", run("state.customSpots.find(s => s.name === 'テストラーメン').category") === "food");
assert("候補リストに含まれる", run("spotsForRegion().some(s => s.name === 'テストラーメン')") === true);
assert("マイ追加フィルタ相当の抽出ができる", run("spotsForRegion().filter(s => s.isCustom).every(s => s.name === 'テストラーメン')") === true);
assert("観光地typesは観光と判定される", run("guessCategory(['tourist_attraction', 'temple'])") === "sightseeing");

console.log("[10] スポット詳細モーダル（Googleなし環境）");
run("openSpotDetail('kyoto-1')");
assert("モーダルが開く（hidden解除）", run("document.getElementById('detail-overlay').hidden") === false);
assert("スポット名が本文に入る", run("document.getElementById('detail-content').innerHTML").includes("清水寺"));
run("closeDetailModal()");
assert("閉じられる", run("document.getElementById('detail-overlay').hidden") === true);

console.log("[11] 宿泊・交通・費用内訳");
// 現在: region=大阪, days=3
run("state.activeDay = 0; setHotel(HOTEL_DATA['大阪'][0])"); // スイスホテル 20000円
assert("1日目に宿が設定される", run("state.days[0].hotel.name") === "スイスホテル南海大阪");
assert("宿泊費が合計に入る", run("hotelTotal()") === 20000);
run("state.activeDay = 2; setHotel(HOTEL_DATA['大阪'][4])"); // 最終日タブ → 前夜(2日目)に設定される
assert("最終日タブでは前夜の宿になる", run("state.days[1].hotel.name") === "カプセルホテル梅田");
assert("宿泊費合計 23500", run("hotelTotal()") === 23500);
run("selectTransport('out', TRANSPORT_DATA['大阪'][0]); selectTransport('ret', TRANSPORT_DATA['大阪'][2])");
assert("交通費合計 21000（新幹線+高速バス）", run("transportTotal()") === 21000);
assert("全体合計 = スポット+移動+宿泊+交通",
  run("grandTotal()") === run("spotTotal()") + run("moveTotal()") + 23500 + 21000);
run("state.transport.out.price = 10000");
assert("交通費の編集が反映される", run("transportTotal()") === 16500);
run("setNumDays(2)"); // 3日→2日: 2日目が最終日になり宿は消える
assert("日数減で最終日の宿が消える", run("state.days[1].hotel") === null);
assert("宿泊費が 20000 に戻る", run("hotelTotal()") === 20000);
run("removeHotel(0)");
assert("宿の解除ができる", run("hotelTotal()") === 0);
run("clearTransport('out'); clearTransport('ret')");
assert("交通の解除ができる", run("transportTotal()") === 0);

console.log("[12] 出発地と距離ベースの交通見積もり");
// 現在: region=大阪。出発地未設定ならプリセットが出る
assert("未設定時はプリセット", run("buildTransportOptions()[0].method") === "新幹線");
// 東京駅から大阪へ（直線約400km）
run("setOrigin({ name: '東京駅', lat: 35.6812, lng: 139.7671 })");
assert("出発地が登録される", run("state.origin.name") === "東京駅");
const dist = run("Math.round(distanceKm(state.origin, REGION_CENTER['大阪']))");
assert("直線距離が約400km（実測 " + dist + "km）", dist > 380 && dist < 420);
const opts = run("JSON.parse(JSON.stringify(buildTransportOptions()))");
assert("距離ベースの見積もりに切り替わる", opts.every((o) => o.note.includes("km")));
const shink = opts.find((o) => o.method === "新幹線・特急");
assert("新幹線の見積もりが現実的（1.2万〜1.6万円）", shink && shink.price >= 12000 && shink.price <= 16000);
assert("東京→大阪で飛行機も候補に出る", opts.some((o) => o.method === "飛行機"));
// 交通選択後に出発地を変えるとリセットされる
run("selectTransport('out', buildTransportOptions()[0])");
run("setOrigin({ name: '名古屋駅', lat: 35.1709, lng: 136.8815 })");
assert("出発地変更で交通選択がリセットされる", run("state.transport.out") === null);
// 沖縄は飛行機・フェリーのみ
run("state.region = '沖縄本島'");
const okiOpts = run("JSON.parse(JSON.stringify(buildTransportOptions()))");
assert("沖縄行きは飛行機/フェリーのみ", okiOpts.every((o) => o.method === "飛行機" || o.method === "フェリー"));
assert("沖縄行きに飛行機がある", okiOpts.some((o) => o.method === "飛行機"));
// 近距離では飛行機が出ない（名古屋→京都 約110km）
run("state.region = '京都'");
const kyoOpts = run("JSON.parse(JSON.stringify(buildTransportOptions()))");
assert("近距離では飛行機が候補から外れる", !kyoOpts.some((o) => o.method === "飛行機"));
// 出発地の解除でプリセットに戻る
run("clearOrigin()");
assert("解除でプリセットに戻る", run("buildTransportOptions()[0].note").includes("東京から"));

console.log("[13] 出発地・交通の日程への反映");
// region=京都（[12]の続き）。出発地と往復の交通を設定
run("setOrigin({ name: '東京駅', lat: 35.6812, lng: 139.7671 })");
run("selectTransport('out', buildTransportOptions()[0]); selectTransport('ret', buildTransportOptions()[0])");
assert("所要時間が保存される", run("state.transport.out.durationMin") > 0);
assert("アイコンが保存される", typeof run("state.transport.out.icon") === "string");
// 往路の所要時間ぶん、1日目の最初のスポット到着が遅れる
const base0 = run("computeSchedule(state.days[0], 0)[0].arrive");
const off = run("state.transport.out.durationMin");
assert("往路オフセットが時刻計算に反映される",
  run(`computeSchedule(state.days[0], ${off})[0].arrive`) === base0 + off);
assert("所要時間の整形（150分→2時間30分）", run("fmtDuration(150)") === "2時間30分");
assert("所要時間の整形（45分）", run("fmtDuration(45)") === "45分");
// renderAll がエラーなく通る（出発・復路カードの描画パス）
run("state.activeDay = 0; renderAll(); state.activeDay = state.days.length - 1; renderAll()");
assert("出発・復路カードを含む描画が通る", true);
// プリセット（出発地なし）でも durationMin を持つ
run("clearOrigin()");
assert("プリセットにも所要時間がある", run("buildTransportOptions().every(o => o.durationMin > 0)") === true);

console.log("[14] 精査で見つけた問題の修正検証");
assert("addedDayIndexが追加先の日を返す", run("addedDayIndex(state.days[0].items[0].spotId)") === 0);
assert("未追加スポットは-1", run("addedDayIndex('no-such-id')") === -1);
assert("計画に中身があると判定", run("planHasContent()") === true);
run("state.days[0].startTime = '08:30'; resetPlanForRegionChange()");
assert("地域変更リセットで日程・宿・交通が消える",
  run("state.days.every(d => d.items.length === 0 && d.hotel === null) && !state.transport.out && !state.transport.ret") === true);
assert("出発時刻・日数は保持される", run("state.days[0].startTime") === "08:30" && run("state.days.length") === 2);
assert("リセット後は中身なしと判定", run("planHasContent()") === false);
assert("timeToMin 空文字ガード", run("timeToMin('')") === 540);
assert("timeToMin 不正値ガード", run("timeToMin('ab:cd')") === 540);
// 旧データ移行：durationMin のない交通選択にプリセットから補完
run(`localStorage.setItem('travel-planner-v1', JSON.stringify({
  region: '京都', startDate: '2026-07-09', numDays: 2, activeDay: 0,
  days: [{ startTime: '09:00', items: [] }, { startTime: '09:00', items: [] }],
  customSpots: [],
  transport: { out: { method: '新幹線', price: 14000, note: 'x' }, ret: null }
}))`);
const mig = run("JSON.parse(JSON.stringify(loadState()))");
assert("旧交通データに所要時間を補完", mig.transport.out.durationMin === 135);
assert("旧交通データにアイコンを補完", mig.transport.out.icon === "train");
// 手入力の自作スポットはGoogle照会せず、その旨を表示
run("state.customSpots.push({ id: 'c-test', name: '実家', category: 'sightseeing', desc: '', lat: 35, lng: 135, stayMin: 60, cost: 0, region: state.region, isCustom: true }); openSpotDetail('c-test')");
assert("自作スポットの詳細が開く", run("document.getElementById('detail-overlay').hidden") === false);
assert("Google照会しない旨の文言が出る", run("document.getElementById('detail-content').innerHTML").includes("照会は行いません"));
run("closeDetailModal()");

console.log("[15] AIおすすめ順（ローカル最適化）");
// 移動時間の見積もり
assert("同一地点の移動は最小5分", run("estimateTravelMin({lat:35,lng:135},{lat:35,lng:135})") === 5);
assert("座標なしは既定の30分", run("estimateTravelMin(null, {lat:35,lng:135})") === 30);
const t13 = run("estimateTravelMin(findSpot('kyoto-1'), findSpot('kyoto-3'))");
assert("清水寺→金閣寺が現実的な移動時間（実測 " + t13 + "分）", t13 >= 25 && t13 <= 60);
// 食事時間帯ペナルティ
assert("グルメの昼どき到着はペナルティ0", run("mealPenalty(findSpot('kyoto-5'), 735)") === 0);
assert("グルメの15時到着はペナルティあり", run("mealPenalty(findSpot('kyoto-5'), 900)") > 0);
assert("観光スポットはペナルティなし", run("mealPenalty(findSpot('kyoto-1'), 900)") === 0);
// 並び替え本体：わざと非効率な順序で4件セット（錦市場のみグルメ）
run(`
  state.region = '京都';
  state.transport = { out: null, ret: null };
  state.activeDay = 0;
  state.days[0].startTime = '09:00';
  state.days[0].items = [
    { spotId: 'kyoto-3', stayMin: 60, cost: 500, travelMin: 30 },
    { spotId: 'kyoto-2', stayMin: 90, cost: 0, travelMin: 30 },
    { spotId: 'kyoto-5', stayMin: 60, cost: 1500, travelMin: 30 },
    { spotId: 'kyoto-1', stayMin: 90, cost: 400, travelMin: 30 }
  ];
`);
const evalCode = "evaluateOrder(state.days[0].items.map(it => ({ it, spot: findSpot(it.spotId) })), dayAnchor(0), dayStartMin(0)).cost";
const costBefore = run(evalCode);
run("applyAiOrder()");
const costAfter = run(evalCode);
// この配置（非効率な順序）では厳密に改善できるはず。≦にするとcost保存漏れのようなバグを見逃す
assert(`最適化でコストが厳密に下がる（${costBefore} → ${costAfter}）`, costAfter < costBefore);
assert("4件とも残っている", run("state.days[0].items.length") === 4);
assert("travelMinが5分単位で再計算される", run("state.days[0].items.every(it => it.travelMin >= 5 && it.travelMin % 5 === 0)") === true);
// グルメ（錦市場）が昼どき（11:00〜14:00）に配置される
const lunchArrive = run(`(() => {
  const sched = computeSchedule(state.days[0], 0);
  const i = state.days[0].items.findIndex(it => it.spotId === 'kyoto-5');
  return sched[i].arrive;
})()`);
assert("錦市場の到着が昼どき（実測 " + run(`minToTime(${lunchArrive})`) + "）", lunchArrive >= 660 && lunchArrive <= 840);
// 元に戻す
run("undoAiOrder()");
assert("元に戻すと順序が復元される", run("state.days[0].items.map(it => it.spotId).join()") === "kyoto-3,kyoto-2,kyoto-5,kyoto-1");
assert("元に戻しても区間情報が付与される", run("state.days[0].items.every(it => it.travel && it.travelMin > 0)") === true);
// ガード：2件未満は並び替えない
assert("2件未満はfalse", run("state.days[1].items = []; optimizeDayOrder(1)") === false);
// 前夜の宿があれば2日目の起点になる
run("state.days[0].hotel = { name: 'テスト宿', price: 10000, rating: 4, lat: 34.99, lng: 135.76 }");
assert("2日目の起点は前夜の宿", run("dayAnchor(1).name") === "テスト宿");
assert("1日目の起点は地域中心", run("dayAnchor(0).lat") === run("REGION_CENTER['京都'].lat"));

console.log("[16] スポット間の移動区間");
// 手段別の見積もり
assert("徒歩の料金は0円", run("estimateModeOption('walk', findSpot('kyoto-5'), findSpot('kyoto-8')).price") === 0);
assert("電車・バスは運賃概算が付く", run("estimateModeOption('transit', findSpot('kyoto-1'), findSpot('kyoto-3')).price") > 0);
assert("タクシーは電車・バスより高い",
  run("estimateModeOption('car', findSpot('kyoto-1'), findSpot('kyoto-3')).price")
  > run("estimateModeOption('transit', findSpot('kyoto-1'), findSpot('kyoto-3')).price"));
assert("近距離のおすすめは徒歩", run("defaultTravelMode(findSpot('kyoto-5'), findSpot('kyoto-8'))") === "walk");
assert("遠距離のおすすめは電車・バス", run("defaultTravelMode(findSpot('kyoto-1'), findSpot('kyoto-3'))") === "transit");
assert("座標なしは電車・バス扱い", run("defaultTravelMode(null, findSpot('kyoto-1'))") === "transit");
// 区間情報の付与（renderAll 経由の ensureSegmentTravels）
run(`
  state.activeDay = 0;
  state.days[0].items = [
    { spotId: 'kyoto-5', stayMin: 60, cost: 1500, travelMin: 30 },
    { spotId: 'kyoto-8', stayMin: 60, cost: 1300, travelMin: 30 },
    { spotId: 'kyoto-3', stayMin: 60, cost: 500, travelMin: 30 }
  ];
  renderAll();
`);
assert("全区間にtravelが付く", run("state.days[0].items.every(it => it.travel && it.travel.key)") === true);
assert("先頭区間のキーは地域中心から", run("state.days[0].items[0].travel.key") === "start:京都>kyoto-5");
assert("錦市場→都路里は徒歩になる", run("state.days[0].items[1].travel.mode") === "walk");
assert("都路里→金閣寺は電車・バスになる", run("state.days[0].items[2].travel.mode") === "transit");
assert("電車・バス区間に運賃が入る", run("state.days[0].items[2].travel.price") > 0);
assert("travelMinとtravel.minが同期する", run("state.days[0].items.every(it => it.travelMin === it.travel.min)") === true);
assert("移動費が全体合計に入る",
  run("grandTotal()") === run("spotTotal()") + run("moveTotal()") + run("hotelTotal()") + run("transportTotal()"));
// 手段の切り替え（好みに合わせて変更）
run("setSegmentMode(0, 1, 'car')");
assert("タクシーに切り替えられる",
  run("state.days[0].items[1].travel.mode") === "car" && run("state.days[0].items[1].travel.chosen") === true);
assert("切り替えで料金が変わる", run("state.days[0].items[1].travel.price") > 0);
// 手修正（source=manual）は再描画で上書きされない
run("state.days[0].items[1].travel.min = 99; state.days[0].items[1].travelMin = 99; state.days[0].items[1].travel.source = 'manual'; renderAll()");
assert("手修正が維持される", run("state.days[0].items[1].travelMin") === 99);
// 並び替えで区間が変わったら見積もり直す（変わらない区間は維持）
run("moveItem(0, 2, 0)"); // [錦, 都路里(手修正), 金閣] → [金閣, 錦, 都路里]
assert("並び替え後の先頭キーが更新される", run("state.days[0].items[0].travel.key") === "start:京都>kyoto-3");
assert("出発点が変わらない区間（錦→都路里）は手修正を維持", run("state.days[0].items[2].travelMin") === 99);
assert("出発点が変わった区間は再見積もり", run("state.days[0].items[1].travel.key") === "kyoto-3>kyoto-5");
// Routes API 取得結果の反映ロジック
run("applySegmentRoute(state.days[0].items[1], { min: 23, price: 230, lines: [{ name: '烏丸線', icon: 'subway' }] })");
assert("Google結果で時間・運賃が更新される",
  run("state.days[0].items[1].travel.min") === 23 && run("state.days[0].items[1].travelMin") === 23
  && run("state.days[0].items[1].travel.price") === 230);
assert("路線名が入る", run("state.days[0].items[1].travel.lines[0].name") === "烏丸線");
assert("sourceがgoogleになる", run("state.days[0].items[1].travel.source") === "google");
run("applySegmentRoute(state.days[0].items[0], null)");
assert("経路なしはnoRouteフラグで概算のまま", run("state.days[0].items[0].travel.noRoute") === true);
run("setSegmentMode(0, 0, 'car'); applySegmentRoute(state.days[0].items[0], { min: 33, km: 10, price: null, lines: [] })");
assert("車区間は実距離からタクシー料金を再計算",
  run("state.days[0].items[0].travel.price") === 4100 && run("state.days[0].items[0].travelMin") === 33);

console.log("[17] 出発地→現地の経路（玄関口経由）");
run("state.region = '京都'; state.transport = { out: null, ret: null }; setOrigin({ name: '東京駅', lat: 35.6812, lng: 139.7671 })");
const gopts = run("JSON.parse(JSON.stringify(buildTransportOptions()))");
assert("新幹線は京都駅着", (() => {
  const o = gopts.find((x) => x.id === "新幹線・特急@京都駅");
  return !!o && o.arrive.name === "京都駅" && o.legs.length === 1;
})());
assert("飛行機は伊丹経由と関空経由の2候補", gopts.filter((x) => x.method === "飛行機").length === 2);
const itami = gopts.find((x) => x.id === "飛行機@伊丹空港");
assert("伊丹経由はリムジンバスの乗り継ぎ付き", !!itami && itami.legs.length === 2 && itami.legs[1].method === "リムジンバス");
assert("合計時間・料金が乗り継ぎの和になる",
  !!itami && itami.durationMin === itami.legs[0].min + itami.legs[1].min
  && itami.price === itami.legs[0].price + itami.legs[1].price);
assert("伊丹経由の到着点は京都駅", !!itami && itami.arrive.name === "京都駅");
assert("候補が速い順に並ぶ", gopts.every((o, i) => i === 0 || gopts[i - 1].durationMin <= o.durationMin));
// 経路を選ぶと1日目の観光の起点が到着点（駅）になる
run("selectTransport('out', buildTransportOptions().find(x => x.id === '飛行機@伊丹空港'))");
assert("往路に経路の内訳が保存される", run("state.transport.out.legs.length") === 2 && run("state.transport.out.arrive.name") === "京都駅");
assert("1日目の起点が京都駅になる", run("Math.abs(dayAnchor(0).lat - 34.9858) < 1e-6") === true);
run("state.days[0].items = [{ spotId: 'kyoto-1', stayMin: 90, cost: 400, travelMin: 30 }]; renderAll()");
assert("先頭区間のキーに到着点が入る", run("state.days[0].items[0].travel.key") === "start:京都駅>kyoto-1");
// 到着点が変わると先頭区間が見積もり直される
const minViaKyotoSta = run("state.days[0].items[0].travelMin");
run("selectTransport('out', buildTransportOptions().find(x => x.id === '新幹線・特急@京都駅'))");
assert("経路を変えても到着点が同じなら先頭区間は同じ", run("state.days[0].items[0].travelMin") === minViaKyotoSta);
// 復路も同じ経路構造を持つ
run("selectTransport('ret', buildTransportOptions().find(x => x.id === '飛行機@関西空港'))");
assert("復路の帰り起点は京都駅", run("state.transport.ret.arrive.name") === "京都駅");
run("state.activeDay = state.days.length - 1; renderAll(); state.activeDay = 0; renderAll()");
assert("経路付きの出発・復路カードの描画が通る", true);
// プリセット（出発地なし）にも到着点が付く
run("clearOrigin()");
assert("プリセットの新幹線も京都駅着", run("buildTransportOptions()[0].arrive.name") === "京都駅");
assert("プリセットの飛行機は市街の駅まで含む到着点", run("buildTransportOptions().find(x => x.method === '飛行機').arrive.name") === "京都駅");

console.log("[18] 出発地からの経路を地図に表示");
run("setOrigin({ name: '東京駅', lat: 35.6812, lng: 139.7671 })");
run("selectTransport('out', buildTransportOptions().find(x => x.id === '飛行機@伊丹空港'))");
run("selectTransport('ret', buildTransportOptions().find(x => x.id === '新幹線・特急@京都駅'))");
assert("経路のlegsに座標が入る", run("state.transport.out.legs.every(l => l.toLat != null && l.toLng != null)") === true);
run("state.activeDay = 0");
const j0 = run("JSON.parse(JSON.stringify(buildJourneys()))");
assert("1日目は往路の経路が1本（最初のスポットへつなぐ）", j0.length === 1 && j0[0].attach === "before");
assert("往路は出発地→伊丹→京都駅の順", j0[0].points.map((p) => p.name).join(">") === "東京駅>伊丹空港>京都駅");
assert("出発地のマーカーは🏠", j0[0].points[0].emoji === "🏠");
assert("空港のマーカーは✈️", j0[0].points[1].emoji === "✈️");
run("state.activeDay = state.days.length - 1");
const j1 = run("JSON.parse(JSON.stringify(buildJourneys()))");
assert("最終日は復路の経路が1本（最後のスポットからつなぐ）", j1.length === 1 && j1[0].attach === "after");
assert("復路は京都駅→出発地の順", j1[0].points.map((p) => p.name).join(">") === "京都駅>東京駅");
run("setNumDays(1); state.activeDay = 0");
assert("日帰りは往路・復路の両方を表示", run("buildJourneys().length") === 2);
run("setNumDays(2)");
run("clearTransport('out'); clearTransport('ret')");
assert("交通未選択なら経路は出ない", run("buildJourneys().length") === 0);

console.log("[19] タイムラインのドラッグ＆ドロップ");
run(`
  state.activeDay = 0;
  state.days[0].items = [
    { spotId: 'kyoto-1', stayMin: 60, cost: 0, travelMin: 30 },
    { spotId: 'kyoto-2', stayMin: 60, cost: 0, travelMin: 30 },
    { spotId: 'kyoto-3', stayMin: 60, cost: 0, travelMin: 30 }
  ];
  // 疑似エントリ（高さ100pxで縦に並んでいる想定）
  __entries = [0, 1, 2].map((i) => ({
    style: {},
    classList: { add() {}, remove() {} },
    getBoundingClientRect() { return { top: i * 100, height: 100 }; }
  }));
  __origQSA = document.querySelectorAll;
  document.querySelectorAll = (sel) => (String(sel).includes('.tl-entry') ? __entries : []);
  onEntryDragStart({ dataTransfer: { setData() {} } }, __entries[0], 0);
`);
assert("ドラッグ開始でコンテキストが作られる", run("dragCtx.from") === 0 && run("dragCtx.others.length") === 2);
run("onTimelineDragOver({ preventDefault() {}, dataTransfer: {}, clientY: 160 })");
assert("2番目の中心を跨ぐと2番目が上にずれる", run("dragCtx.others[0].el.style.transform") === "translateY(-100px)");
assert("3番目はまだ動かない", run("dragCtx.others[1].el.style.transform") === "");
run("onTimelineDragOver({ preventDefault() {}, dataTransfer: {}, clientY: 260 })");
assert("さらに下へ動かすと3番目もずれる", run("dragCtx.others[1].el.style.transform") === "translateY(-100px)");
run("onTimelineDrop({ preventDefault() {} })");
assert("ドロップで先頭の項目が末尾に移動", run("state.days[0].items.map(it => it.spotId).join()") === "kyoto-2,kyoto-3,kyoto-1");
assert("ドロップ後にドラッグ状態が解放される", run("dragCtx") === null);
// 途中でキャンセル（dragend）した場合は順序が変わらない
run(`
  onEntryDragStart({ dataTransfer: { setData() {} } }, __entries[1], 1);
  onTimelineDragOver({ preventDefault() {}, dataTransfer: {}, clientY: 30 });
  clearDragState();
`);
assert("キャンセル時は順序が変わらずtransformも戻る",
  run("state.days[0].items.map(it => it.spotId).join()") === "kyoto-2,kyoto-3,kyoto-1"
  && run("__entries.every(e => e.style.transform === '')") === true);
run("document.querySelectorAll = __origQSA");

console.log("[20] 天気予報（WMOマッピング）");
assert("快晴(0)は☀", run("weatherCodeInfo(0).emoji") === "☀" && run("weatherCodeInfo(0).label") === "快晴");
assert("晴れ時々曇り(1,2)は🌤", run("weatherCodeInfo(1).emoji") === "🌤" && run("weatherCodeInfo(2).label") === "晴れ時々曇り");
assert("曇り(3)は☁", run("weatherCodeInfo(3).emoji") === "☁" && run("weatherCodeInfo(3).label") === "曇り");
assert("霧(45,48)は🌫", run("weatherCodeInfo(45).emoji") === "🌫" && run("weatherCodeInfo(48).emoji") === "🌫");
assert("雨(51-67,80-82)は🌧", [51, 61, 67, 80, 82].every((c) => run(`weatherCodeInfo(${c}).emoji`) === "🌧"));
assert("雪(71-77,85-86)は🌨", [71, 77, 85, 86].every((c) => run(`weatherCodeInfo(${c}).emoji`) === "🌨"));
assert("雷雨(95-99)は⛈", run("weatherCodeInfo(95).emoji") === "⛈" && run("weatherCodeInfo(99).label") === "雷雨");
assert("対応外コード(30)はnull", run("weatherCodeInfo(30)") === null);
assert("雨と雪の境界（68は対応外）", run("weatherCodeInfo(68)") === null);

console.log("[21] 天気予報（キャッシュ有効判定・3時間境界）");
run("__now = Date.now(); __cache = { region: '京都', lat: 35, lng: 135, fetchedAt: __now, daily: { time: [] } }");
assert("取得直後は有効", run("isWeatherCacheValid(__cache, '京都', __now)") === true);
assert("3時間未満（2:59:59経過）は有効", run("isWeatherCacheValid(__cache, '京都', __now + 3 * 3600 * 1000 - 1)") === true);
assert("ちょうど3時間経過で無効", run("isWeatherCacheValid(__cache, '京都', __now + 3 * 3600 * 1000)") === false);
assert("地域が違えば無効", run("isWeatherCacheValid(__cache, '大阪', __now)") === false);
assert("nullキャッシュは無効", run("isWeatherCacheValid(null, '京都', __now)") === false);
assert("dailyのないキャッシュは無効", run("isWeatherCacheValid({ region: '京都', fetchedAt: __now }, '京都', __now)") === false);
assert("fetchedAtが未来（時計ずれ）は無効", run("isWeatherCacheValid(__cache, '京都', __now - 1)") === false);
// 地域中心はスポット座標の平均
const kyotoCenter = run("JSON.parse(JSON.stringify(weatherRegionCenter('京都')))");
assert("京都の中心座標が妥当（緯度34.9〜35.1）", kyotoCenter.lat > 34.9 && kyotoCenter.lat < 35.1);
assert("京都の中心座標が妥当（経度135.6〜135.9）", kyotoCenter.lng > 135.6 && kyotoCenter.lng < 135.9);
assert("スポットのない地域はnull", run("weatherRegionCenter('存在しない地域')") === null);

console.log("[22] 天気予報（日付照合・16日境界）");
// 2026-07-12 から16日分の予報という体のダミーデータ
run(`
  __daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [] };
  for (let i = 0; i < 16; i++) {
    __daily.time.push(weatherDateStr('2026-07-12', i));
    __daily.weather_code.push(i === 0 ? 0 : 61);
    __daily.temperature_2m_max.push(30.4);
    __daily.temperature_2m_min.push(24.6);
    __daily.precipitation_probability_max.push(i === 1 ? 80 : 10);
  }
`);
assert("日付文字列の生成（+0日）", run("weatherDateStr('2026-07-12', 0)") === "2026-07-12");
assert("日付文字列の生成（月跨ぎ +20日）", run("weatherDateStr('2026-07-12', 20)") === "2026-08-01");
assert("不正な出発日はnull", run("weatherDateStr('', 0)") === null && run("weatherDateStr('abc', 0)") === null);
assert("初日の予報が引ける", run("weatherForDate(__daily, '2026-07-12').label") === "快晴");
assert("気温・降水確率が入る", run("weatherForDate(__daily, '2026-07-13').tmax") === 30.4
  && run("weatherForDate(__daily, '2026-07-13').pop") === 80);
assert("16日目（最終日）まで予報あり", run("weatherDateStatus(__daily, '2026-07-27')") === "ok");
assert("17日目はbeyond（予報まだなし）", run("weatherDateStatus(__daily, '2026-07-28')") === "beyond");
assert("過去日はnone（表示なし）", run("weatherDateStatus(__daily, '2026-07-11')") === "none");
assert("範囲外の日付はweatherForDateがnull", run("weatherForDate(__daily, '2026-07-28')") === null);
assert("dailyがnullならnone", run("weatherDateStatus(null, '2026-07-12')") === "none");

console.log("[23] 天気予報（表示反映とフォールバック）");
// fetch 未定義の環境でも renderWeather がエラーなく通る（＝オフラインで他機能を巻き込まない）
run("renderWeather()");
assert("fetchなし環境でも落ちない", true);
assert("データがない間はサマリー非表示", run("document.getElementById('weather-summary').hidden") === true);
// 予報データを直接持たせて描画（京都・出発日=ダミーデータの初日）
run(`
  state.region = '京都'; state.startDate = '2026-07-12'; state.activeDay = 0;
  weatherData = { region: '京都', lat: 35, lng: 135.75, fetchedAt: Date.now(), daily: __daily };
  applyWeatherUI();
`);
assert("サマリーが表示される", run("document.getElementById('weather-summary').hidden") === false);
assert("和名と最高/最低気温が入る", (() => {
  const html = run("document.getElementById('weather-summary').innerHTML");
  return html.includes("快晴") && html.includes("最高30°") && html.includes("最低25°");
})());
assert("降水確率10%は強調なし", !run("document.getElementById('weather-summary').innerHTML").includes("weather-pop-high"));
assert("ツールチップに取得元を明記", run("document.getElementById('weather-summary').title").includes("Open-Meteo"));
// 降水確率50%以上の日（2日目=80%）は強調クラスが付く
run("state.activeDay = 1; applyWeatherUI()");
assert("降水確率80%に強調クラスが付く", run("document.getElementById('weather-summary').innerHTML").includes("weather-pop-high"));
// 出発日が16日より先 → 「予報はまだありません」
run("state.startDate = '2026-07-28'; state.activeDay = 0; applyWeatherUI()");
assert("範囲外は案内文を表示", run("document.getElementById('weather-summary').innerHTML").includes("予報はまだありません"));
// 地域不一致（＝取得失敗や切替直後）ではUIを出さない
run("state.region = '大阪'; applyWeatherUI()");
assert("地域不一致では非表示", run("document.getElementById('weather-summary').hidden") === true);
run("state.region = '京都'; weatherData = null; applyWeatherUI()");
assert("データ破棄（取得失敗相当）で非表示", run("document.getElementById('weather-summary').hidden") === true);
// キャッシュはstateとは別キーに保存される（セーブデータ形式を変えない）
run(`
  saveWeatherCache({ region: '京都', lat: 35, lng: 135.75, fetchedAt: Date.now(), daily: __daily });
`);
assert("別キーtravel-planner-weather-v1に保存", run("JSON.parse(localStorage.getItem('travel-planner-weather-v1')).region") === "京都");
assert("セーブデータ本体に天気は入らない", !("weather" in JSON.parse(run("localStorage.getItem('travel-planner-v1')"))));
run("renderWeather()");
assert("有効なキャッシュから復元・表示される", run("document.getElementById('weather-summary').hidden") === false);
run("localStorage.removeItem('travel-planner-weather-v1'); weatherData = null");

// ---- 以降は非同期処理を含むテスト（地図上の検索）----
(async () => {

console.log("[24] 地図上の検索（app.js：状態遷移とAPI節約）");
// Leaflet時（TravelMap未定義）はUIを出さず、実行しても落ちない
run("setupMapSearch()");
assert("Leaflet時は検索UIを表示しない", run("document.getElementById('map-search').hidden") !== false);
await run("runMapSearch()");
assert("Leaflet時のrunMapSearchは何もしない", true);
// Googleモードのスタブを注入して状態遷移を検証
run(`
  __ms = { calls: [], pins: null, clears: 0, sig: 'sigA', viewportCb: null };
  TravelMap = {
    isGoogle: true,
    getBoundsSig() { return __ms.sig; },
    async searchPlaces(q, opts) {
      __ms.calls.push({ q, opts: opts || {} });
      return [
        { placeId: 'mp-1', name: '範囲内カフェ', lat: 35.01, lng: 135.76, address: '京都市中京区',
          types: ['cafe'], rating: 4.0, ratingCount: 12 },
        { placeId: 'mp-2', name: '範囲内神社', lat: 35.02, lng: 135.77, address: '京都市東山区',
          types: ['tourist_attraction'], rating: 4.5, ratingCount: 34 }
      ];
    },
    showSearchPins(rs) { __ms.pins = rs; },
    clearSearchPins() { __ms.clears++; __ms.pins = null; },
    highlightSearchPin() {},
    onSearchPinClick(cb) { __ms.pinCb = cb; },
    async getPlaceDetails() {
      __ms.detailCalls = (__ms.detailCalls || 0) + 1;
      return { photos: [], rating: 4.0, ratingCount: 12, summary: "テスト概要", address: "京都市",
        phone: "", website: "", mapsUrl: "", openingHours: [], reviews: [] };
    },
    onViewportChange(cb) { __ms.viewportCb = cb; },
    render() {}, flyTo() {}, panTo() {}
  };
  setupMapSearch();
`);
assert("Googleモードで検索UIが表示される", run("document.getElementById('map-search').hidden") === false);
assert("ビューポート変更の通知が登録される", run("typeof __ms.viewportCb") === "function");
// 検索実行：boundsオプション付きで呼ばれ、仮ピンが表示される
run("document.getElementById('map-search-input').value = 'カフェ'");
await run("runMapSearch()");
assert("searchPlacesが1回呼ばれる", run("__ms.calls.length") === 1);
assert("boundsオプションで範囲内検索になる", run("__ms.calls[0].opts.bounds") === true);
assert("検索キーワードが保持される", run("mapSearch.query") === "カフェ");
assert("検索時の範囲シグネチャが保持される", run("mapSearch.boundsSig") === "sigA");
assert("結果の仮ピンが表示される", run("__ms.pins && __ms.pins.length") === 2);
assert("検索直後は再検索ボタン非表示", run("document.getElementById('map-research-btn').hidden") === true);
// API節約：実行中・同一キーワード同一範囲の連打はスキップ
run("mapSearch.searching = true");
await run("runMapSearch()");
assert("実行中は二重実行しない", run("__ms.calls.length") === 1);
run("mapSearch.searching = false");
await run("runMapSearch()");
assert("同一キーワード・同一範囲の連打はスキップ", run("__ms.calls.length") === 1);
// 範囲移動 →「このエリアを検索」→ 再検索
run("__ms.viewportCb()");
assert("同一範囲のうちはボタンを出さない", run("document.getElementById('map-research-btn').hidden") === true);
run("__ms.sig = 'sigB'; __ms.viewportCb()");
assert("範囲が変わるとこのエリアを検索が出る", run("document.getElementById('map-research-btn').hidden") === false);
await run("runMapSearch()");
assert("再検索が実行される", run("__ms.calls.length") === 2);
assert("再検索後は新しい範囲シグネチャになる", run("mapSearch.boundsSig") === "sigB");
assert("再検索後はボタンが消える", run("document.getElementById('map-research-btn').hidden") === true);
// 結果→候補登録：左パネル検索と同じ変換で customSpots に入る
run("addPlaceAsSpot(__ms.pins[0])");
assert("地図検索の結果を候補に追加できる", run("state.customSpots.some(s => s.name === '範囲内カフェ')") === true);
assert("placeIdが引き継がれる", run("state.customSpots.find(s => s.name === '範囲内カフェ').placeId") === "mp-1");
assert("カテゴリが判定される（cafe→グルメ）", run("state.customSpots.find(s => s.name === '範囲内カフェ').category") === "food");
assert("候補リスト（現在地域）に現れる", run("spotsForRegion().some(s => s.name === '範囲内カフェ')") === true);
// 二重追加の防止：placeId照合で登録済みを検出する
assert("placeId照合で登録済みと判定される", run("isPlaceRegistered('mp-1')") === true);
assert("未登録・placeIdなしはfalse", run("isPlaceRegistered('mp-x')") === false && run("isPlaceRegistered(null)") === false);
const nSpots = run("state.customSpots.length");
run("addPlaceAsSpot(__ms.pins[0])"); // 再検索で出た同じ場所をもう一度追加しようとする
assert("同じ場所（同一placeId）は二重追加されない", run("state.customSpots.length") === nSpots);
// placeIdがnull同士（自作スポット等）は誤って重複扱いしない
run("addPlaceAsSpot({ placeId: null, name: 'ヌル一号', lat: 35.0, lng: 135.7, address: 'a', types: [] })");
run("addPlaceAsSpot({ placeId: null, name: 'ヌル二号', lat: 35.0, lng: 135.7, address: 'a', types: [] })");
assert("placeIdなし同士は重複扱いしない", run("state.customSpots.length") === nSpots + 2);
// 再検索の結果描画：登録済みの場所は最初から「追加済み」（disabled）で描画される
const createdEls = [];
const origCreate = sandbox.document.createElement;
sandbox.document.createElement = () => { const el = stubElement(); createdEls.push(el); return el; };
run("renderMapSearchResults(__ms.pins)");
run("renderPlaceResults(__ms.pins)"); // 左パネルの検索結果も同じ挙動
sandbox.document.createElement = origCreate;
const addBtns = createdEls.filter((el) => el.className === "add-spot-btn");
assert("登録済みの結果は最初から追加済み表示（地図・左パネル）", addBtns.length === 4
  && addBtns[0].textContent === "追加済み" && addBtns[0].disabled === true
  && addBtns[2].textContent === "追加済み" && addBtns[2].disabled === true);
assert("未登録の結果は候補に追加のまま", addBtns[1].textContent === "候補に追加" && !addBtns[1].disabled
  && addBtns[3].textContent === "候補に追加" && !addBtns[3].disabled);
// 結果ボトムシート：検索結果で開き、トグル（つまみのタップ相当）で畳める
assert("検索結果でシートが開く", run("mapSheet.state") === "open"
  && run("document.getElementById('map-results-sheet').hidden") === false);
assert("シートタイトルに検索語と件数が入る", (() => {
  const t = run("document.getElementById('map-sheet-title').textContent");
  return t.includes("カフェ") && t.includes("2件");
})());
run("toggleMapSheet()");
assert("トグルでつまみだけ（peek）になる", run("mapSheet.state") === "peek"
  && run("document.getElementById('map-results-sheet').hidden") === false);
run("toggleMapSheet()");
assert("再トグルで展開（open）に戻る", run("mapSheet.state") === "open");
// 全開（full）: 上に引っ張ると地図2:シート8まで広がる
run("setMapSheet('full')");
assert("全開（full）状態にできる", run("mapSheet.state") === "full"
  && run("document.getElementById('map-results-sheet').hidden") === false);
run("toggleMapSheet()");
assert("全開からのタップは半開（open）に戻る", run("mapSheet.state") === "open");
// シート内詳細：結果タップで詳細に切り替わり、戻るでリストに復帰する
await run("openMapSheetDetail(__ms.pins[1])");
assert("詳細表示でリストが隠れる", run("document.getElementById('map-search-results').hidden") === true
  && run("document.getElementById('map-sheet-detail').hidden") === false);
assert("詳細取得APIが1回呼ばれる", run("__ms.detailCalls") === 1);
assert("タイトルがスポット名になる", run("document.getElementById('map-sheet-title').textContent") === "範囲内神社");
await run("openMapSheetDetail(__ms.pins[1])");
assert("同じ場所の再表示はキャッシュでAPIを呼ばない", run("__ms.detailCalls") === 1);
run("backToMapResults()");
assert("戻るでリスト表示に復帰する", run("document.getElementById('map-search-results').hidden") === false
  && run("document.getElementById('map-sheet-detail').hidden") === true);
assert("戻るでタイトルが件数表示に戻る", run("document.getElementById('map-sheet-title').textContent").includes("2件"));
assert("Google詳細HTMLが組み立てられる", (() => {
  const h = run("buildGoogleDetailHtml({ photos: ['u'], rating: 4.5, ratingCount: 3, summary: '概要', address: '住所', phone: '', website: '', mapsUrl: '', openingHours: ['月: 9時'], reviews: [] })");
  return h.includes("detail-photos") && h.includes("★ 4.5") && h.includes("営業時間");
})());
// 仮ピンクリックでも詳細が開く。別の詳細を開いたまま押しても切り替わる
assert("仮ピンクリックの通知が登録される", run("typeof __ms.pinCb") === "function");
run("__ms.pinCb(0)");
assert("ピンクリックで詳細が開く", run("document.getElementById('map-sheet-detail').hidden") === false
  && run("document.getElementById('map-sheet-title').textContent") === "範囲内カフェ");
run("__ms.pinCb(1)");
assert("詳細表示中に別ピンを押すと切り替わる", run("document.getElementById('map-sheet-title').textContent") === "範囲内神社");
run("__ms.pinCb(99)");
assert("範囲外インデックスのピン通知は無視される", run("document.getElementById('map-sheet-title').textContent") === "範囲内神社");
// 詳細を開いたままクリアしても、次の検索でリスト表示から始まる
await run("openMapSheetDetail(__ms.pins[0])");
run("clearMapSearch()");
assert("クリアで詳細も閉じる", run("document.getElementById('map-sheet-detail').hidden") === true
  && run("document.getElementById('map-search-results').hidden") === false);
// クリアで仮ピン・結果・状態が消える（stateのセーブ形式には何も入らない）
run("clearMapSearch()");
assert("クリアで検索状態がリセットされる", run("mapSearch.query") === "" && run("mapSearch.boundsSig") === null);
assert("クリアで入力欄が空になる", run("document.getElementById('map-search-input').value") === "");
assert("クリアで結果リストが消える", run("document.getElementById('map-search-results').innerHTML") === "");
assert("クリアでシートも消える", run("mapSheet.state") === "hidden"
  && run("document.getElementById('map-results-sheet').hidden") === true);
assert("クリアで仮ピンが消える", run("__ms.clears") >= 1 && run("__ms.pins") === null);
assert("セーブデータに検索状態が入らない", (() => {
  const saved = JSON.parse(run("localStorage.getItem('travel-planner-v1')"));
  return !("mapSearch" in saved) && !("searchPins" in saved);
})());
// 全画面セットアップ：スタブ環境（requestFullscreen非対応）では何もせず落ちない
run("setupMapFullscreen()");
assert("全画面セットアップはスタブ環境でも落ちない", true);
assert("スタブ環境では全画面パネルモードにならない", run("isMapPanelMode()") === false);
// クリア後のビューポート変更ではボタンを出さない
run("__ms.sig = 'sigC'; __ms.viewportCb()");
assert("未検索状態ではボタンを出さない", run("document.getElementById('map-research-btn').hidden") === true);
// リセット操作でも地図上検索がクリアされる
run("document.getElementById('map-search-input').value = '寺'");
await run("runMapSearch()");
run("document.getElementById('reset-btn').onclick()");
assert("リセットで地図上検索もクリアされる", run("mapSearch.query") === "");
run("TravelMap = undefined"); // 後続テストのために元へ戻す

console.log("[25] 地図上の検索（map.js：bounds引き渡し・仮ピン）");
// Google Maps API をスタブした別サンドボックスで map.js を検証
function liveElement() {
  const el = stubElement();
  el._cls = new Set();
  el.classList = {
    add: (c) => el._cls.add(c),
    remove: (c) => el._cls.delete(c),
    toggle: (c, f) => { if (f) el._cls.add(c); else el._cls.delete(c); },
    contains: (c) => el._cls.has(c)
  };
  return el;
}
const gmRec = { search: null, markers: [], listeners: {} };
const fakeBounds = {
  toUrlValue() { return "34.9,135.6,35.1,135.9"; },
  getNorthEast() { return { lat: () => 35.1, lng: () => 135.9 }; }
};
class FakeMap {
  addListener(ev, cb) { gmRec.listeners[ev] = cb; }
  getCenter() { return { lat: () => 35.0, lng: () => 135.75 }; }
  getBounds() { return fakeBounds; }
}
class FakeInfoWindow {}
class FakeMarker {
  constructor(opts) { Object.assign(this, opts); gmRec.markers.push(this); }
  addEventListener() {}
}
const fakePlaces = [
  { id: "gp-1", displayName: "スタブ食堂", location: { lat: () => 35.01, lng: () => 135.76 },
    formattedAddress: "京都市中京区", types: ["restaurant"], rating: 4.1, userRatingCount: 55 },
  { id: "gp-2", displayName: "スタブ神社", location: { lat: () => 35.02, lng: () => 135.77 },
    formattedAddress: "京都市東山区", types: ["tourist_attraction"], rating: 4.6, userRatingCount: 210 }
];
const googleStub = {
  maps: {
    importLibrary: async (name) => {
      if (name === "maps") return { Map: FakeMap, InfoWindow: FakeInfoWindow };
      if (name === "places") return {
        Place: {
          searchByText: async (req) => { gmRec.search = req; return { places: fakePlaces }; },
          searchNearby: async (req) => { gmRec.nearby = req; return { places: fakePlaces }; }
        }
      };
      return {}; // marker ライブラリなど
    },
    marker: { AdvancedMarkerElement: FakeMarker }
  }
};
const mapSandbox = {
  console,
  CONFIG: { GOOGLE_MAPS_API_KEY: "test-key" }, // キーあり → Googleモードの分岐を通す
  google: googleStub,
  window: { google: googleStub },
  document: {
    getElementById() { return stubElement(); },
    createElement() { return liveElement(); },
    head: { appendChild() {} }
  },
  JSON, Math, String, Number, Array, Object, Promise, Set, Error, Date
};
vm.createContext(mapSandbox);
vm.runInContext(fs.readFileSync(path.join(APP_DIR, "js/map.js"), "utf8"), mapSandbox);
const TM = vm.runInContext("TravelMap", mapSandbox);
assert("APIキーありでGoogleモードになる", TM.isGoogle === true);
await TM.init({ lat: 35.0, lng: 135.75 }, 12, null);
// 既存呼び出し（boundsなし）：locationBias のまま
const r1 = await TM.searchPlaces("ラーメン");
assert("boundsなしはlocationBias（従来挙動）", !!gmRec.search.locationBias && gmRec.search.locationRestriction === undefined);
assert("最大8件を要求する", gmRec.search.maxResultCount === 8);
assert("rating付きフィールドを要求する", gmRec.search.fields.includes("rating"));
assert("結果が簡易オブジェクトに変換される", r1[0].name === "スタブ食堂" && r1[0].rating === 4.1 && r1[0].lat === 35.01);
// bounds指定：locationRestriction に表示範囲の矩形を渡す
await TM.searchPlaces("ラーメン", { bounds: true });
assert("bounds指定でlocationRestrictionに範囲を渡す", gmRec.search.locationRestriction === fakeBounds);
assert("bounds指定時はlocationBiasを付けない", gmRec.search.locationBias === undefined);
// basic指定は従来どおり（上位SKUフィールドなし）
await TM.searchPlaces("駅", { basic: true });
assert("basic指定はratingフィールドを要求しない", !gmRec.search.fields.includes("rating"));
assert("範囲シグネチャが取得できる", TM.getBoundsSig() === "34.9,135.6,35.1,135.9");
// 仮ピンの表示・強調・削除
const pinStart = gmRec.markers.length;
TM.showSearchPins(r1);
const pins = gmRec.markers.slice(pinStart);
assert("結果の数だけ仮ピンが立つ", pins.length === 2);
assert("仮ピンはA・Bのラベル", pins[0].content.textContent === "A" && pins[1].content.textContent === "B");
assert("仮ピンは専用クラス（番号ピンと区別）", pins.every((m) => m.content.className === "search-marker"));
TM.highlightSearchPin(1);
assert("リスト連動で対応ピンだけ強調される",
  pins[1].content.classList.contains("active") && !pins[0].content.classList.contains("active"));
TM.highlightSearchPin(-1);
assert("強調は解除できる", !pins[1].content.classList.contains("active"));
// 通常の再描画（render）では仮ピンは消えない／clearSearchPinsで消える
TM.render([], [], null, [], null);
assert("再描画しても仮ピンは残る", pins.every((m) => m.map !== null));
TM.clearSearchPins();
assert("clearSearchPinsで仮ピンが地図から外れる", pins.every((m) => m.map === null));
// ビューポート変更通知は idle イベントに登録される
let vpCalled = false;
TM.onViewportChange(() => { vpCalled = true; });
gmRec.listeners.idle();
assert("idleイベントで通知される", vpCalled === true);

// ---- map.js: 全国検索と行き先写真 ----
console.log("[TM+] 全国検索（national）と行き先写真");
await TM.searchPlaces("金沢", { basic: true, national: true });
assert("national指定はバイアスも範囲制限も付けない",
  gmRec.search.locationBias === undefined && gmRec.search.locationRestriction === undefined);
const noPhoto = await TM.getDestinationPhoto({ query: "金沢" });
assert("写真のない行き先は null", noPhoto === null);
fakePlaces[0].photos = [{ getURI: (o) => `https://photo.example/1?w=${o.maxWidth}` }];
const photoUrl = await TM.getDestinationPhoto({ query: "スタブ食堂" });
assert("先頭写真のURL（maxWidth=800）が取れる", photoUrl === "https://photo.example/1?w=800");
delete fakePlaces[0].photos;

// ---- map.js: エリアの人気スポット検索 ----
console.log("[TM+] エリアの人気スポット検索");
const pop = await TM.searchPopularSpots({ food: false });
assert("観光はtourist_attractionタイプで検索", gmRec.nearby.includedPrimaryTypes.includes("tourist_attraction"));
assert("表示範囲から半径を計算（0〜50km）",
  gmRec.nearby.locationRestriction.radius > 0 && gmRec.nearby.locationRestriction.radius <= 50000);
assert("人気スポットも簡易オブジェクトに変換される", pop[0].name === "スタブ食堂" && pop[0].rating === 4.1);
await TM.searchPopularSpots({ food: true, center: { lat: 36.5, lng: 136.6 }, radius: 5000 });
assert("グルメはrestaurantタイプで検索", gmRec.nearby.includedPrimaryTypes.includes("restaurant"));
assert("中心・半径の指定が表示範囲より優先される",
  gmRec.nearby.locationRestriction.radius === 5000 && gmRec.nearby.locationRestriction.center.lat === 36.5);
await TM.searchPopularSpots({ types: ["lodging"] });
assert("types指定（lodging＝宿検索）が優先される", gmRec.nearby.includedPrimaryTypes.includes("lodging"));

// ---- map.js: スポットポップアップ（写真＋名称＋評価） ----
console.log("[TM+] スポットポップアップ");
const pinsBefore2 = gmRec.markers.length;
TM.showSpotPopup({ lat: 35.0, lng: 135.75, name: "テスト茶屋", rating: 4.2, ratingCount: 12, photoUrl: "https://p.example/1.jpg" });
assert("ポップアップのマーカーが立つ", gmRec.markers.length === pinsBefore2 + 1);
const popup1 = gmRec.markers[gmRec.markers.length - 1];
assert("ラッパーは spot-popup-wrap", popup1.content.className === "spot-popup-wrap");
assert("名称・評価・写真がHTMLに入る",
  popup1.content.innerHTML.includes("テスト茶屋")
  && popup1.content.innerHTML.includes("★ 4.2")
  && popup1.content.innerHTML.includes("https://p.example/1.jpg"));
TM.showSpotPopup({ lat: 35.01, lng: 135.76, name: "二個目" });
assert("新しいポップアップを出すと前のは消える（常に1つ）", popup1.map === null);
const popup2 = gmRec.markers[gmRec.markers.length - 1];
assert("写真なしでも名称は出る", popup2.content.innerHTML.includes("二個目") && !popup2.content.innerHTML.includes("spot-popup-photo\" src"));
TM.hideSpotPopup();
assert("hideSpotPopup で消える", popup2.map === null);

// ---- app.js: 行き先の全国対応（customDest） ----
console.log("[APP+] 行き先の全国対応（customDest）");
run("localStorage.removeItem(STORAGE_KEY); state = defaultState();");
assert("初期状態は customDest なし", run("state.customDest") === null);
assert("初期状態は heroSeen false（ヒーロー画面を出す）", run("state.heroSeen") === false);
assert("destCenter はサンプル地域の中心", run("destCenter().lat === REGION_CENTER['京都'].lat") === true);
// 任意行き先へ変更（confirmスタブは常にtrue）
run("applyDestination({ name: '金沢', lat: 36.5613, lng: 136.6562, placeId: 'gp-kanazawa' })");
assert("customDest が設定される", run("state.customDest && state.customDest.name") === "金沢");
assert("region は行き先名になる", run("state.region") === "金沢");
assert("行き先を選ぶと heroSeen が立つ", run("state.heroSeen") === true);
assert("destCenter は選択座標になる", Math.abs(run("destCenter().lat") - 36.5613) < 1e-9);
assert("destCenter のズームは12", run("destCenter().zoom") === 12);
assert("サンプルスポット一覧は空になる", run("spotsForRegion().length") === 0);
assert("天気の座標も選択座標を使う", Math.abs(run("weatherRegionCenter(state.region).lat") - 36.5613) < 1e-9);
// 出発地があれば距離ベースの交通候補が組める（玄関口なし→中心座標が到着点）
run("state.origin = { name: '大阪駅', lat: 34.7025, lng: 135.4959 };");
assert("任意行き先でも交通候補が出る", run("buildTransportOptions().length") > 0);
assert("交通候補の到着点は行き先中心", run("buildTransportOptions()[0].arrive.name") === "金沢");
// サンプル地域に戻すと customDest が消える
run("applyDestination({ region: '東京' })");
assert("サンプル地域に戻せる", run("state.region") === "東京" && run("state.customDest") === null);
// 旧保存データ（customDest/heroSeen未定義）の補完
run("saveState(); const _old = JSON.parse(localStorage.getItem(STORAGE_KEY)); delete _old.customDest; delete _old.heroSeen; localStorage.setItem(STORAGE_KEY, JSON.stringify(_old)); state = loadState();");
assert("旧データは customDest=null に補完", run("state.customDest") === null);
assert("旧データは heroSeen=true に補完（ヒーローを出さない）", run("state.heroSeen") === true);
// 任意行き先の保存→復元
run("applyDestination({ name: '草津温泉', lat: 36.6228, lng: 138.5963, placeId: 'gp-kusatsu' }); state = loadState();");
assert("任意行き先が復元される", run("state.customDest && state.customDest.name") === "草津温泉");
assert("復元後の destCenter も選択座標", Math.abs(run("destCenter().lat") - 36.6228) < 1e-9);

console.log(`\n結果: ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail > 0 ? 1 : 0);

})().catch((e) => { console.error(e); process.exit(1); });
