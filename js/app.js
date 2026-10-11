// ============================================================
// 旅程プランナー 本体ロジック
// 状態は localStorage に自動保存され、次回開いたときに復元される
// ============================================================

const STORAGE_KEY = "travel-planner-v1";

// ---------- 状態 ----------
function defaultState() {
  // ローカル日付で今日を作る（toISOString はUTC基準のため深夜に前日になる）
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    region: "京都",
    // サンプル7地域以外の行き先（Google検索で選択）。{ name, lat, lng, placeId, photoUrl }
    // 設定時は region に name が入り、サンプルデータの参照は空振り（|| []）になる
    customDest: null,
    heroSeen: false, // 行き先選択のヒーロー画面を済ませたか（リセットで戻る）
    startDate: today,
    numDays: 2,
    activeDay: 0, // 表示中の日（0始まり）
    // days[i] = { startTime, items: [{ spotId, stayMin, cost, travelMin }], hotel }
    // travelMin は「前の場所からこの場所への移動時間（分）」
    // hotel はその日の夜に泊まる宿 { name, price, rating, lat, lng }（最終日は使わない）
    days: [newDay(), newDay()],
    customSpots: [], // 自分で追加したスポット { id, name, category, desc, lat, lng, stayMin, cost, region }
    transport: { out: null, ret: null }, // 往路・復路 { method, price, note }
    origin: null // 出発地 { name, lat, lng }（座標があれば距離から金額を見積もる）
  };
}
function newDay() {
  return { startTime: "09:00", items: [], hotel: null };
}

let state = loadState();

// スポット一覧の絞り込み条件（保存はしない）
let filter = { text: "", category: "all" };
// 地図クリックで位置指定するモードかどうか
let pickingLocation = false;
let pickedLatLng = null;

// ---------- 保存・復元 ----------
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    // サーバーモードでは開いているプロジェクトにも保存する（projects.js。デバウンスあり）
    if (typeof Projects !== "undefined" && Projects.onStateSaved) Projects.onStateSaved();
  } catch (e) {
    // 容量超過・プライベートモード等で保存できなくても操作は続行する
    console.error(e);
    if (typeof showSnackbar === "function") showSnackbar("保存に失敗しました（変更は保持されない可能性があります）");
  }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch (e) {
    return defaultState();
  }
}
// 保存データ（localStorage／サーバーのプロジェクト）を描画できる形に整える。
// 旧バージョン・不正なデータは補完し、形が壊れていれば初期状態に戻す
function normalizeState(s) {
  try {
    if (!s || !s.days || !Array.isArray(s.days) || s.days.length === 0) return defaultState();
    // 旧バージョン・不正な保存データを補完（描画中に落ちないよう形を整える）
    if (!s.transport) s.transport = { out: null, ret: null };
    if (s.origin === undefined) s.origin = null;
    if (s.customDest === undefined) s.customDest = null;
    if (s.heroSeen === undefined) s.heroSeen = true; // 旧データは計画済みとみなしヒーローを出さない
    if (!Array.isArray(s.customSpots)) s.customSpots = [];
    s.days.forEach((d) => {
      if (d.hotel === undefined) d.hotel = null;
      if (typeof d.startTime !== "string") d.startTime = "09:00";
      if (!Array.isArray(d.items)) d.items = [];
    });
    s.numDays = s.days.length;
    // activeDay を 0〜days.length-1 に収める（数値でなければ0）
    const ad = Number(s.activeDay);
    s.activeDay = Number.isInteger(ad) ? Math.min(Math.max(ad, 0), s.days.length - 1) : 0;
    // 旧データの交通選択に所要時間・アイコンがない場合はプリセットから補う
    ["out", "ret"].forEach((dir) => {
      const t = s.transport[dir];
      if (t && t.durationMin === undefined) {
        const preset = (TRANSPORT_DATA[s.region] || []).find((p) => p.method === t.method);
        t.durationMin = preset ? preset.durationMin : 0;
        if (!t.icon) t.icon = preset ? preset.icon : "commute";
      }
    });
    return s;
  } catch (e) {
    return defaultState();
  }
}

// ---------- スポット検索 ----------
// 全地域＋自作スポットから id で探す（地域を切り替えても日程が壊れないように）
function findSpot(id) {
  for (const region of Object.keys(SPOT_DATA)) {
    const hit = SPOT_DATA[region].find((s) => s.id === id);
    if (hit) return hit;
  }
  return state.customSpots.find((s) => s.id === id) || null;
}
// 現在の地域で一覧に出すスポット
function spotsForRegion() {
  const base = SPOT_DATA[state.region] || [];
  const custom = state.customSpots.filter((s) => s.region === state.region);
  return base.concat(custom);
}
// どの日に追加済みか（未追加なら -1）
function addedDayIndex(spotId) {
  return state.days.findIndex((d) => d.items.some((it) => it.spotId === spotId));
}
function isAdded(spotId) {
  return addedDayIndex(spotId) !== -1;
}

// 行き先の中心座標（サンプル地域は REGION_CENTER、任意行き先は選択時の座標）
function destCenter() {
  const c = REGION_CENTER[state.region];
  if (c) return c;
  const d = state.customDest;
  if (d && d.lat != null) return { lat: d.lat, lng: d.lng, zoom: 12 };
  return null;
}

// Googleモード（APIキー設定済み）かどうか
function isGoogleMode() {
  return typeof TravelMap !== "undefined" && !!TravelMap.isGoogle;
}

// 計画に中身があるか（地域変更時のリセット確認に使う）
function planHasContent() {
  return state.days.some((d) => d.items.length > 0 || d.hotel)
    || !!state.transport.out || !!state.transport.ret;
}
// 地域変更時のリセット：日数・出発時刻・出発地・候補リストは残し、日程・宿・交通を消す
function resetPlanForRegionChange() {
  state.days = state.days.map((d) => ({ startTime: d.startTime, items: [], hotel: null }));
  state.transport = { out: null, ret: null };
  state.activeDay = 0;
}

// ---------- 時刻計算 ----------
// "09:00" -> 540（分）。異常値は9:00扱いにしてNaN表示を防ぐ
function timeToMin(t) {
  if (typeof t !== "string" || !t.includes(":")) return 540;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 540;
  return h * 60 + m;
}
// 540 -> "9:00"（24時を超えたら「翌」を付ける）
function minToTime(min) {
  const day = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const prefix = day >= 1 ? "翌" : "";
  return `${prefix}${h}:${String(m).padStart(2, "0")}`;
}
// 分数を「2時間15分」形式にする
function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分`;
  return `${h}時間${m > 0 ? m + "分" : ""}`;
}
// その日の各スポットの到着・出発時刻を計算して配列で返す
// startOffsetMin: 1日目の往路交通など、開始時刻に上乗せする分数
function computeSchedule(day, startOffsetMin = 0) {
  let cur = timeToMin(day.startTime) + startOffsetMin;
  return day.items.map((it) => {
    const arrive = cur + (it.travelMin || 0);
    const depart = arrive + (it.stayMin || 0);
    cur = depart;
    return { arrive, depart };
  });
}

// ---------- 費用計算 ----------
function dayTotal(day) {
  return day.items.reduce((sum, it) => sum + (Number(it.cost) || 0), 0);
}
function spotTotal() {
  return state.days.reduce((sum, d) => sum + dayTotal(d), 0);
}
// 宿泊費：最終日を除く各日の宿の合計（日帰りなら0）
function hotelTotal() {
  return state.days.slice(0, -1).reduce((sum, d) => sum + (d.hotel ? Number(d.hotel.price) || 0 : 0), 0);
}
function transportTotal() {
  const t = state.transport;
  return (t.out ? Number(t.out.price) || 0 : 0) + (t.ret ? Number(t.ret.price) || 0 : 0);
}
// 現地移動（スポット間の運賃・タクシー代など）の合計
function moveTotal() {
  return state.days.reduce(
    (sum, d) => sum + d.items.reduce((s, it) => s + (it.travel ? Number(it.travel.price) || 0 : 0), 0),
    0
  );
}
function grandTotal() {
  return spotTotal() + hotelTotal() + transportTotal() + moveTotal();
}
function yen(n) {
  return "¥" + n.toLocaleString("ja-JP");
}

// ---------- 日程操作 ----------
function addToDay(spotId) {
  const spot = findSpot(spotId);
  if (!spot) return;
  state.days[state.activeDay].items.push({
    spotId: spot.id,
    stayMin: spot.stayMin,
    cost: spot.cost,
    travelMin: 30 // 仮の値。描画時に ensureSegmentTravels が距離から見積もり直す
  });
  // 追加したスポットに地図の焦点を当てる（経路全体へのズームアウトを防ぐ）
  if (spot.lat != null) mapFocus = { lat: spot.lat, lng: spot.lng };
  saveState();
  renderAll();
}
function removeItem(dayIdx, itemIdx) {
  state.days[dayIdx].items.splice(itemIdx, 1);
  saveState();
  renderAll();
}
function moveItem(dayIdx, from, to) {
  const items = state.days[dayIdx].items;
  if (to < 0 || to >= items.length) return;
  const [it] = items.splice(from, 1);
  items.splice(to, 0, it);
  saveState();
  renderAll();
}

// ---------- スポット間の移動（区間） ----------
const TRAVEL_MODES = {
  walk: { label: "徒歩", icon: "directions_walk" },
  transit: { label: "電車・バス", icon: "directions_transit" },
  car: { label: "車・タクシー", icon: "local_taxi" }
};

// 距離から手段別の所要時間・概算料金を見積もる
function estimateModeOption(mode, from, to) {
  if (!from || !to || from.lat == null || to.lat == null) {
    return { mode, min: 30, price: 0 }; // 座標がなければ既定値（手修正前提）
  }
  const km = distanceKm(from, to) * 1.3; // 実経路は直線距離より長いので補正
  let min;
  let price;
  if (mode === "walk") {
    min = (km / 4.5) * 60 + 2; // 徒歩 4.5km/h
    price = 0;
  } else if (mode === "car") {
    min = (km / 25) * 60 + 5; // 市街地の車 25km/h
    price = Math.round((500 + Math.max(0, km - 1) * 400) / 10) * 10; // タクシー概算
  } else {
    min = (km / 18) * 60 + 12; // 電車・バス 18km/h + 乗換・待ち時間
    price = Math.round((170 + km * 20) / 10) * 10; // 都市部の運賃概算
  }
  return { mode, min: Math.max(5, Math.round(min / 5) * 5), price };
}

// 距離から見たおすすめの手段（近距離は徒歩、それ以外は電車・バス）
function defaultTravelMode(from, to) {
  if (!from || !to || from.lat == null || to.lat == null) return "transit";
  return distanceKm(from, to) * 1.3 <= 1.5 ? "walk" : "transit";
}

// ---------- AIおすすめ順（ローカル最適化で訪問順を提案） ----------
// 2地点間の移動時間（分）：おすすめ手段での見積もり
function estimateTravelMin(a, b) {
  return estimateModeOption(defaultTravelMode(a, b), a, b).min;
}

// グルメスポットの到着が昼(12:15)・夜(18:15)から外れるほどペナルティ（分換算）
const MEAL_CENTERS = [735, 1095];
const MEAL_GRACE = 45; // 中心から±45分は許容
function mealPenalty(spot, arriveMin) {
  if (!spot || spot.category !== "food") return 0;
  const d = Math.min(...MEAL_CENTERS.map((c) => Math.abs(arriveMin - c)));
  return Math.max(0, d - MEAL_GRACE);
}

// 訪問順のコスト = 総移動時間 + 食事時間帯ペナルティ + 21時超過ペナルティ
// entries: [{ it, spot }]、anchor: その日の出発地点
function evaluateOrder(entries, anchor, startMin) {
  let cur = startMin;
  let prev = anchor;
  let cost = 0;
  const travels = [];
  for (const e of entries) {
    const t = estimateTravelMin(prev, e.spot);
    travels.push(t);
    const arrive = cur + t;
    cost += t + mealPenalty(e.spot, arrive);
    cur = arrive + (Number(e.it.stayMin) || 0);
    if (e.spot && e.spot.lat != null) prev = e.spot;
  }
  cost += Math.max(0, cur - 1260); // 21:00 を超えた分
  return { cost, travels };
}

// その日の出発地点：前夜の宿 → 1日目は往路の到着点（駅・空港）→ なければ地域の中心
function dayAnchor(dayIdx) {
  if (dayIdx > 0) {
    const h = state.days[dayIdx - 1].hotel;
    if (h && h.lat != null) return h;
  }
  const out = state.transport.out;
  if (dayIdx === 0 && out && out.arrive && out.arrive.lat != null) return out.arrive;
  const c = destCenter();
  return c ? { lat: c.lat, lng: c.lng } : null;
}

// その日の行動開始時刻（1日目は往路の移動時間ぶん遅れる）
function dayStartMin(dayIdx) {
  const out = state.transport.out;
  const offset = dayIdx === 0 && out ? Number(out.durationMin) || 0 : 0;
  return timeToMin(state.days[dayIdx].startTime) + offset;
}

// Heapのアルゴリズムで全順列を列挙してコールバックに渡す
function forEachPermutation(arr, cb) {
  const a = arr.slice();
  const c = new Array(a.length).fill(0);
  cb(a);
  let i = 0;
  while (i < a.length) {
    if (c[i] < i) {
      const k = i % 2 === 0 ? 0 : c[i];
      [a[k], a[i]] = [a[i], a[k]];
      c[i]++;
      i = 0;
      cb(a);
    } else {
      c[i++] = 0;
    }
  }
}

// 貪欲法：各ステップで「移動時間+食事ペナルティ」最小の次スポットを選ぶ
function greedyOrder(entries, anchor, startMin) {
  const rest = entries.slice();
  const order = [];
  let prev = anchor;
  let cur = startMin;
  while (rest.length > 0) {
    let bi = 0;
    let bs = Infinity;
    rest.forEach((e, i) => {
      const t = estimateTravelMin(prev, e.spot);
      const s = t + mealPenalty(e.spot, cur + t);
      if (s < bs) { bs = s; bi = i; }
    });
    const [e] = rest.splice(bi, 1);
    const t = estimateTravelMin(prev, e.spot);
    cur += t + (Number(e.it.stayMin) || 0);
    if (e.spot && e.spot.lat != null) prev = e.spot;
    order.push(e);
  }
  return order;
}

// 2-opt：区間反転でコストが下がる限り改善を繰り返す
function twoOptImprove(order, anchor, startMin) {
  let best = order.slice();
  let bestCost = evaluateOrder(best, anchor, startMin).cost;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 30) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
        const c = evaluateOrder(cand, anchor, startMin).cost;
        if (c < bestCost) { best = cand; bestCost = c; improved = true; }
      }
    }
  }
  return best;
}

// 訪問順を最適化して day.items を置き換える（travelMin も距離から再計算）
// 8件以下は全順列を評価、9件以上は貪欲法+2-opt改善
function optimizeDayOrder(dayIdx) {
  const day = state.days[dayIdx];
  if (day.items.length < 2) return false;
  const entries = day.items.map((it) => ({ it, spot: findSpot(it.spotId) }));
  const anchor = dayAnchor(dayIdx);
  const start = dayStartMin(dayIdx);
  let best = null;
  const consider = (order) => {
    const r = evaluateOrder(order, anchor, start);
    if (!best || r.cost < best.cost) best = { order: order.slice(), travels: r.travels, cost: r.cost };
  };
  if (entries.length <= 8) {
    forEachPermutation(entries, consider);
  } else {
    consider(twoOptImprove(greedyOrder(entries, anchor, start), anchor, start));
  }
  day.items = best.order.map((e) => e.it);
  best.order.forEach((e, i) => { e.it.travelMin = best.travels[i]; });
  return true;
}

// ボタンから呼ぶ：表示中の日を並び替え、スナックバーから元に戻せるようにする
let aiOrderBackup = null; // { dayIdx, items }
function applyAiOrder() {
  const dayIdx = state.activeDay;
  const before = JSON.stringify(state.days[dayIdx].items);
  if (!optimizeDayOrder(dayIdx)) {
    showSnackbar("並び替えるには、この日に予定が2件以上必要です");
    return;
  }
  aiOrderBackup = { dayIdx, items: JSON.parse(before) };
  saveState();
  renderAll();
  showSnackbar("AIおすすめ順に並び替えました（移動時間も距離から再計算）",
    { label: "元に戻す", onClick: undoAiOrder });
}
function undoAiOrder() {
  if (!aiOrderBackup) return;
  state.days[aiOrderBackup.dayIdx].items = aiOrderBackup.items;
  aiOrderBackup = null;
  saveState();
  renderAll();
  showSnackbar("並び替え前の順序に戻しました");
}

// ---------- 区間情報（item.travel）の管理 ----------
// item.travel = { key, mode, min, price, lines, source, chosen }
//   key:    "出発点>スポットID"。並び替え等で区間が変わったことを検出する
//   source: "estimate"（概算）| "google"（Routes API取得）| "manual"（手修正）
//   時刻計算は従来通り item.travelMin を使う（travel.min と常に同期させる）

// 区間の出発点（前の予定。先頭の予定は前夜の宿か地域中心）と識別キー
function segmentFrom(dayIdx, itemIdx) {
  if (itemIdx > 0) {
    const prevId = state.days[dayIdx].items[itemIdx - 1].spotId;
    return { point: findSpot(prevId), key: prevId };
  }
  const prevHotel = dayIdx > 0 ? state.days[dayIdx - 1].hotel : null;
  const out = state.transport.out;
  const arriveName = dayIdx === 0 && out && out.arrive ? out.arrive.name : null;
  const key = prevHotel && prevHotel.lat != null
    ? `hotel:${prevHotel.lat},${prevHotel.lng}`
    : `start:${arriveName || state.region}`; // 往路の到着点が変わったら先頭区間を見積もり直す
  return { point: dayAnchor(dayIdx), key };
}

// 区間情報が無い・古い（並び替えで区間が変わった）場合に見積もり直す。変更があれば true
function ensureSegmentTravels() {
  let changed = false;
  state.days.forEach((day, di) => {
    day.items.forEach((it, ii) => {
      const from = segmentFrom(di, ii);
      const key = `${from.key}>${it.spotId}`;
      if (it.travel && it.travel.key === key) return;
      const spot = findSpot(it.spotId);
      const mode = defaultTravelMode(from.point, spot);
      const est = estimateModeOption(mode, from.point, spot);
      it.travel = { key, mode, min: est.min, price: est.price, lines: [], source: "estimate", chosen: false };
      it.travelMin = est.min;
      changed = true;
    });
  });
  return changed;
}

// 手段の切り替え（ユーザー操作）。切り替え先の見積もりで置き直す
function setSegmentMode(dayIdx, itemIdx, mode) {
  const it = state.days[dayIdx].items[itemIdx];
  const from = segmentFrom(dayIdx, itemIdx);
  const est = estimateModeOption(mode, from.point, findSpot(it.spotId));
  it.travel = {
    key: `${from.key}>${it.spotId}`,
    mode, min: est.min, price: est.price, lines: [], source: "estimate", chosen: true
  };
  it.travelMin = est.min;
  saveState();
  renderAll();
}

// ---------- Routes API による区間の実データ化 ----------
// 徒歩・車は実所要時間（車は実距離からタクシー料金も計算）に置き換わる。
// 電車・バスは日本ではAPIから経路が返らないため概算のまま（noRoute）になり、
// 区間の「Googleマップで経路を見る」リンクから実際の路線・運賃を確認して手修正する運用。
const routeCache = {}; // "mode|lat,lng>lat,lng" -> 取得結果（経路なしは null もキャッシュ）
const routePending = new Set();
let routesApiAvailable = true; // 403（未有効）を検出したら以後の照会を止める
let routesRetryAfter = 0; // 一時的な失敗（オフライン・429・5xx等）後はこの時刻まで照会を控える

// Google の取得結果を区間に反映する
function applySegmentRoute(it, g) {
  if (!g) { it.travel.noRoute = true; return true; } // 経路なし → 概算のまま
  it.travel.min = g.min;
  it.travelMin = g.min;
  it.travel.lines = g.lines || [];
  if (it.travel.mode === "car" && g.km != null) {
    // 実走行距離からタクシー料金を概算し直す
    it.travel.price = Math.round((500 + Math.max(0, g.km - 1) * 400) / 10) * 10;
  } else if (g.price != null) {
    it.travel.price = g.price; // 公共交通の実運賃（取得できた場合）
  }
  it.travel.source = "google";
  return true;
}

// 表示中の日の概算区間を Routes API の実データに置き換える
async function refineSegments() {
  if (typeof TravelMap === "undefined" || !TravelMap.isGoogle || !TravelMap.getRoute) return;
  if (!routesApiAvailable) return;
  if (Date.now() < routesRetryAfter) return; // 直近で失敗したので少し待つ
  const dayIdx = state.activeDay;
  const day = state.days[dayIdx];
  const outOffset = dayIdx === 0 && state.transport.out ? Number(state.transport.out.durationMin) || 0 : 0;
  const schedule = computeSchedule(day, outOffset);
  let changed = false;
  const jobs = [];
  day.items.forEach((it, ii) => {
    const t = it.travel;
    if (!t || t.source !== "estimate" || t.noRoute) return;
    const from = segmentFrom(dayIdx, ii).point;
    const to = findSpot(it.spotId);
    if (!from || !to || from.lat == null || to.lat == null) return;
    const ck = `${t.mode}|${from.lat},${from.lng}>${to.lat},${to.lng}`;
    if (ck in routeCache) {
      changed = applySegmentRoute(it, routeCache[ck]) || changed;
    } else if (!routePending.has(ck)) {
      routePending.add(ck);
      // 計画上の出発時刻（公共交通の時刻表検索用。過去なら現在時刻で検索される）
      const departMin = ii > 0 ? schedule[ii - 1].depart : timeToMin(day.startTime) + outOffset;
      jobs.push({ ck, from, to, mode: t.mode, key: t.key, departMin });
    }
  });
  // キャッシュ反映と新規取得をまとめて行い、最後に一度だけ再描画する
  // （反映済み区間は source=google / noRoute になるので、再描画からの再帰は止まる）
  let applied = changed;
  for (const job of jobs) {
    try {
      const g = await TravelMap.getRoute(job.from, job.to, job.mode, plannedDepartIso(dayIdx, job.departMin));
      routeCache[job.ck] = g;
      routePending.delete(job.ck);
      // 取得中に並び替え・手段変更されていないか、キーで確認してから反映する
      const target = state.days[dayIdx].items.find(
        (it) => it.travel && it.travel.key === job.key && it.travel.mode === job.mode && it.travel.source === "estimate"
      );
      if (target) applied = applySegmentRoute(target, g) || applied;
    } catch (e) {
      console.error(e);
      // 中断時は未処理ぶんも routePending から外し、次回の描画で再試行できるようにする
      jobs.forEach((j) => routePending.delete(j.ck));
      if (e && (e.status === 403 || e.status === 404)) {
        routesApiAvailable = false; // Routes API 未有効。概算表示のまま運用する
        renderTimeline();
      } else {
        // オフライン・429・5xx など一時的な失敗：連続リトライを防ぐ
        routesRetryAfter = Date.now() + 60000;
      }
      break;
    }
  }
  if (applied) {
    saveState();
    renderAll();
  }
}

// 計画上の出発日時を ISO 文字列で返す（過去・出発日未設定なら null）
function plannedDepartIso(dayIdx, departMin) {
  if (!state.startDate) return null;
  const d = new Date(state.startDate + "T00:00:00");
  if (isNaN(d)) return null;
  d.setDate(d.getDate() + dayIdx);
  d.setMinutes(departMin);
  return d.getTime() > Date.now() ? d.toISOString() : null;
}

// 日数変更：減らす場合、消える日の予定は最後に残る日へ移す
function setNumDays(n) {
  const days = state.days;
  if (n > days.length) {
    while (days.length < n) days.push(newDay());
  } else if (n < days.length) {
    const removed = days.splice(n);
    const orphans = removed.flatMap((d) => d.items);
    if (orphans.length > 0) {
      days[days.length - 1].items.push(...orphans);
      alert(`減らした日の予定 ${orphans.length}件 は最終日に移動しました。`);
    }
    days[days.length - 1].hotel = null; // 最終日に宿は不要
  }
  state.numDays = n;
  if (state.activeDay >= n) state.activeDay = n - 1;
  saveState();
  renderAll();
}

// ---------- 自作スポット ----------
function addCustomSpot() {
  const name = document.getElementById("custom-name").value.trim();
  if (!name) {
    alert("場所の名前を入力してください。");
    return;
  }
  const center = (typeof TravelMap !== "undefined" && TravelMap.getCenter()) || { lat: 35, lng: 135 };
  const pos = pickedLatLng || center; // 未指定なら地図中心を使う
  const spot = {
    id: "custom-" + Date.now(),
    name,
    category: document.getElementById("custom-category").value,
    desc: document.getElementById("custom-desc").value.trim() || "自分で追加した場所",
    lat: pos.lat,
    lng: pos.lng,
    stayMin: Number(document.getElementById("custom-stay").value) || 60,
    cost: nonNegNum(document.getElementById("custom-cost").value),
    region: state.region,
    isCustom: true
  };
  state.customSpots.push(spot);
  saveState();
  // フォームを初期化
  document.getElementById("custom-name").value = "";
  document.getElementById("custom-desc").value = "";
  pickedLatLng = null;
  document.getElementById("picked-location").textContent = "位置：未設定（地図中心を使用）";
  renderAll();
}
function deleteCustomSpot(spotId) {
  if (!confirm("この自作スポットを削除しますか？日程に入っている場合は日程からも消えます。")) return;
  state.customSpots = state.customSpots.filter((s) => s.id !== spotId);
  state.days.forEach((d) => {
    d.items = d.items.filter((it) => it.spotId !== spotId);
  });
  saveState();
  renderAll();
}

// ---------- 宿泊 ----------
// 選択中の日の「泊」にホテルを設定する（最終日タブなら前夜扱い）
function setHotel(h) {
  if (state.days.length === 1) {
    alert("日帰りプランでは宿泊の設定はありません。日数を増やすと設定できます。");
    return;
  }
  const target = state.activeDay >= state.days.length - 1 ? state.days.length - 2 : state.activeDay;
  // placeId・説明も持たせて、泊カードや地図の🏨ピンからも詳細を開けるようにする
  state.days[target].hotel = {
    name: h.name,
    price: h.price,
    rating: h.rating,
    lat: h.lat,
    lng: h.lng,
    placeId: h.placeId || null,
    desc: h.desc || ""
  };
  saveState();
  renderAll();
  showSnackbar(`「${h.name}」を${target + 1}日目の宿に設定しました`);
}
function removeHotel(dayIdx) {
  state.days[dayIdx].hotel = null;
  saveState();
  renderAll();
}

// ---------- 出発地 ----------
// 2地点間の直線距離（km、ハーバサイン公式）
function distanceKm(a, b) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function setOrigin(o) {
  state.origin = o;
  // 出発地が変わると金額の前提が変わるので、交通の選択はリセットする
  if (state.transport.out || state.transport.ret) {
    state.transport = { out: null, ret: null };
    showSnackbar(`出発地を「${o.name}」に設定しました（交通の選択をリセットしました）`);
  } else {
    showSnackbar(`出発地を「${o.name}」に設定しました`);
  }
  saveState();
  renderAll();
}
function clearOrigin() {
  state.origin = null;
  state.transport = { out: null, ret: null };
  saveState();
  renderAll();
}

// 手段名から到着する玄関口を探す（プリセットの「新幹線」と手段マスタの
// 「新幹線・特急」のような表記ゆれは、前方一致・先頭2文字で吸収する）
function gatewayForMethod(method) {
  const gws = REGION_GATEWAYS[state.region] || [];
  return gws.find((g) => g.methods.some(
    (m) => m === method || m.startsWith(method) || method.startsWith(m) || m.slice(0, 2) === method.slice(0, 2)
  )) || null;
}

// 交通の候補を「玄関口経由の経路」として組み立てる
// 各候補: { id, method, gateway, icon, price(合計), durationMin(合計), note,
//           legs: [{ method, icon, min, price, toName }], arrive: {name,lat,lng} }
// arrive（到着点）は1日目の観光の起点になる
function buildTransportOptions() {
  const origin = state.origin;
  const center = destCenter();
  if (!origin || origin.lat == null || !center) {
    // プリセット（出発地なし）。玄関口が分かる手段には到着点を付ける
    return (TRANSPORT_DATA[state.region] || []).map((p) => {
      const opt = Object.assign({ id: p.method }, p);
      const gw = gatewayForMethod(p.method);
      if (gw) {
        opt.arrive = gw.access ? gw.access.to : { name: gw.name, lat: gw.lat, lng: gw.lng };
        opt.legs = [{
          method: p.method, icon: p.icon, min: p.durationMin, price: p.price,
          toName: opt.arrive.name, toLat: opt.arrive.lat, toLng: opt.arrive.lng
        }];
      }
      return opt;
    });
  }
  const allowed = REGION_TRANSPORT_RULES[state.region] || DEFAULT_TRANSPORT_METHODS;
  const gateways = REGION_GATEWAYS[state.region] || [];
  const opts = [];
  TRANSPORT_METHODS.filter((m) => allowed.includes(m.method)).forEach((m) => {
    // この手段で到着できる玄関口ごとに1候補（飛行機なら伊丹経由・関空経由など）
    const targets = gateways.filter((g) => g.methods.includes(m.method));
    if (targets.length === 0) targets.push({ name: state.region, lat: center.lat, lng: center.lng });
    targets.forEach((gw) => {
      const routeKm = Math.round(distanceKm(origin, gw) * 1.3); // 実経路補正
      if ((m.minKm && routeKm < m.minKm) || (m.maxKm && routeKm > m.maxKm)) return;
      const legs = [{
        method: m.method, icon: m.icon,
        min: Math.round((routeKm / m.speed) * 60) + (m.extraMin || 0),
        price: Math.round((m.base + m.perKm * routeKm) / 100) * 100,
        toName: gw.name, toLat: gw.lat, toLng: gw.lng
      }];
      let arrive = { name: gw.name, lat: gw.lat, lng: gw.lng };
      if (gw.access) {
        legs.push({
          method: gw.access.method, icon: gw.access.icon,
          min: gw.access.min, price: gw.access.price,
          toName: gw.access.to.name, toLat: gw.access.to.lat, toLng: gw.access.to.lng
        });
        arrive = gw.access.to;
      }
      const totalMin = legs.reduce((s, l) => s + l.min, 0);
      const totalPrice = legs.reduce((s, l) => s + l.price, 0);
      opts.push({
        id: `${m.method}@${gw.name}`,
        method: m.method,
        gateway: gw.name,
        icon: m.icon,
        price: totalPrice,
        durationMin: totalMin,
        note: `合計${fmtDuration(totalMin)}・約${routeKm}km・${arrive.name}着`,
        legs,
        arrive
      });
    });
  });
  opts.sort((a, b) => a.durationMin - b.durationMin); // 速い順
  return opts;
}

// ---------- 交通 ----------
// dir は "out"（往路）か "ret"（復路）
function selectTransport(dir, preset) {
  state.transport[dir] = {
    id: preset.id || preset.method,
    method: preset.method,
    gateway: preset.gateway || null,
    price: preset.price,
    note: preset.note,
    icon: preset.icon || "commute",
    durationMin: Number(preset.durationMin) || 0,
    legs: preset.legs || null,    // 経路の内訳（乗り継ぎごと）
    arrive: preset.arrive || null // 現地の到着点（1日目の観光の起点になる）
  };
  saveState();
  renderAll();
}
function clearTransport(dir) {
  state.transport[dir] = null;
  saveState();
  renderAll();
}

// ============================================================
// 描画
// ============================================================
function renderAll() {
  if (ensureSegmentTravels()) saveState(); // 並び替え等で古くなった区間を見積もり直す
  renderSpotList();
  renderHotelList();
  renderTransportView();
  renderDayTabs();
  renderTimeline();
  renderHotelSlot();
  renderTotals();
  renderMapView();
  refineSegments(); // 概算区間を Routes API で実データ化（非同期）
  if (typeof renderWeather === "function") renderWeather(); // 天気表示（キャッシュ有効時はfetchしない）
}

// ---------- ホテル一覧（左パネル） ----------
let hotelSort = "recommend"; // recommend | price | rating

function renderHotelList() {
  const ul = document.getElementById("hotel-list");
  if (!ul) return;
  ul.innerHTML = "";
  let hotels = (HOTEL_DATA[state.region] || []).slice();
  // 任意行き先はサンプルが無いので、Places検索（lodging）の宿候補を使う
  // 料金はAPIから取れないため0円＝「料金未設定」で出し、選択後に編集してもらう
  if (hotels.length === 0 && state.customDest) {
    hotels = hotelPlaceResults.map((r) => ({
      id: "gh-" + r.placeId,
      placeId: r.placeId, // 詳細モーダルでGoogleの写真・クチコミを引くのに使う
      name: r.name,
      rating: r.rating != null ? r.rating : 0,
      price: 0,
      desc: r.address,
      lat: r.lat,
      lng: r.lng,
      priceUnknown: true
    }));
  }
  if (hotelSort === "price") hotels.sort((a, b) => a.price - b.price);
  else if (hotelSort === "rating") hotels.sort((a, b) => b.rating - a.rating);
  if (hotels.length === 0) {
    const cls = state.customDest ? "spot-item spot-empty spot-empty-dest" : "spot-item spot-empty";
    ul.innerHTML = `<li class="${cls}"><div class="spot-info"><div class="spot-desc">この行き先のホテルデータがありません</div></div></li>`;
    return;
  }
  hotels.forEach((h) => {
    const li = document.createElement("li");
    li.className = "spot-item";
    li.innerHTML = `
      <div class="spot-info">
        <div class="spot-name">${escapeHtml(h.name)}</div>
        <div class="spot-meta"><span class="pr-rating">★ ${h.rating}</span> ／ ${h.priceUnknown ? "料金未設定（選択後に編集可）" : `1泊 ${yen(h.price)}`}</div>
        <div class="spot-desc">${escapeHtml(h.desc)}</div>
      </div>
    `;
    // 宿の情報部分のクリックで詳細モーダルを開く（スポットと同じ操作感）
    li.querySelector(".spot-info").onclick = () => openHotelDetail(h);
    const btn = document.createElement("button");
    btn.className = "add-spot-btn";
    btn.textContent = "この日の宿にする";
    btn.onclick = () => setHotel(h);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

// ---------- 交通ビュー（左パネル） ----------
function renderTransportView() {
  renderOriginView();
  renderTransportList("out", "transport-out");
  renderTransportList("ret", "transport-ret");
}

// 出発地の表示（登録済みなら名前と距離、未登録なら案内）
function renderOriginView() {
  const box = document.getElementById("origin-current");
  if (!box) return;
  box.innerHTML = "";
  const o = state.origin;
  if (!o) {
    box.innerHTML = '<div class="origin-empty">未設定：下の検索から登録すると金額を自動見積もりします</div>';
    return;
  }
  const center = destCenter();
  let distText = "";
  if (o.lat != null && center) {
    distText = `→ ${escapeHtml(state.region)}（直線距離 約${Math.round(distanceKm(o, center))}km）`;
  }
  const card = document.createElement("div");
  card.className = "origin-card";
  card.innerHTML = `
    <span class="material-symbols-outlined">location_on</span>
    <div class="origin-info">
      <div class="origin-name">${escapeHtml(o.name)}</div>
      <div class="origin-dist">${distText}</div>
    </div>
  `;
  const clearBtn = document.createElement("button");
  clearBtn.className = "add-spot-btn";
  clearBtn.textContent = "解除";
  clearBtn.onclick = clearOrigin;
  card.appendChild(clearBtn);
  box.appendChild(card);
}

function renderTransportList(dir, elementId) {
  const ul = document.getElementById(elementId);
  if (!ul) return;
  ul.innerHTML = "";
  const presets = buildTransportOptions();
  // 任意行き先はプリセット経路が無く、出発地の登録が候補作成の前提になる
  if (presets.length === 0) {
    ul.innerHTML = '<li class="place-status">上の「出発地」を登録すると、この行き先までの経路と料金を概算します</li>';
    return;
  }
  const selected = state.transport[dir];
  presets.forEach((p) => {
    const isSel = selected && (selected.id ? selected.id === (p.id || p.method) : selected.method === p.method);
    // 乗り継ぎありは「飛行機（伊丹空港経由）」のように経由を明示する
    const label = p.legs && p.legs.length > 1 ? `${p.method}（${p.gateway}経由）` : p.method;
    // 経路の内訳（✈️→伊丹空港 › 🚌→京都駅）
    const legsHtml = (p.legs || []).map((l) =>
      `<span class="to-leg"><span class="material-symbols-outlined">${escapeHtml(l.icon)}</span>${escapeHtml(l.toName)}</span>`
    ).join('<span class="seg-arrow">›</span>');
    const li = document.createElement("li");
    li.className = "transport-option" + (isSel ? " selected" : "");
    li.innerHTML = `
      <span class="material-symbols-outlined">${p.icon}</span>
      <div class="to-info">
        <div class="to-method">${escapeHtml(label)}</div>
        <div class="to-note">${escapeHtml(p.note)}</div>
        ${legsHtml ? `<div class="to-legs">${legsHtml}</div>` : ""}
      </div>
      <div class="to-price">${yen(p.price)}</div>
    `;
    li.onclick = () => selectTransport(dir, p);
    ul.appendChild(li);
  });
  // 選択済みなら金額編集と解除の行を出す
  if (selected) {
    const li = document.createElement("li");
    li.className = "transport-edit";
    li.innerHTML = `
      <span>選択中：${escapeHtml(selected.method)}</span>
      <label>金額 <input type="number" min="0" step="100" value="${Number(selected.price) || 0}">円</label>
    `;
    li.querySelector("input").onchange = (e) => {
      state.transport[dir].price = nonNegNum(e.target.value);
      saveState();
      renderTotals();
      renderTimeline(); // 出発・復路カードの金額表示も更新する
    };
    const clearBtn = document.createElement("button");
    clearBtn.className = "add-spot-btn";
    clearBtn.textContent = "解除";
    clearBtn.onclick = () => clearTransport(dir);
    li.appendChild(clearBtn);
    ul.appendChild(li);
  }
}

// ---------- 泊カード（タイムライン下） ----------
function renderHotelSlot() {
  const slot = document.getElementById("hotel-slot");
  if (!slot) return;
  slot.innerHTML = "";
  if (state.days.length === 1) return; // 日帰りは宿泊なし
  // 最終日タブでは前夜の宿を「前泊」として表示する（設定結果が見えるように）
  const isLast = state.activeDay >= state.days.length - 1;
  const dayIdx = isLast ? state.days.length - 2 : state.activeDay;
  const day = state.days[dayIdx];
  const label = isLast ? `前泊（${dayIdx + 1}日目の宿）` : "泊";
  if (!day.hotel) {
    slot.innerHTML = `<div class="hotel-card empty"><span class="material-symbols-outlined">hotel</span>${isLast ? "前夜の宿" : "この日の宿"}は未定です（「ホテル」タブから選択）</div>`;
    return;
  }
  const card = document.createElement("div");
  card.className = "hotel-card";
  card.innerHTML = `
    <span class="material-symbols-outlined">hotel</span>
    <div class="hc-info">
      <div class="hc-name">${label}：<button type="button" class="hc-detail-btn">${escapeHtml(day.hotel.name)}</button></div>
      <label class="hc-price">1泊 <input type="number" min="0" step="500" value="${Number(day.hotel.price) || 0}">円</label>
    </div>
  `;
  card.querySelector("input").onchange = (e) => {
    day.hotel.price = nonNegNum(e.target.value);
    saveState();
    renderTotals();
  };
  // 宿名クリックで詳細モーダル（スポット名と同じ操作感）
  card.querySelector(".hc-detail-btn").onclick = () => openHotelDetail(day.hotel);
  const delBtn = document.createElement("button");
  delBtn.className = "icon-btn";
  delBtn.textContent = "✕";
  delBtn.title = "宿を解除";
  delBtn.onclick = () => removeHotel(dayIdx);
  card.appendChild(delBtn);
  slot.appendChild(card);
}

// ---------- スポット一覧 ----------
function renderSpotList() {
  renderPopularSpots(); // 絞り込み・追加状態の変化を人気スポット欄にも反映
  if (typeof History !== "undefined" && History.renderInline) History.renderInline(); // 以前行った場所（履歴DB）
  const ul = document.getElementById("spot-list");
  ul.innerHTML = "";
  const spots = spotsForRegion().filter((s) => {
    if (filter.category === "custom") {
      // 「マイ追加」：Google検索や手入力で自分が候補に入れたものだけを表示
      if (!s.isCustom) return false;
    } else if (filter.category !== "all" && s.category !== filter.category) {
      return false;
    }
    if (filter.text && !s.name.includes(filter.text)) return false;
    return true;
  });
  if (spots.length === 0) {
    // 任意行き先（サンプルデータなし）で絞り込みも無いときは、次アクションを変える
    const noFilter = !filter.text && filter.category === "all";
    if (noFilter && state.customDest) {
      // Googleモードではすぐ下の「このエリアの人気スポット」が案内を兼ねるので枠は出さない
      if (isGoogleMode()) return;
      ul.innerHTML = '<li class="spot-item spot-empty spot-empty-dest"><div class="spot-info"><div class="spot-desc">この行き先のサンプルデータはありません</div></div></li>';
    } else {
      ul.innerHTML = '<li class="spot-item spot-empty"><div class="spot-info"><div class="spot-desc">該当するスポットがありません</div></div></li>';
    }
    return;
  }
  spots.forEach((s) => {
    const li = document.createElement("li");
    li.className = "spot-item" + (isAdded(s.id) ? " added" : "");
    li.dataset.spotId = s.id;
    const catLabel = s.category === "food" ? "グルメ" : "観光";
    const catClass = s.category === "food" ? "cat-food" : "cat-sightseeing";
    li.innerHTML = `
      <div class="spot-info">
        <div class="spot-name"><span class="cat-badge ${catClass}">${catLabel}</span>${escapeHtml(s.name)}${s.isCustom ? ` <span class="cat-badge cat-neutral">${s.source === "google" ? "Google" : "自作"}</span>` : ""}</div>
        <div class="spot-meta">滞在目安 ${s.stayMin}分 ／ ${yen(s.cost)}</div>
        <div class="spot-desc">${escapeHtml(s.desc)}</div>
      </div>
    `;
    // スポット情報部分のクリックで詳細モーダルを開く
    li.querySelector(".spot-info").onclick = () => openSpotDetail(s.id);
    const actions = document.createElement("div");
    const addBtn = document.createElement("button");
    addBtn.className = "add-spot-btn";
    if (isAdded(s.id)) {
      addBtn.textContent = `${addedDayIndex(s.id) + 1}日目に追加済み`;
      addBtn.disabled = true;
    } else {
      addBtn.textContent = `${state.activeDay + 1}日目に追加`;
      addBtn.onclick = () => addToDay(s.id);
    }
    actions.appendChild(addBtn);
    if (s.isCustom) {
      const delBtn = document.createElement("button");
      delBtn.className = "add-spot-btn";
      delBtn.textContent = "削除";
      delBtn.style.marginTop = "4px";
      delBtn.onclick = () => deleteCustomSpot(s.id);
      actions.appendChild(delBtn);
      actions.style.display = "flex";
      actions.style.flexDirection = "column";
    }
    li.appendChild(actions);
    ul.appendChild(li);
  });
}

// ---------- 日タブ ----------
function renderDayTabs() {
  const wrap = document.getElementById("day-tabs");
  wrap.innerHTML = "";
  const start = state.startDate ? new Date(state.startDate + "T00:00:00") : null;
  state.days.forEach((d, i) => {
    const btn = document.createElement("button");
    btn.className = "day-tab" + (i === state.activeDay ? " active" : "");
    // タブとしての支援技術向け属性（タブパネル＝タイムライン）
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", i === state.activeDay ? "true" : "false");
    btn.setAttribute("aria-controls", "timeline");
    let label = `${i + 1}日目`;
    if (start && !isNaN(start)) {
      const dt = new Date(start);
      dt.setDate(dt.getDate() + i);
      label += `（${dt.getMonth() + 1}/${dt.getDate()} ${"日月火水木金土"[dt.getDay()]}）`; // 曜日も併記（Skyscanner流の日タブ）
    }
    btn.textContent = label;
    btn.onclick = () => {
      state.activeDay = i;
      saveState();
      renderAll();
    };
    wrap.appendChild(btn);
  });
  renderDateRangeField(); // ヘッダーの開始/終了表示も日タブと同じ情報源から同期する
  document.getElementById("day-start-time").value = state.days[state.activeDay].startTime;
  // 1日目で出発地・往路がある場合は「自宅を出る時刻」の意味になる
  const lbl = document.getElementById("start-time-label");
  if (lbl) {
    lbl.textContent = state.activeDay === 0 && (state.origin || state.transport.out)
      ? "出発時刻（自宅を出る時刻）"
      : "この日の出発時刻";
  }
}

// ---------- タイムライン ----------
function renderTimeline() {
  const ol = document.getElementById("timeline");
  ol.innerHTML = "";
  const day = state.days[state.activeDay];
  const isFirst = state.activeDay === 0;
  const isLast = state.activeDay === state.days.length - 1;
  const out = state.transport.out;
  const ret = state.transport.ret;
  // 1日目は往路の移動時間ぶんだけ現地到着が遅れる
  const outOffset = isFirst && out ? Number(out.durationMin) || 0 : 0;

  // ---- 出発カード（1日目の冒頭）----
  if (isFirst && (state.origin || out)) {
    const dep = document.createElement("li");
    dep.className = "leg-card";
    const originName = state.origin ? state.origin.name : "出発地";
    let html = `<div class="leg-row"><span class="material-symbols-outlined">home_pin</span><b>${escapeHtml(originName)}</b>を ${minToTime(timeToMin(day.startTime))} に出発</div>`;
    if (out && out.legs && out.legs.length > 0) {
      // 経路の内訳を乗り継ぎごとに表示（例：飛行機→伊丹空港 → リムジンバス→京都駅）
      let cur = timeToMin(day.startTime);
      out.legs.forEach((leg) => {
        const arr = cur + (Number(leg.min) || 0);
        html += `<div class="leg-row"><span class="material-symbols-outlined">${escapeHtml(leg.icon || "commute")}</span>`
          + `${escapeHtml(leg.method)}（${fmtDuration(Number(leg.min) || 0)}） → ${minToTime(arr)} <b>${escapeHtml(leg.toName)}</b>着`
          + `<span class="leg-price">${yen(Number(leg.price) || 0)}</span></div>`;
        cur = arr;
      });
    } else if (out) {
      // 旧データ等で内訳がない場合は従来の1行表示
      const hasDur = Number(out.durationMin) > 0;
      const arrive = timeToMin(day.startTime) + outOffset;
      html += `<div class="leg-row"><span class="material-symbols-outlined">${escapeHtml(out.icon || "commute")}</span>${escapeHtml(out.method)}`
        + (hasDur ? `（${fmtDuration(out.durationMin)}） → ${minToTime(arrive)} ${escapeHtml(state.region)}着` : "")
        + `<span class="leg-price">${yen(Number(out.price) || 0)}</span></div>`;
    } else {
      html += '<div class="leg-row leg-hint">往路の交通が未選択です（交通タブから選択）</div>';
    }
    dep.innerHTML = html;
    ol.appendChild(dep);
  }

  const schedule = computeSchedule(day, outOffset);

  if (day.items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "timeline-empty";
    empty.innerHTML = '「スポット」タブの一覧から「追加」を押すと<br>ここに予定が並びます';
    ol.appendChild(empty);
  }
  day.items.forEach((it, idx) => {
    const spot = findSpot(it.spotId);
    const name = spot ? spot.name : "（削除されたスポット）";

    // 移動区間カード＋スポットカードを1つのドラッグ単位（entry）にまとめる
    const entry = document.createElement("li");
    entry.className = "tl-entry";
    entry.dataset.index = idx;

    const travel = document.createElement("div");
    travel.className = "tl-travel";
    travel.appendChild(buildSegmentCard(state.activeDay, idx, it));
    entry.appendChild(travel);

    const li = document.createElement("div");
    li.className = "tl-item";
    li.innerHTML = `
      <span class="tl-handle material-symbols-outlined" aria-hidden="true">drag_indicator</span>
      <div class="order-badge">${idx + 1}</div>
      <div class="tl-body">
        <div class="tl-time">${minToTime(schedule[idx].arrive)} 〜 ${minToTime(schedule[idx].depart)}</div>
        <div class="tl-name">${escapeHtml(name)}</div>
        <div class="tl-controls">
          <label>滞在 <input type="number" min="5" step="5" value="${it.stayMin}" data-field="stayMin"> 分</label>
          <label>費用 <input type="number" min="0" step="100" value="${it.cost}" data-field="cost"> 円</label>
        </div>
      </div>
      <div class="tl-actions">
        <button class="icon-btn" data-act="up" title="上へ" aria-label="上へ"><span class="material-symbols-outlined">arrow_upward</span></button>
        <button class="icon-btn" data-act="down" title="下へ" aria-label="下へ"><span class="material-symbols-outlined">arrow_downward</span></button>
        <button class="icon-btn" data-act="del" title="削除" aria-label="削除"><span class="material-symbols-outlined">close</span></button>
      </div>
    `;
    // 滞在時間・費用の編集
    li.querySelectorAll("input[data-field]").forEach((input) => {
      input.onchange = (e) => {
        it[e.target.dataset.field] = nonNegNum(e.target.value);
        saveState();
        renderAll();
      };
    });
    // スポット名のクリックで詳細モーダルを開く
    li.querySelector(".tl-name").onclick = () => openSpotDetail(it.spotId);
    // 並び替え・削除ボタン
    li.querySelector('[data-act="up"]').onclick = () => moveItem(state.activeDay, idx, idx - 1);
    li.querySelector('[data-act="down"]').onclick = () => moveItem(state.activeDay, idx, idx + 1);
    li.querySelector('[data-act="del"]').onclick = () => removeItem(state.activeDay, idx);

    entry.appendChild(li);

    // プレートを持ち上げて並び替え（Pointer Events。input等の上では開始しない）
    entry.addEventListener("pointerdown", (e) => onEntryPointerDown(e, entry, idx));

    ol.appendChild(entry);
  });

  // ---- 復路カード（最終日の末尾）----
  if (isLast && ret) {
    const originName = state.origin ? state.origin.name : "出発地";
    const base = day.items.length > 0
      ? schedule[schedule.length - 1].depart
      : timeToMin(day.startTime) + outOffset;
    // 最後のスポットから帰りの起点（駅・空港）への移動を距離から見積もる
    const lastSpot = day.items.length > 0 ? findSpot(day.items[day.items.length - 1].spotId) : null;
    const gwPoint = ret.arrive && ret.arrive.lat != null ? ret.arrive : null;
    const gwName = ret.arrive ? ret.arrive.name : "駅・空港";
    const leadMin = lastSpot && lastSpot.lat != null && gwPoint
      ? estimateModeOption("transit", lastSpot, gwPoint).min
      : 30;
    let cur = base + leadMin;
    let html = `<div class="leg-row leg-hint">${escapeHtml(gwName)}へ移動（約${leadMin}分） → ${minToTime(cur)}着</div>`;
    if (ret.legs && ret.legs.length > 0) {
      // 往路と同じ経路を逆順にたどって帰る（例：京都駅 → リムジンバス→伊丹空港 → 飛行機→自宅）
      const rev = ret.legs.slice().reverse();
      rev.forEach((leg, i) => {
        const dest = i < rev.length - 1 ? rev[i + 1].toName : originName;
        const arr = cur + (Number(leg.min) || 0);
        html += `<div class="leg-row"><span class="material-symbols-outlined">${escapeHtml(leg.icon || "commute")}</span>`
          + `${escapeHtml(leg.method)}（${fmtDuration(Number(leg.min) || 0)}） ${minToTime(cur)}発 → ${minToTime(arr)} <b>${escapeHtml(dest)}</b>着`
          + `<span class="leg-price">${yen(Number(leg.price) || 0)}</span></div>`;
        cur = arr;
      });
    } else {
      // 旧データ等で内訳がない場合は従来の1行表示
      const hasDur = Number(ret.durationMin) > 0;
      const arrTime = cur + (Number(ret.durationMin) || 0);
      html += `<div class="leg-row"><span class="material-symbols-outlined">${escapeHtml(ret.icon || "commute")}</span>復路：${escapeHtml(ret.method)}`
        + (hasDur
          ? `（${fmtDuration(ret.durationMin)}） ${minToTime(cur)}発 → ${minToTime(arrTime)} <b>${escapeHtml(originName)}</b>着`
          : ` ${minToTime(cur)}発`)
        + `<span class="leg-price">${yen(Number(ret.price) || 0)}</span></div>`;
    }
    const legRet = document.createElement("li");
    legRet.className = "leg-card";
    legRet.innerHTML = html;
    ol.appendChild(legRet);
  } else if (isLast && state.origin && !ret) {
    const legRet = document.createElement("li");
    legRet.className = "leg-card";
    legRet.innerHTML = '<div class="leg-row leg-hint">復路の交通が未選択です（交通タブから選択）</div>';
    ol.appendChild(legRet);
  }
}

// ---------- タイムラインの並び替え（プレートの持ち上げ操作） ----------
// ハンドル（またはカードの余白）を押して動かすと、カードのクローン（ゴースト）が
// ポインタに追従して「持ち上がり」、他のカードが transform でずれて挿入位置に隙間が空く。
// Pointer Events + setPointerCapture でマウス・タッチの両方に対応する。
// dragCtx = { from: 元のindex, target: 挿入先index, height: ドラッグ中の項目の高さ,
//             others: [{ el, midY }] （ドラッグ項目以外の、開始時点の中心Y座標） }
let dragCtx = null;
// ポインタ操作の進行状態（ゴースト・自動スクロール等）。dragCtx とは分けて持つ
let ptrDrag = null;
const DRAG_THRESHOLD_PX = 5;   // これ以上動いたらドラッグ開始（クリック・タップと区別）
const AUTOSCROLL_ZONE_PX = 48; // タイムラインの上下端からこの距離に入ると自動スクロール

function onEntryPointerDown(e, entry, idx) {
  if (dragCtx || ptrDrag) return; // 多重ドラッグ防止（settle アニメーション中も含む）
  if (e.button != null && e.button !== 0) return; // 左ボタン・タッチのみ
  // 入力・ボタン・リンク・スポット名（詳細モーダルを開く）の上からは開始しない
  if (e.target.closest && e.target.closest("input, select, button, a, label, .tl-name")) return;
  ptrDrag = {
    entry, idx,
    pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY,
    lastX: e.clientX, lastY: e.clientY,
    active: false, ghost: null,
    itemOffsetY: 0, ghostTop: 0,
    tl: document.getElementById("timeline"),
    startScrollTop: 0, scrollVel: 0, rafId: 0
  };
  try { entry.setPointerCapture(e.pointerId); } catch (err) { /* 未対応環境では捕捉なしで追従 */ }
  entry.addEventListener("pointermove", onEntryPointerMove);
  entry.addEventListener("pointerup", onEntryPointerUp);
  entry.addEventListener("pointercancel", onEntryPointerCancel);
}

function onEntryPointerMove(e) {
  if (!ptrDrag || e.pointerId !== ptrDrag.pointerId) return;
  ptrDrag.lastX = e.clientX;
  ptrDrag.lastY = e.clientY;
  if (!ptrDrag.active) {
    // しきい値未満はクリック扱い（テキスト選択やタップを妨げない）
    const moved = Math.hypot(e.clientX - ptrDrag.startX, e.clientY - ptrDrag.startY);
    if (moved < DRAG_THRESHOLD_PX) return;
    liftPlate();
  }
  updateDragPosition();
}

// カードのクローンを作って「持ち上げる」
function liftPlate() {
  const entry = ptrDrag.entry;
  const item = entry.querySelector(".tl-item");
  const entryRect = entry.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  onEntryDragStart(null, entry, ptrDrag.idx); // 既存ロジックで dragCtx を作り、元位置を点線化
  ptrDrag.active = true;
  ptrDrag.startScrollTop = ptrDrag.tl.scrollTop;
  ptrDrag.itemOffsetY = itemRect.top - entryRect.top; // entry 先頭（移動区間）からカードまでの距離
  ptrDrag.ghostTop = itemRect.top;
  const ghost = item.cloneNode(true);
  ghost.classList.add("tl-drag-ghost");
  // cloneNode は input の「現在値」を写さないためコピーする
  const srcFields = item.querySelectorAll("input, select");
  ghost.querySelectorAll("input, select").forEach((el, i) => { if (srcFields[i]) el.value = srcFields[i].value; });
  ghost.style.left = `${itemRect.left}px`;
  ghost.style.top = `${itemRect.top}px`;
  ghost.style.width = `${itemRect.width}px`;
  document.body.appendChild(ghost);
  ptrDrag.ghost = ghost;
  ptrDrag.tl.classList.add("tl-dragging");
  document.addEventListener("keydown", onDragKeydown);
}

// ゴーストをポインタに追従させ、挿入位置を更新する
function updateDragPosition() {
  const dx = ptrDrag.lastX - ptrDrag.startX;
  const dy = ptrDrag.lastY - ptrDrag.startY;
  ptrDrag.ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.02) rotate(1.5deg)`;
  // others の midY はドラッグ開始時の座標なので、その後のスクロール分を足して比較する
  const scrollDelta = ptrDrag.tl.scrollTop - ptrDrag.startScrollTop;
  onTimelineDragOver({ clientY: ptrDrag.lastY + scrollDelta, preventDefault() {} });
  updateAutoScroll();
}

// 画面端に近づいたらタイムラインを自動スクロールする（簡易版）
function updateAutoScroll() {
  const r = ptrDrag.tl.getBoundingClientRect();
  let v = 0;
  if (ptrDrag.lastY < r.top + AUTOSCROLL_ZONE_PX) v = -8;
  else if (ptrDrag.lastY > r.bottom - AUTOSCROLL_ZONE_PX) v = 8;
  ptrDrag.scrollVel = v;
  if (v !== 0 && !ptrDrag.rafId) ptrDrag.rafId = requestAnimationFrame(autoScrollTick);
}

function autoScrollTick() {
  if (!ptrDrag || !ptrDrag.active) return;
  ptrDrag.rafId = 0;
  if (!ptrDrag.scrollVel) return;
  const tl = ptrDrag.tl;
  const before = tl.scrollTop;
  tl.scrollTop = before + ptrDrag.scrollVel;
  if (tl.scrollTop === before) { ptrDrag.scrollVel = 0; return; } // 端まで来たら止める
  const scrollDelta = tl.scrollTop - ptrDrag.startScrollTop;
  onTimelineDragOver({ clientY: ptrDrag.lastY + scrollDelta, preventDefault() {} });
  ptrDrag.rafId = requestAnimationFrame(autoScrollTick);
}

function onEntryPointerUp(e) {
  if (!ptrDrag || e.pointerId !== ptrDrag.pointerId) return;
  if (!ptrDrag.active) { detachPointerListeners(); ptrDrag = null; return; } // ただのクリック/タップ
  settlePlate();
}

function onEntryPointerCancel(e) {
  if (!ptrDrag || e.pointerId !== ptrDrag.pointerId) return;
  cancelPlateDrag();
}

function onDragKeydown(e) {
  if (e.key === "Escape") { e.preventDefault(); cancelPlateDrag(); }
}

// 置き先（空いた隙間）へ吸い付くアニメーションの後、並び順を確定する
function settlePlate() {
  const { target, height, others } = dragCtx;
  const p = ptrDrag;
  detachPointerListeners();
  stopAutoScroll();
  ptrDrag = null; // 以後の入力は受け付けない（dragCtx が残っている間は新規ドラッグも不可）
  if (others.length > 0) {
    // 隙間の上端 = ずらし済みの実要素の現在位置（transform 込み）から求める
    const gapTop = target === 0
      ? others[0].el.getBoundingClientRect().top - height
      : others[target - 1].el.getBoundingClientRect().bottom;
    p.ghost.classList.add("settling"); // 影を通常の高さ（elevation 1）へ戻す
    p.ghost.style.transition = "transform 0.16s ease, box-shadow 0.16s ease";
    p.ghost.style.transform = `translate(0px, ${gapTop + p.itemOffsetY - p.ghostTop}px)`;
  }
  setTimeout(() => {
    p.ghost.remove();
    p.tl.classList.remove("tl-dragging");
    document.removeEventListener("keydown", onDragKeydown);
    onTimelineDrop({ preventDefault() {} }); // 既存の確定処理（clearDragState + moveItem）
  }, 170);
}

// ドラッグを中止して元に戻す（Esc / pointercancel）
function cancelPlateDrag() {
  if (!ptrDrag) return;
  if (ptrDrag.ghost) ptrDrag.ghost.remove();
  detachPointerListeners();
  stopAutoScroll();
  ptrDrag.tl.classList.remove("tl-dragging");
  document.removeEventListener("keydown", onDragKeydown);
  ptrDrag = null;
  clearDragState(); // 他カードの transform と点線表示を戻す
}

function detachPointerListeners() {
  const entry = ptrDrag.entry;
  try { entry.releasePointerCapture(ptrDrag.pointerId); } catch (err) { /* 既に解放済みなら無視 */ }
  entry.removeEventListener("pointermove", onEntryPointerMove);
  entry.removeEventListener("pointerup", onEntryPointerUp);
  entry.removeEventListener("pointercancel", onEntryPointerCancel);
}

function stopAutoScroll() {
  if (!ptrDrag) return;
  if (ptrDrag.rafId) { cancelAnimationFrame(ptrDrag.rafId); ptrDrag.rafId = 0; }
  ptrDrag.scrollVel = 0;
}

// ---- 挿入位置の計算と確定（スモークテストからも直接呼ばれる共通ロジック） ----

// ドラッグ開始時点の各エントリ位置を記録し、元位置をプレースホルダー化する
function onEntryDragStart(e, entry, idx) {
  const entries = Array.from(document.querySelectorAll("#timeline .tl-entry"));
  dragCtx = {
    from: idx,
    target: idx,
    height: entry.getBoundingClientRect().height,
    others: entries.filter((el) => el !== entry).map((el) => {
      const r = el.getBoundingClientRect();
      return { el, midY: r.top + r.height / 2 };
    })
  };
  // ゴースト生成後のフレームで元の位置を点線プレースホルダー化する
  requestAnimationFrame(() => entry.classList.add("drag-source"));
}

function onTimelineDragOver(e) {
  if (!dragCtx) return;
  e.preventDefault();
  // 挿入位置 = カーソルより上に中心がある項目の数（中心を跨ぐと隙間が移る）
  const f = dragCtx.others.filter((o) => o.midY < e.clientY).length;
  if (f === dragCtx.target) return;
  dragCtx.target = f;
  const d = dragCtx.from;
  dragCtx.others.forEach((o, q) => {
    // 元の位置(qがd以降なら+1)と挿入後の位置(qがf以降なら+1)の差分だけずらす
    const shift = ((q >= f ? 1 : 0) - (q >= d ? 1 : 0)) * dragCtx.height;
    o.el.style.transform = shift ? `translateY(${shift}px)` : "";
  });
}

function onTimelineDrop(e) {
  if (!dragCtx) return;
  e.preventDefault();
  const { from, target } = dragCtx;
  clearDragState();
  if (from !== target) moveItem(state.activeDay, from, target);
}

function clearDragState() {
  if (!dragCtx) return;
  dragCtx.others.forEach((o) => { o.el.style.transform = ""; });
  document.querySelectorAll("#timeline .drag-source").forEach((el) => el.classList.remove("drag-source"));
  dragCtx = null;
}

// ---------- 移動区間カード ----------
// 開いている区間ピッカー（"日>予定index"）。再描画しても開いたままにする
let openSegmentKey = null;

function buildSegmentCard(dayIdx, itemIdx, it) {
  const t = it.travel || { mode: "transit", min: it.travelMin || 0, price: 0, lines: [], source: "estimate" };
  const modeDef = TRAVEL_MODES[t.mode] || TRAVEL_MODES.transit;
  const segKey = `${dayIdx}>${itemIdx}`;
  const open = openSegmentKey === segKey;
  const wrap = document.createElement("div");
  wrap.className = "seg";

  // 路線名（Routes API 取得時のみ入る）
  const linesHtml = (t.lines || []).filter((l) => l.name).map((l) =>
    `<span class="seg-line"><span class="material-symbols-outlined">${escapeHtml(l.icon || "directions_transit")}</span>${escapeHtml(l.name)}</span>`
  ).join('<span class="seg-arrow">›</span>');
  const priceHtml = t.mode === "walk" ? "" :
    `<span class="seg-price">${yen(Number(t.price) || 0)}${t.source === "estimate" ? '<span class="seg-approx">概算</span>' : ""}</span>`;

  const main = document.createElement("button");
  main.className = "seg-main";
  main.title = "クリックで移動手段の変更・時間や料金の手修正ができます";
  main.innerHTML = `
    <span class="material-symbols-outlined seg-icon">${modeDef.icon}</span>
    <span class="seg-label">${modeDef.label}</span>
    ${linesHtml ? `<span class="seg-lines">${linesHtml}</span>` : ""}
    <span class="seg-time">${fmtDuration(Number(t.min) || 0)}</span>
    ${priceHtml}
    <span class="material-symbols-outlined seg-caret">${open ? "expand_less" : "expand_more"}</span>
  `;
  main.onclick = () => {
    openSegmentKey = open ? null : segKey;
    renderTimeline();
  };
  wrap.appendChild(main);
  if (open) wrap.appendChild(buildSegmentPicker(dayIdx, itemIdx, it, t));
  return wrap;
}

// 手段の選択肢と手修正欄
function buildSegmentPicker(dayIdx, itemIdx, it, t) {
  const from = segmentFrom(dayIdx, itemIdx).point;
  const to = findSpot(it.spotId);
  const km = from && to && from.lat != null && to.lat != null ? distanceKm(from, to) * 1.3 : null;
  const box = document.createElement("div");
  box.className = "seg-picker";
  Object.keys(TRAVEL_MODES).forEach((mode) => {
    if (mode === "walk" && km != null && km > 6) return; // 徒歩圏外は候補に出さない
    const est = estimateModeOption(mode, from, to);
    const row = document.createElement("button");
    row.className = "seg-option" + (t.mode === mode ? " selected" : "");
    row.innerHTML = `
      <span class="material-symbols-outlined">${TRAVEL_MODES[mode].icon}</span>
      <span class="seg-opt-label">${TRAVEL_MODES[mode].label}</span>
      <span class="seg-opt-meta">${fmtDuration(est.min)}${mode === "walk" ? "" : "・" + yen(est.price) + "〜"}</span>
    `;
    row.onclick = () => setSegmentMode(dayIdx, itemIdx, mode);
    box.appendChild(row);
  });
  const edit = document.createElement("div");
  edit.className = "seg-edit";
  edit.innerHTML = `
    <label>時間 <input type="number" min="0" step="5" value="${Number(t.min) || 0}" data-f="min">分</label>
    <label>料金 <input type="number" min="0" step="10" value="${Number(t.price) || 0}" data-f="price">円</label>
  `;
  edit.querySelectorAll("input").forEach((input) => {
    input.onchange = (e) => {
      const v = Number(e.target.value) || 0;
      if (e.target.dataset.f === "min") { t.min = v; it.travelMin = v; }
      else t.price = v;
      t.source = "manual"; // 手修正は見積もり直しやGoogle照会で上書きしない
      saveState();
      renderAll();
    };
  });
  box.appendChild(edit);
  // Googleマップで実経路を確認するリンク（電車・バスは路線・運賃の確認→手修正に使う）
  if (from && to && from.lat != null && to.lat != null) {
    const gmode = { walk: "walking", transit: "transit", car: "driving" }[t.mode] || "transit";
    const a = document.createElement("a");
    a.className = "seg-gmaps-link";
    a.href = "https://www.google.com/maps/dir/?api=1"
      + `&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${gmode}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.innerHTML = '<span class="material-symbols-outlined">open_in_new</span>Googleマップで経路を見る（路線・運賃の確認）';
    box.appendChild(a);
  }
  if (typeof TravelMap !== "undefined" && TravelMap.isGoogle && !routesApiAvailable) {
    const hint = document.createElement("div");
    hint.className = "seg-hint";
    hint.textContent = "徒歩・車の実所要時間の取得には Google Cloud で Routes API の有効化が必要です（README参照）";
    box.appendChild(hint);
  } else if (t.mode === "transit" && t.noRoute) {
    const hint = document.createElement("div");
    hint.className = "seg-hint";
    hint.textContent = "日本の乗換データはAPIから取得できないため概算表示です。上のリンクで実際の路線・運賃を確認し、時間・料金を手修正できます";
    box.appendChild(hint);
  }
  return box;
}

// ---------- 合計 ----------
function renderTotals() {
  const dayEl = document.getElementById("day-total");
  if (dayEl) dayEl.textContent = yen(dayTotal(state.days[state.activeDay]));
  const moveEl = document.getElementById("move-total");
  if (moveEl) moveEl.textContent = yen(moveTotal());
  document.getElementById("spot-total").textContent = yen(spotTotal());
  document.getElementById("hotel-total").textContent = yen(hotelTotal());
  document.getElementById("transport-total").textContent = yen(transportTotal());
  document.getElementById("grand-total").textContent = yen(grandTotal());
}

// ============================================================
// 地図表示（実体は map.js の TravelMap アダプタ。テスト環境では未定義なのでスキップ）
// ============================================================
// 地図マーカー用：Material Symbols のアイコン名 → 絵文字
const ICON_EMOJI = {
  flight: "✈️", train: "🚄", directions_bus: "🚌", directions_boat: "⛴️",
  directions_railway: "🚃", directions_car: "🚗", subway: "🚇", tram: "🚋", commute: "🚃"
};

// 出発地からの経路（往路・復路）を地図用に組み立てる
// 戻り値: [{ points: [{lat,lng,name,emoji}], attach: "before"|"after" }]
//   before: 1日目の最初のスポットへつなぐ／after: 最終日の最後のスポットからつなぐ
function buildJourneys() {
  const journeys = [];
  const o = state.origin;
  const isFirst = state.activeDay === 0;
  const isLast = state.activeDay === state.days.length - 1;
  const legPoints = (t) => (t && t.legs ? t.legs
    .filter((l) => l.toLat != null && l.toLng != null)
    .map((l) => ({ lat: l.toLat, lng: l.toLng, name: l.toName, emoji: ICON_EMOJI[l.icon] || "🚏" })) : []);
  if (isFirst && state.transport.out) {
    const pts = legPoints(state.transport.out);
    if (o && o.lat != null) pts.unshift({ lat: o.lat, lng: o.lng, name: o.name, emoji: "🏠" });
    if (pts.length > 0) journeys.push({ points: pts, attach: "before" });
  }
  if (isLast && state.transport.ret) {
    const pts = legPoints(state.transport.ret).reverse(); // 帰りは逆順にたどる
    if (o && o.lat != null) pts.push({ lat: o.lat, lng: o.lng, name: o.name, emoji: "🏠" });
    if (pts.length > 0) journeys.push({ points: pts, attach: "after" });
  }
  return journeys;
}

// 次の地図描画でフォーカスする地点（スポット追加時に設定、1回で消費）
let mapFocus = null;

function renderMapView() {
  const focus = mapFocus;
  mapFocus = null;
  if (typeof TravelMap === "undefined") return;
  // 候補スポット（未追加のもの）
  const candidates = spotsForRegion().filter((s) => !isAdded(s.id));
  // エリアの人気スポット（未登録のもの）も小さい丸ピンで表示する
  // placeId・評価はピンクリック時のポップアップ表示に使う
  popularResults.forEach((r) => {
    if (isPlaceRegistered(r.placeId)) return;
    candidates.push({
      lat: r.lat, lng: r.lng, name: r.name, desc: r.address,
      category: guessCategory(r.types),
      placeId: r.placeId, rating: r.rating, ratingCount: r.ratingCount
    });
  });
  // 表示中の日の予定（訪問順）
  const day = state.days[state.activeDay];
  const route = day.items
    .map((it) => {
      const s = findSpot(it.spotId);
      // spotId はピンクリック時のポップアップ（詳細キャッシュ共用）に使う
      return s ? { spotId: it.spotId, lat: s.lat, lng: s.lng, name: s.name, desc: s.desc } : null;
    })
    .filter(Boolean);
  // その日の宿（最終日タブでは前夜の宿を表示）
  const hotelDay = state.activeDay >= state.days.length - 1 ? state.days.length - 2 : state.activeDay;
  const hotel = hotelDay >= 0 ? state.days[hotelDay].hotel : null;
  TravelMap.render(candidates, route, hotel, buildJourneys(), focus);
}

function flyToRegion() {
  if (typeof TravelMap === "undefined") return;
  const c = destCenter();
  if (c) TravelMap.flyTo({ lat: c.lat, lng: c.lng }, c.zoom);
}

// 地図クリック時の処理（スポットポップアップを閉じる。位置指定モード中は位置を拾う）
function onMapClick(latlng) {
  hideSpotMapPopup();
  if (!pickingLocation) return;
  pickedLatLng = latlng;
  pickingLocation = false;
  document.getElementById("pick-location-btn").classList.remove("picking");
  document.getElementById("picked-location").textContent =
    `位置：指定済み（${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}）`;
}

// ============================================================
// Google Places 検索（APIキー設定時のみ有効）
// ============================================================
const FOOD_TYPE_KEYWORDS = ["restaurant", "food", "cafe", "coffee", "bakery", "bar", "meal"];
function guessCategory(types) {
  // 検索結果によっては types を持たないため、欠落時は観光扱いにする
  return Array.isArray(types) && types.some((t) => FOOD_TYPE_KEYWORDS.some((k) => t.includes(k)))
    ? "food" : "sightseeing";
}

function setupGoogleSearch() {
  if (typeof TravelMap === "undefined" || !TravelMap.isGoogle) return;
  const box = document.getElementById("google-search");
  box.hidden = false;
  const input = document.getElementById("place-query");
  const searchBtn = document.getElementById("place-search-btn");
  if (searchBtn) searchBtn.onclick = runPlaceSearch;
  input.addEventListener("keydown", (e) => {
    // IME変換確定のEnter（isComposing / keyCode 229）では検索しない
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) runPlaceSearch();
  });
  // 検索欄を空にしたら結果一覧も消す
  input.addEventListener("input", () => {
    if (input.value.trim() === "") {
      document.getElementById("place-results").innerHTML = "";
    }
  });
}

async function runPlaceSearch() {
  const query = document.getElementById("place-query").value.trim();
  const ul = document.getElementById("place-results");
  if (!query) return;
  ul.innerHTML = '<li class="place-status">検索中…</li>';
  try {
    // 「京都 ○○」のように地域名を付けると精度が上がる
    const results = await TravelMap.searchPlaces(`${state.region} ${query}`);
    renderPlaceResults(results);
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="place-status">検索に失敗しました。APIキーの設定を確認してください。</li>';
  }
}

function renderPlaceResults(results) {
  const ul = document.getElementById("place-results");
  ul.innerHTML = "";
  if (results.length === 0) {
    ul.innerHTML = '<li class="place-status">見つかりませんでした</li>';
    return;
  }
  results.forEach((r) => {
    const li = document.createElement("li");
    li.className = "place-result";
    const rating = r.rating != null
      ? `<span class="pr-rating">★ ${r.rating} <span class="count">(${(r.ratingCount || 0).toLocaleString()}件)</span></span>`
      : "";
    li.innerHTML = `
      <div class="pr-info">
        <div class="pr-name">${escapeHtml(r.name)} ${rating}</div>
        <div class="pr-address">${escapeHtml(r.address)}</div>
      </div>
    `;
    li.querySelector(".pr-info").onclick = () => openPlaceDetail(r); // 行クリックで詳細＋地図移動
    li.appendChild(buildAddSpotButton(r));
    ul.appendChild(li);
  });
}

// ============================================================
// このエリアの人気スポット（Googleモードのみ・stateに保存しない）
// 地図の表示範囲（または行き先の中心周辺）の人気の観光スポット・
// レストランを候補として提案する
// ============================================================
let popularResults = [];
let popularLoading = false;
// 任意行き先（サンプルデータなし）用の宿候補（Places lodging検索・非永続）
let hotelPlaceResults = [];

function setupPopularSpots() {
  if (!isGoogleMode()) return; // Leafletモードでは出さない
  const box = document.getElementById("popular-spots");
  if (box) box.hidden = false;
  // 更新ボタンは地図上に浮かせる（Googleマップの「このエリアを検索」と同じ流儀）
  const mapBtn = document.getElementById("popular-map-btn");
  if (mapBtn) {
    mapBtn.hidden = false;
    mapBtn.onclick = () => refreshPopularSpots(false); // 手動更新は地図の表示範囲で
  }
  refreshPopularSpots(true); // 初回は行き先の中心周辺で自動取得
}

// useDestCenter: true なら行き先中心の円で検索（行き先変更直後は地図の移動が
// 終わっておらず表示範囲が古いため）。false なら地図の表示範囲で検索
async function refreshPopularSpots(useDestCenter) {
  if (!isGoogleMode()) return;
  const ul = document.getElementById("popular-results");
  if (!ul) return;
  popularLoading = true;
  renderPopularSpots();
  const opts = {};
  if (useDestCenter) {
    const c = destCenter();
    if (c) {
      opts.center = { lat: c.lat, lng: c.lng };
      // ズームが引きの地域（沖縄など）は広めに探す
      opts.radius = c.zoom >= 12 ? 5000 : c.zoom >= 11 ? 10000 : 25000;
    }
  }
  try {
    // 任意行き先ではサンプルの宿データが無いので、宿（lodging）も同時に探す
    const needHotels = !!state.customDest;
    const [sights, foods, lodgings] = await Promise.all([
      TravelMap.searchPopularSpots(Object.assign({ food: false }, opts)),
      TravelMap.searchPopularSpots(Object.assign({ food: true }, opts)),
      needHotels ? TravelMap.searchPopularSpots(Object.assign({ types: ["lodging"] }, opts)) : Promise.resolve([])
    ]);
    // 観光→グルメの順で連結し、重複placeIdとサンプル候補と同名のものを除く
    const seen = new Set();
    const sampleNames = new Set((SPOT_DATA[state.region] || []).map((s) => s.name));
    popularResults = sights.concat(foods).filter((r) => {
      if (r.placeId == null || seen.has(r.placeId)) return false;
      seen.add(r.placeId);
      return !sampleNames.has(r.name);
    });
    hotelPlaceResults = needHotels ? lodgings : [];
    popularLoading = false;
  } catch (e) {
    console.error(e);
    popularResults = [];
    hotelPlaceResults = [];
    popularLoading = false;
    ul.innerHTML = '<li class="place-status">取得に失敗しました。時間をおいてお試しください</li>';
    return;
  }
  renderPopularSpots();
  renderHotelList(); // 任意行き先の宿候補を反映
  renderMapView(); // 人気スポットの候補ピンを地図に立てる
}

// 人気スポットの描画。候補リストの絞り込み（観光/グルメ・名前）をここにも適用する
function renderPopularSpots() {
  const ul = document.getElementById("popular-results");
  if (!ul) return;
  if (popularLoading) {
    ul.innerHTML = '<li class="place-status">人気スポットを探しています…</li>';
    return;
  }
  ul.innerHTML = "";
  if (filter.category === "custom") {
    ul.innerHTML = '<li class="place-status">「マイ追加」の絞り込み中は表示しません</li>';
    return;
  }
  const list = popularResults.filter((r) => {
    const cat = guessCategory(r.types);
    if (filter.category !== "all" && cat !== filter.category) return false;
    if (filter.text && !r.name.includes(filter.text)) return false;
    return true;
  });
  if (list.length === 0) {
    ul.innerHTML = '<li class="place-status">この範囲では見つかりませんでした。「この範囲で更新」で探し直せます</li>';
    return;
  }
  list.forEach((r) => {
    const li = document.createElement("li");
    li.className = "place-result";
    const cat = guessCategory(r.types);
    const catLabel = cat === "food" ? "グルメ" : "観光";
    const catClass = cat === "food" ? "cat-food" : "cat-sightseeing";
    const rating = r.rating != null
      ? `<span class="pr-rating">★ ${r.rating} <span class="count">(${(r.ratingCount || 0).toLocaleString()}件)</span></span>`
      : "";
    li.innerHTML = `
      <div class="pr-info">
        <div class="pr-name"><span class="cat-badge ${catClass}">${catLabel}</span>${escapeHtml(r.name)} ${rating}</div>
        <div class="pr-address">${escapeHtml(r.address)}</div>
      </div>
    `;
    li.querySelector(".pr-info").onclick = () => openPlaceDetail(r); // 行クリックで詳細＋地図移動
    li.appendChild(buildAddSpotButton(r));
    ul.appendChild(li);
  });
}

// 検索結果の「候補に追加」ボタンを作る（左パネル・地図上の検索で共用）
// 登録済み（同じplaceIdが候補にある）なら最初から「追加済み」で描画し二重追加を防ぐ
function buildAddSpotButton(r) {
  const btn = document.createElement("button");
  btn.className = "add-spot-btn";
  if (isPlaceRegistered(r.placeId)) {
    btn.textContent = "追加済み";
    btn.disabled = true;
  } else {
    btn.textContent = "候補に追加";
    btn.onclick = (e) => {
      e.stopPropagation();
      addPlaceAsSpot(r);
      btn.textContent = "追加済み";
      btn.disabled = true;
    };
  }
  return btn;
}

// ============================================================
// 地図上の検索（Googleモードのみ）
// 地図の表示範囲内で検索し、仮ピン＋結果リストから候補に追加できる。
// 仮ピン・検索状態は state に保存しない（セーブデータ形式は不変）
// ============================================================
let mapSearch = { query: "", boundsSig: null, searching: false };
// 結果ボトムシートの表示状態:
// "hidden"（非表示）| "full"（全開=地図2:シート8）| "open"（半開=地図6:シート4）| "peek"（つまみだけ）
let mapSheet = { state: "hidden" };

// シートの表示状態を切り替える（スナップ位置はCSSクラス .full / .peek に任せる）
function setMapSheet(state) {
  mapSheet.state = state;
  const sheet = document.getElementById("map-results-sheet");
  if (!sheet) return;
  sheet.hidden = state === "hidden";
  sheet.classList.remove("peek");
  sheet.classList.remove("full");
  if (state === "peek") sheet.classList.add("peek");
  if (state === "full") sheet.classList.add("full");
  sheet.style.transform = ""; // ドラッグ中の位置指定を解除してスナップ位置へ戻す
  const handle = document.getElementById("map-sheet-handle");
  if (handle) handle.setAttribute("aria-expanded", state === "peek" ? "false" : "true");
}

// つまみのタップ: 全開→半開、半開→つまみだけ、つまみだけ→半開
function toggleMapSheet() {
  if (mapSheet.state === "full") setMapSheet("open");
  else setMapSheet(mapSheet.state === "open" ? "peek" : "open");
}

function setMapSheetTitle(text) {
  const t = document.getElementById("map-sheet-title");
  if (t) t.textContent = text;
}

function setupMapSearch() {
  if (typeof TravelMap === "undefined" || !TravelMap.isGoogle) return; // Leaflet時はUIを出さない
  const box = document.getElementById("map-search");
  if (!box) return;
  box.hidden = false;
  const input = document.getElementById("map-search-input");
  const searchBtn = document.getElementById("map-search-btn");
  const clearBtn = document.getElementById("map-search-clear");
  if (searchBtn) searchBtn.onclick = runMapSearch;
  input.addEventListener("keydown", (e) => {
    // IME変換確定のEnter（isComposing / keyCode 229）では検索しない
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) runMapSearch();
  });
  input.addEventListener("input", () => {
    if (clearBtn) clearBtn.hidden = input.value === "";
    // 検索欄を空にしたら仮ピン・結果リストも消す
    if (input.value.trim() === "") clearMapSearch();
  });
  if (clearBtn) clearBtn.onclick = clearMapSearch;
  document.getElementById("map-research-btn").onclick = runMapSearch;
  // パン・ズーム後に「このエリアを検索」を出す（地図移動のたびの自動検索はしない）
  TravelMap.onViewportChange(onMapViewportChanged);
  // 地図上のA〜H仮ピンのクリックでも詳細を開けるようにする
  if (TravelMap.onSearchPinClick) TravelMap.onSearchPinClick(onSearchPinClicked);
  setupMapSheetDrag();
}

// i番目の結果行に選択強調を付け替える（リスト行クリック・仮ピンクリックで共用）
function selectMapResultRow(i) {
  const ul = document.getElementById("map-search-results");
  if (!ul || !ul.querySelectorAll) return;
  ul.querySelectorAll(".place-result.selected").forEach((c) => c.classList.remove("selected"));
  const li = ul.children && ul.children[i];
  if (li && li.classList) li.classList.add("selected");
}

// 仮ピンクリック：対応する結果の詳細を開く（リスト行クリックと同じ挙動）。
// 別のスポットの詳細を開いている最中でも、そのままクリック先の詳細に切り替わる
function onSearchPinClicked(i) {
  const r = mapSearch.results && mapSearch.results[i];
  if (!r) return;
  TravelMap.highlightSearchPin(i);
  selectMapResultRow(i);
  openMapSheetDetail(r);
}

// 結果シートのつまみをドラッグ/スワイプ/タップで開閉する（Pointer Eventsでマウス・タッチ共通）
function setupMapSheetDrag() {
  const sheet = document.getElementById("map-results-sheet");
  const handle = document.getElementById("map-sheet-handle");
  if (!sheet || !handle || !handle.setPointerCapture) return; // DOMスタブ（テスト）では何もしない
  const HANDLE_H = 44; // つまみの高さ（CSSの .peek と合わせる）
  // 3段階のスナップ位置（translateYのpx）: full=0 / open=シートの半分 / peek=つまみだけ
  const snapY = () => ({
    full: 0,
    open: Math.round(sheet.offsetHeight / 2),
    peek: Math.max(0, sheet.offsetHeight - HANDLE_H)
  });
  const clampY = (y) => Math.min(Math.max(y, 0), snapY().peek);
  let drag = null;
  handle.addEventListener("pointerdown", (e) => {
    drag = { startY: e.clientY, base: snapY()[mapSheet.state] || 0, moved: false };
    handle.setPointerCapture(e.pointerId);
    sheet.classList.add("dragging"); // ドラッグ中はtransitionを切って指に追従
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dy) > 5) drag.moved = true;
    sheet.style.transform = `translateY(${clampY(drag.base + dy)}px)`;
  });
  handle.addEventListener("pointerup", (e) => {
    if (!drag) return;
    sheet.classList.remove("dragging");
    if (!drag.moved) {
      toggleMapSheet(); // ほぼ動かさず離した＝タップとして開閉
    } else {
      // 離した位置から一番近いスナップ位置（full/open/peek）へ
      const y = clampY(drag.base + (e.clientY - drag.startY));
      const s = snapY();
      let best = "open";
      ["full", "open", "peek"].forEach((k) => {
        if (Math.abs(y - s[k]) < Math.abs(y - s[best])) best = k;
      });
      setMapSheet(best);
    }
    drag = null;
  });
  handle.addEventListener("pointercancel", () => {
    if (!drag) return;
    sheet.classList.remove("dragging");
    setMapSheet(mapSheet.state); // 中断時は元の位置へ戻す
    drag = null;
  });
  // キーボードでも操作できるようにする（つまみは role="button"）
  // Enter/Space=タップと同じ、↑=一段広げる、↓=一段狭める
  const RAISE = { peek: "open", open: "full", full: "full" };
  const LOWER = { full: "open", open: "peek", peek: "peek" };
  handle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleMapSheet(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setMapSheet(RAISE[mapSheet.state] || "open"); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setMapSheet(LOWER[mapSheet.state] || "peek"); }
  });
}

async function runMapSearch() {
  if (typeof TravelMap === "undefined" || !TravelMap.isGoogle) return;
  const input = document.getElementById("map-search-input");
  const query = input.value.trim();
  if (!query) return;
  if (mapSearch.searching) return; // 実行中の二重実行を防ぐ（API節約）
  const sig = TravelMap.getBoundsSig();
  if (query === mapSearch.query && sig != null && sig === mapSearch.boundsSig) {
    // 同一キーワード・同一範囲の連打はスキップ（API節約）
    document.getElementById("map-research-btn").hidden = true;
    return;
  }
  const ul = document.getElementById("map-search-results");
  mapSearch.searching = true;
  ul.innerHTML = '<li class="place-status">検索中…</li>';
  setMapSheetTitle("検索中…");
  setMapSheet("open");
  document.getElementById("map-research-btn").hidden = true;
  try {
    const results = await TravelMap.searchPlaces(query, { bounds: true }); // 表示範囲内に限定
    mapSearch.query = query;
    mapSearch.boundsSig = TravelMap.getBoundsSig();
    renderMapSearchResults(results);
    TravelMap.showSearchPins(results);
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="place-status">検索に失敗しました</li>';
    setMapSheetTitle("検索に失敗しました");
  } finally {
    mapSearch.searching = false;
  }
}

function renderMapSearchResults(results) {
  const ul = document.getElementById("map-search-results");
  ul.innerHTML = "";
  closeMapSheetDetail(); // 新しい結果を描くときは詳細表示をリストに戻す
  mapSearch.results = results; // 詳細から戻るときの再描画用に保持
  setMapSheetTitle(`「${mapSearch.query}」の検索結果 ${results.length}件`);
  setMapSheet("open"); // 結果が出たらシートを展開（つまみで畳める）
  if (results.length === 0) {
    ul.innerHTML = '<li class="place-status">この範囲では見つかりませんでした</li>';
    return;
  }
  results.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "place-result";
    const rating = r.rating != null
      ? `<span class="pr-rating">★ ${r.rating} <span class="count">(${(r.ratingCount || 0).toLocaleString()}件)</span></span>`
      : "";
    li.innerHTML = `
      <span class="msr-label">${String.fromCharCode(65 + i)}</span>
      <div class="pr-info">
        <div class="pr-name">${escapeHtml(r.name)} ${rating}</div>
        <div class="pr-address">${escapeHtml(r.address)}</div>
      </div>
    `;
    // リスト項目のホバーで対応する仮ピン（同じA〜Hラベル）を強調、クリックでシート内詳細を開く
    li.addEventListener("mouseenter", () => TravelMap.highlightSearchPin(i));
    li.addEventListener("mouseleave", () => TravelMap.highlightSearchPin(-1));
    li.addEventListener("click", () => {
      TravelMap.highlightSearchPin(i);
      // 選択中の行を強調（全画面パネルで本家風に見せる。通常時はリストが隠れるので影響なし）
      selectMapResultRow(i);
      openMapSheetDetail(r);
    });
    li.appendChild(buildAddSpotButton(r)); // 左パネル検索と同じ登録処理を再利用
    ul.appendChild(li);
  });
}

// 地図の全画面表示（自前ボタン）
// #map 単体ではなく .map-wrap ごと全画面化することで、検索欄・結果シート・
// 「このエリアを検索」などの重ねているUIを全画面中もそのまま使えるようにする
function setupMapFullscreen() {
  const btn = document.getElementById("map-fullscreen-btn");
  const wrap = document.querySelector(".map-wrap");
  if (!btn || !wrap || !wrap.requestFullscreen) return; // 非対応環境・テスト用スタブでは何もしない
  btn.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.requestFullscreen();
  };
  document.addEventListener("fullscreenchange", () => {
    const fs = document.fullscreenElement === wrap;
    const icon = btn.querySelector(".material-symbols-outlined");
    if (icon) icon.textContent = fs ? "fullscreen_exit" : "fullscreen";
    btn.title = fs ? "全画面を終了" : "地図を全画面表示";
    btn.setAttribute("aria-label", btn.title);
    // 詳細モーダル・スナックバーは全画面要素の外にあると描画されないため、全画面中は中へ移す
    [document.getElementById("detail-overlay"), document.getElementById("snackbar")]
      .forEach((el) => { if (el) (fs ? wrap : document.body).appendChild(el); });
    // 詳細表示中にパネル⇔ボトムシートが切り替わった場合、リストの出し分けを合わせ直す
    // （パネル＝リストと詳細を並べる／シート＝詳細だけを表示）
    const detailBox = document.getElementById("map-sheet-detail");
    const resultUl = document.getElementById("map-search-results");
    if (detailBox && resultUl && !detailBox.hidden) resultUl.hidden = !isMapPanelMode();
    if (TravelMap.resize) TravelMap.resize(); // コンテナのサイズ変更を地図に反映
  });
}

// モバイル：地図パネルがページ最下部で遠いため、画面下中央の浮遊ピルから
// 既存の全画面地図モードを開く。地図パネルが画面内にある間は重複するので隠す
function setupMapJumpButton() {
  const jump = document.getElementById("map-jump-btn");
  const fsBtn = document.getElementById("map-fullscreen-btn");
  const mapPanel = document.querySelector(".panel-map");
  if (!jump || !fsBtn || !mapPanel) return;
  jump.onclick = () => {
    const wrap = document.querySelector(".map-wrap");
    if (wrap && wrap.requestFullscreen) fsBtn.click();
    else mapPanel.scrollIntoView({ behavior: "smooth" }); // 全画面非対応環境は地図まで送る
  };
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      jump.hidden = entries[0].isIntersecting;
    }, { threshold: 0.25 }).observe(mapPanel);
  } else {
    jump.hidden = false;
  }
}

// ---------- シート内詳細（結果タップで開く。リストと入れ替えで表示） ----------
const mapDetailCache = {}; // placeId -> 取得済みのGoogle詳細情報
let mapSheetDetailToken = 0; // 古い取得結果で上書きしないための世代トークン

// 全画面パネルモード（広い画面で .map-wrap を全画面表示中）かどうか。
// このモードでは本家Googleマップのデスクトップと同じく、結果＝左パネル・詳細＝右隣のカードになる
function isMapPanelMode() {
  return typeof window !== "undefined" && window.innerWidth >= 700
    && !!document.fullscreenElement
    && !!(document.fullscreenElement.classList && document.fullscreenElement.classList.contains("map-wrap"));
}

// 全画面パネル時：選んだスポットを、パネル・詳細カードで隠れていない
// 「見えている地図範囲」のちょうど真ん中に置く（本家と同じ挙動）
function panSelectedToVisibleCenter(r) {
  if (!isMapPanelMode() || typeof TravelMap === "undefined" || !TravelMap.panToVisibleCenter) return;
  requestAnimationFrame(() => { // 詳細カード表示後の実寸で隠れ幅を測る
    const wrap = document.querySelector(".map-wrap");
    if (!wrap || !wrap.getBoundingClientRect) return;
    const wr = wrap.getBoundingClientRect();
    let covered = 0;
    [document.getElementById("map-results-sheet"), document.getElementById("map-sheet-detail")]
      .forEach((el) => {
        if (el && !el.hidden && el.getBoundingClientRect) {
          covered = Math.max(covered, el.getBoundingClientRect().right - wr.left);
        }
      });
    if (covered < wr.width) TravelMap.panToVisibleCenter({ lat: r.lat, lng: r.lng }, covered);
  });
}

async function openMapSheetDetail(r) {
  const my = ++mapSheetDetailToken;
  const box = document.getElementById("map-sheet-detail");
  const ul = document.getElementById("map-search-results");
  if (!box || !ul) return;
  const panel = isMapPanelMode();
  ul.hidden = !panel; // パネルモードではリストを出したまま右に詳細カードを並べる
  box.hidden = false;
  setMapSheet("open"); // peek中にタップされた場合も展開する
  if (!panel) setMapSheetTitle(r.name); // パネルモードでは件数タイトルのまま
  panSelectedToVisibleCenter(r);
  renderMapSheetDetail(r, mapDetailCache[r.placeId] || null, !mapDetailCache[r.placeId]);
  if (mapDetailCache[r.placeId]) return; // 取得済みならAPIを呼ばない
  try {
    const g = await TravelMap.getPlaceDetails({
      placeId: r.placeId || null,
      query: `${r.name} ${state.region}`,
      lat: r.lat,
      lng: r.lng
    });
    if (g && r.placeId) mapDetailCache[r.placeId] = g;
    if (my !== mapSheetDetailToken) return; // 取得中に戻る・別の詳細を開いた
    renderMapSheetDetail(r, g, false, g ? undefined : "Googleで詳細が見つかりませんでした");
  } catch (e) {
    console.error(e);
    if (my !== mapSheetDetailToken) return;
    renderMapSheetDetail(r, null, false, "詳細の取得に失敗しました");
  }
}

function renderMapSheetDetail(r, g, loading, errMsg) {
  const box = document.getElementById("map-sheet-detail");
  if (!box) return;
  box.innerHTML = "";
  // ヘッダー（戻る＋候補に追加）。追加ボタンは既存の共通処理で活性状態を揃える
  const head = document.createElement("div");
  head.className = "sheet-detail-head";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "sheet-back-btn";
  back.innerHTML = '<span class="material-symbols-outlined">arrow_back</span>検索結果に戻る';
  back.onclick = backToMapResults;
  head.appendChild(back);
  head.appendChild(buildAddSpotButton(r));
  box.appendChild(head);
  // 本文（詳細モーダルとHTML・CSSクラスを共用）
  const body = document.createElement("div");
  const rating = r.rating != null
    ? ` <span class="pr-rating">★ ${r.rating} <span class="count">(${(r.ratingCount || 0).toLocaleString()}件)</span></span>`
    : "";
  let html = `<h3 class="detail-name sheet-detail-name">${escapeHtml(r.name)}${rating}</h3>`;
  if (g) {
    html += buildGoogleDetailHtml(g);
  } else {
    if (r.address) html += `<ul class="detail-facts"><li><span class="material-symbols-outlined">location_on</span>${escapeHtml(r.address)}</li></ul>`;
    if (loading) html += '<p class="place-status">Google の情報を読み込み中…</p>';
    else if (errMsg) html += `<p class="place-status">${escapeHtml(errMsg)}</p>`;
  }
  body.innerHTML = html;
  box.appendChild(body);
  box.scrollTop = 0;
}

// 詳細を閉じてリスト表示に戻す
function closeMapSheetDetail() {
  mapSheetDetailToken++; // 取得途中の結果で上書きされないようにする
  const box = document.getElementById("map-sheet-detail");
  const ul = document.getElementById("map-search-results");
  if (box) { box.hidden = true; box.innerHTML = ""; }
  if (ul) ul.hidden = false;
}

// 「検索結果に戻る」：リストを再描画して戻す
// （詳細内で候補に追加した場合の「追加済み」表示をリスト側にも反映するため）
function backToMapResults() {
  if (mapSearch.results) renderMapSearchResults(mapSearch.results);
  else closeMapSheetDetail();
}

// パン・ズーム完了時：検索済みで、かつ範囲が検索時から変わっていればボタンを出す
function onMapViewportChanged() {
  const btn = document.getElementById("map-research-btn");
  if (!btn) return;
  if (!mapSearch.query || mapSearch.searching) { btn.hidden = true; return; }
  const sig = TravelMap.getBoundsSig();
  btn.hidden = !(sig != null && sig !== mapSearch.boundsSig);
}

// 検索欄・結果リスト・仮ピン・再検索ボタンをまとめて消す（クリア・地域変更・リセット時）
function clearMapSearch() {
  mapSearch = { query: "", boundsSig: null, searching: false };
  closeMapSheetDetail(); // 詳細表示が開いていたら閉じる
  const input = document.getElementById("map-search-input");
  if (input) input.value = "";
  const clearBtn = document.getElementById("map-search-clear");
  if (clearBtn) clearBtn.hidden = true;
  const ul = document.getElementById("map-search-results");
  if (ul) ul.innerHTML = "";
  setMapSheet("hidden"); // 結果シートも畳んで消す
  setMapSheetTitle("");
  const btn = document.getElementById("map-research-btn");
  if (btn) btn.hidden = true;
  if (typeof TravelMap !== "undefined" && TravelMap.clearSearchPins) TravelMap.clearSearchPins();
}

// ---------- 出発地の検索 ----------
async function runOriginSearch() {
  const input = document.getElementById("origin-query");
  const ul = document.getElementById("origin-results");
  const query = input.value.trim();
  if (!query) return;
  // APIキーなしのときは入力した名前をそのまま登録（距離見積もりは不可）
  if (typeof TravelMap === "undefined" || !TravelMap.isGoogle) {
    setOrigin({ name: query, lat: null, lng: null });
    input.value = "";
    return;
  }
  ul.innerHTML = '<li class="place-status">検索中…</li>';
  try {
    // 出発地には評価情報が不要なので基本フィールドのみ要求（API費用の節約）
    const results = await TravelMap.searchPlaces(query, { basic: true });
    ul.innerHTML = "";
    if (results.length === 0) {
      ul.innerHTML = '<li class="place-status">見つかりませんでした</li>';
      return;
    }
    results.slice(0, 5).forEach((r) => {
      const li = document.createElement("li");
      li.className = "place-result";
      li.innerHTML = `
        <div class="pr-info">
          <div class="pr-name">${escapeHtml(r.name)}</div>
          <div class="pr-address">${escapeHtml(r.address)}</div>
        </div>
      `;
      const btn = document.createElement("button");
      btn.className = "add-spot-btn";
      btn.textContent = "出発地にする";
      btn.onclick = () => {
        setOrigin({ name: r.name, lat: r.lat, lng: r.lng });
        input.value = "";
        ul.innerHTML = "";
      };
      li.appendChild(btn);
      ul.appendChild(li);
    });
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="place-status">検索に失敗しました</li>';
  }
}

// 同じGoogleプレイスIDのスポットが候補に登録済みか（再検索時の二重追加防止に使う）
function isPlaceRegistered(placeId) {
  return placeId != null && state.customSpots.some((s) => s.placeId === placeId);
}

// 検索結果を候補スポットとして登録（customSpots の仕組みを再利用）
function addPlaceAsSpot(r) {
  // 保険の重複ガード：同じ場所（placeId）が既に候補にあれば追加せず知らせる
  if (isPlaceRegistered(r.placeId)) {
    const existing = state.customSpots.find((s) => s.placeId === r.placeId);
    highlightSpot(existing.id);
    showSnackbar(`「${r.name}」は登録済みです`);
    return;
  }
  const id = "g-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  state.customSpots.push({
    id,
    placeId: r.placeId || null, // 詳細表示用に Google のプレイスIDを保持
    name: r.name,
    category: guessCategory(r.types),
    desc: r.address,
    lat: r.lat,
    lng: r.lng,
    stayMin: 60,
    cost: 0,
    region: state.region,
    isCustom: true,
    source: "google"
  });
  saveState();
  renderAll();
  // 追加されたことが分かるように、リスト内で強調表示＋通知＋地図を移動
  highlightSpot(id);
  showSnackbar(`「${r.name}」を候補リストに追加しました`);
  if (typeof TravelMap !== "undefined") TravelMap.panTo({ lat: r.lat, lng: r.lng });
}

// 候補リスト内の指定スポットまでスクロールして一時的に光らせる
function highlightSpot(spotId) {
  if (!document.querySelector) return; // テスト環境ではスキップ
  const li = document.querySelector(`#spot-list li[data-spot-id="${spotId}"]`);
  if (!li) return;
  li.scrollIntoView({ behavior: "smooth", block: "center" });
  li.classList.add("flash");
  setTimeout(() => li.classList.remove("flash"), 2500);
}

// ============================================================
// スポット詳細モーダル（Google Mapと同等の情報を表示）
// ============================================================
const detailCache = {}; // spotId -> 取得済みのGoogle詳細情報
// 別スポットを開いた・閉じた後に、古い取得結果でモーダルを上書きしないための世代トークン
let detailToken = 0;

// 地図上のスポットポップアップ（写真＋名称＋評価）。いまどのスポットのものかをキーで持ち、
// Google詳細の取得完了後に同じスポットのままなら写真・評価を差し込んで更新する
let mapPopupKey = null;
function showSpotMapPopup(key, base, g) {
  if (typeof TravelMap === "undefined" || !TravelMap.showSpotPopup) return;
  mapPopupKey = key;
  TravelMap.showSpotPopup({
    lat: base.lat,
    lng: base.lng,
    name: base.name,
    rating: g && g.rating != null ? g.rating : (base.rating != null ? base.rating : null),
    ratingCount: g && g.ratingCount != null ? g.ratingCount : (base.ratingCount != null ? base.ratingCount : null),
    photoUrl: g && g.photos && g.photos.length > 0 ? g.photos[0] : null,
    onOpenDetail: makePopupDetailOpener(key, base)
  });
}

// ポップアップの「詳細を見る」動線。開ける詳細がある場合だけ関数を返す
// （候補・自作のスポット＝スポット詳細モーダル、Google由来の場所＝place詳細モーダル。
//   どちらも開けない宿ピン等は null でクリック不可のまま）
function makePopupDetailOpener(key, base) {
  if (base && base.isHotel) return () => openHotelDetail(base);
  if (findSpot(key)) return () => openSpotDetail(key);
  if (base && base.placeId) return () => openPlaceDetail(base);
  return null;
}
function hideSpotMapPopup() {
  mapPopupKey = null;
  if (typeof TravelMap !== "undefined" && TravelMap.hideSpotPopup) TravelMap.hideSpotPopup();
}

// 地図のピン（候補の丸ピン・番号ピン・宿ピン）クリック → リスト選択時と同じポップアップ
// キーは詳細モーダルのキャッシュ（spotId／place:placeId）と揃えて二重取得を防ぐ
function handleSpotPinClick(s) {
  const spotId = s.spotId || s.id || null; // 番号ピン=spotId、候補ピン=id
  const base = (spotId && findSpot(spotId)) || s;
  const key = s.isHotel
    ? hotelDetailKey(s) // 宿ピンは宿の詳細キャッシュと揃える
    : spotId || (base.placeId ? "place:" + base.placeId : "pin:" + base.name);
  showSpotMapPopup(key, base, detailCache[key]);
  fetchDetailForPopup(key, base);
}

// ポップアップ用にGoogle詳細（写真・評価）を裏で取得する（モーダルは開かない）。
// detailCache を詳細モーダルと共用するため、後でモーダルを開いても二重取得しない
async function fetchDetailForPopup(key, base) {
  if (!isGoogleMode() || detailCache[key]) return;
  // 手入力の自作スポットはGoogleへ照会しない（openSpotDetailと同方針）
  if (base.isCustom && base.source !== "google" && !base.placeId) return;
  try {
    const g = await TravelMap.getPlaceDetails({
      placeId: base.placeId || null,
      query: `${base.name} ${state.region}`,
      lat: base.lat,
      lng: base.lng
    });
    if (g) {
      detailCache[key] = g;
      if (mapPopupKey === key) showSpotMapPopup(key, base, g);
    }
  } catch (e) {
    // 取れなくても名称だけのポップアップのまま（機能に影響なし）
  }
}

async function openSpotDetail(spotId) {
  const my = ++detailToken;
  const spot = findSpot(spotId);
  if (!spot) return;
  // 詳細を見る場所へ地図も移動し、ピンの上に名称・評価のポップアップを出す
  if (typeof TravelMap !== "undefined" && spot.lat != null) {
    TravelMap.panTo({ lat: spot.lat, lng: spot.lng });
    showSpotMapPopup(spotId, spot, detailCache[spotId]);
  }
  // 手入力の自作スポットは実在施設と限らないため、Googleへの照会はしない
  // （誤って似た名前の他施設の写真・クチコミを表示しないように）
  const isPrivateCustom = spot.isCustom && spot.source !== "google" && !spot.placeId;
  const canGoogle = typeof TravelMap !== "undefined" && TravelMap.isGoogle && !isPrivateCustom;
  // まず手元の情報で開く（Google情報は後から差し込む）
  renderDetailModal(
    spot,
    detailCache[spotId] || null,
    canGoogle && !detailCache[spotId],
    isPrivateCustom ? "自分で追加した場所のため、Googleの情報照会は行いません" : undefined
  );
  if (!canGoogle || detailCache[spotId]) return;
  try {
    const g = await TravelMap.getPlaceDetails({
      placeId: spot.placeId || null,
      query: `${spot.name} ${state.region}`,
      lat: spot.lat,
      lng: spot.lng
    });
    if (g) detailCache[spotId] = g;
    // ポップアップが同じスポットのままなら、写真・評価を差し込んで更新する
    if (g && mapPopupKey === spotId) showSpotMapPopup(spotId, spot, g);
    if (my !== detailToken) return; // 取得中に別のモーダル操作があった
    if (g) {
      renderDetailModal(spot, g, false);
    } else {
      renderDetailModal(spot, null, false, "Googleで該当する場所が見つかりませんでした");
    }
  } catch (e) {
    console.error(e);
    if (my !== detailToken) return;
    renderDetailModal(spot, null, false, "Google情報の取得に失敗しました");
  }
}

// 候補に未登録の検索結果・人気スポットの詳細を開く（r: searchPlaces系の簡易オブジェクト）
async function openPlaceDetail(r) {
  const my = ++detailToken;
  const spotLike = {
    name: r.name,
    category: guessCategory(r.types),
    desc: r.address,
    stayMin: 60,
    cost: 0
  };
  const cacheKey = "place:" + r.placeId;
  // 詳細を見る場所へ地図も移動し、ピンの上に名称・評価のポップアップを出す
  if (typeof TravelMap !== "undefined" && r.lat != null) {
    TravelMap.panTo({ lat: r.lat, lng: r.lng });
    showSpotMapPopup(cacheKey, r, detailCache[cacheKey]);
  }
  const canGoogle = isGoogleMode() && r.placeId != null;
  renderDetailModal(spotLike, detailCache[cacheKey] || null, canGoogle && !detailCache[cacheKey]);
  if (!canGoogle || detailCache[cacheKey]) return;
  try {
    const g = await TravelMap.getPlaceDetails({
      placeId: r.placeId,
      query: `${r.name} ${state.region}`,
      lat: r.lat,
      lng: r.lng
    });
    if (g) detailCache[cacheKey] = g;
    // ポップアップが同じスポットのままなら、写真・評価を差し込んで更新する
    if (g && mapPopupKey === cacheKey) showSpotMapPopup(cacheKey, r, g);
    if (my !== detailToken) return; // 取得中に別のモーダル操作があった
    if (g) renderDetailModal(spotLike, g, false);
    else renderDetailModal(spotLike, null, false, "Googleで該当する場所が見つかりませんでした");
  } catch (e) {
    console.error(e);
    if (my !== detailToken) return;
    renderDetailModal(spotLike, null, false, "Google情報の取得に失敗しました");
  }
}

// 宿の詳細キャッシュのキー（placeId があればそれ、無ければ名前で識別）
function hotelDetailKey(h) {
  return "hotel:" + (h.placeId ? "place:" + h.placeId : h.name);
}

// ホテルの詳細を開く（スポット詳細と同じモーダル・同じキャッシュを使う）
// h: ホテル一覧の候補、または state.days[i].hotel（保存済みの宿）
async function openHotelDetail(h) {
  if (!h) return;
  const my = ++detailToken;
  const cacheKey = hotelDetailKey(h);
  const price = Number(h.price) || 0;
  const hotelLike = {
    name: h.name,
    category: "hotel",
    desc: h.desc || "",
    price: price,
    priceUnknown: !!h.priceUnknown || price === 0,
    rating: h.rating != null && h.rating > 0 ? h.rating : null
  };
  // 詳細を見る宿へ地図も移動し、ピンの上に名称・評価のポップアップを出す
  if (typeof TravelMap !== "undefined" && h.lat != null) {
    TravelMap.panTo({ lat: h.lat, lng: h.lng });
    showSpotMapPopup(cacheKey, h, detailCache[cacheKey]);
  }
  const canGoogle = isGoogleMode();
  renderDetailModal(hotelLike, detailCache[cacheKey] || null, canGoogle && !detailCache[cacheKey]);
  if (!canGoogle || detailCache[cacheKey]) return;
  try {
    const g = await TravelMap.getPlaceDetails({
      placeId: h.placeId || null,
      query: `${h.name} ${state.region}`,
      lat: h.lat,
      lng: h.lng
    });
    if (g) detailCache[cacheKey] = g;
    // ポップアップが同じ宿のままなら、写真・評価を差し込んで更新する
    if (g && mapPopupKey === cacheKey) showSpotMapPopup(cacheKey, h, g);
    if (my !== detailToken) return; // 取得中に別のモーダル操作があった
    if (g) renderDetailModal(hotelLike, g, false);
    else renderDetailModal(hotelLike, null, false, "Googleで該当する宿が見つかりませんでした");
  } catch (e) {
    console.error(e);
    if (my !== detailToken) return;
    renderDetailModal(hotelLike, null, false, "Google情報の取得に失敗しました");
  }
}

function renderDetailModal(spot, g, loading, errMsg) {
  const overlay = document.getElementById("detail-overlay");
  const content = document.getElementById("detail-content");
  const wasHidden = overlay.hidden;
  overlay.hidden = false;
  // 開いた直後は閉じるボタンへフォーカス（読み込み後の再描画では動かさない）
  if (wasHidden) document.getElementById("detail-close").focus();
  const isHotel = spot.category === "hotel";
  const catLabel = isHotel ? "宿" : spot.category === "food" ? "グルメ" : "観光";
  const catClass = isHotel ? "cat-hotel" : spot.category === "food" ? "cat-food" : "cat-sightseeing";
  let html = `<h3 class="detail-name"><span class="cat-badge ${catClass}">${catLabel}</span>${escapeHtml(spot.name)}</h3>`;

  // 宿は料金・手元の評価をGoogle情報の有無にかかわらず先に出す（選ぶ判断に直結するため）
  if (isHotel) {
    if (spot.desc) html += `<p class="detail-summary">${escapeHtml(spot.desc)}</p>`;
    const priceText = spot.priceUnknown
      ? "料金未設定（宿にしたあと泊カードで編集できます）"
      : `1泊 ${yen(spot.price)}`;
    html += '<ul class="detail-facts">';
    html += `<li><span class="material-symbols-outlined">payments</span>${priceText}</li>`;
    if (!g && spot.rating != null) {
      html += `<li><span class="material-symbols-outlined">star</span>評価 ${spot.rating}</li>`;
    }
    html += "</ul>";
  }

  if (g) {
    html += buildGoogleDetailHtml(g);
  } else {
    // Google情報なし：手元の情報のみ表示
    if (!isHotel) {
      if (spot.desc) html += `<p class="detail-summary">${escapeHtml(spot.desc)}</p>`;
      html += `<ul class="detail-facts"><li><span class="material-symbols-outlined">schedule</span>滞在目安 ${spot.stayMin}分 ／ ${yen(spot.cost)}</li></ul>`;
    }
    if (loading) html += '<p class="place-status">Google の情報を読み込み中…</p>';
    else if (errMsg) html += `<p class="place-status">${escapeHtml(errMsg)}</p>`;
    else html += '<p class="place-status">Google Maps APIキー設定時は、ここに写真・クチコミ・営業時間が表示されます</p>';
  }
  // 履歴DB（サーバーモード）：この場所を「行った場所」として記録するボタン
  if (typeof History !== "undefined" && History.canSave && History.canSave()) {
    html += '<div class="detail-actions"><button type="button" id="detail-save-history" class="btn btn-outline">'
      + '<span class="material-symbols-outlined">bookmark_add</span>行った場所に記録</button></div>';
  }
  content.innerHTML = html;
  const saveBtn = document.getElementById("detail-save-history");
  if (saveBtn && typeof History !== "undefined") saveBtn.onclick = () => History.savePlace(spot, g);
}

// Google詳細情報（写真・評価・概要・住所・営業時間・クチコミ）のHTMLを組み立てる
// （詳細モーダルと地図シート内詳細で共用。CSSクラスも共通）
function buildGoogleDetailHtml(g) {
  let html = "";
  if (g.photos.length > 0) {
    html += `<div class="detail-photos">${g.photos.map((u) => `<img src="${escapeHtml(u)}" alt="" loading="lazy">`).join("")}</div>`;
  }
  if (g.rating != null) {
    html += `<div class="detail-rating">★ ${g.rating} <span class="count">（${(g.ratingCount || 0).toLocaleString()}件のクチコミ）</span></div>`;
  }
  if (g.summary) html += `<p class="detail-summary">${escapeHtml(g.summary)}</p>`;
  html += '<ul class="detail-facts">';
  if (g.address) html += `<li><span class="material-symbols-outlined">location_on</span>${escapeHtml(g.address)}</li>`;
  if (g.phone) html += `<li><span class="material-symbols-outlined">call</span>${escapeHtml(g.phone)}</li>`;
  const site = safeUrl(g.website);
  if (site) html += `<li><span class="material-symbols-outlined">language</span><a href="${escapeHtml(site)}" target="_blank" rel="noopener">公式サイト</a></li>`;
  if (g.mapsUrl) html += `<li><span class="material-symbols-outlined">map</span><a href="${escapeHtml(g.mapsUrl)}" target="_blank" rel="noopener">Google マップで開く</a></li>`;
  html += "</ul>";
  if (g.openingHours.length > 0) {
    html += `<details class="detail-hours"><summary>営業時間</summary><ul>${g.openingHours.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul></details>`;
  }
  if (g.reviews.length > 0) {
    html += '<div class="detail-reviews"><h4>クチコミ</h4>'
      + g.reviews.map((rv) =>
        `<div class="review">
          <div class="review-head">★ ${rv.rating != null ? rv.rating : "-"} <span class="review-meta">${escapeHtml(rv.author)}${rv.when ? "・" + escapeHtml(rv.when) : ""}</span></div>
          <p>${escapeHtml(rv.text)}</p>
        </div>`).join("")
      + "</div>";
  }
  return html;
}

function closeDetailModal() {
  detailToken++; // 取得途中のGoogle情報で再表示されないようにする
  document.getElementById("detail-overlay").hidden = true;
}

// 画面下部に一時的な通知を出す（action: { label, onClick } でボタン付きにできる）
let snackbarTimer = null;
function showSnackbar(msg, action) {
  const el = document.getElementById("snackbar");
  if (!el) return;
  el.textContent = msg; // 前回のボタンごと消す
  if (action) {
    const btn = document.createElement("button");
    btn.textContent = action.label;
    btn.onclick = () => {
      el.classList.remove("show");
      if (snackbarTimer) clearTimeout(snackbarTimer);
      action.onClick();
    };
    el.appendChild(btn);
  }
  el.classList.add("show");
  if (snackbarTimer) clearTimeout(snackbarTimer);
  // ボタン付きは押す猶予を長めにとる
  snackbarTimer = setTimeout(() => el.classList.remove("show"), action ? 6000 : 3000);
}

// ---------- ユーティリティ ----------
// 数値化して0未満は0に丸める（費用・料金・滞在分の負値入力対策）
function nonNegNum(v) {
  return Math.max(0, Number(v) || 0);
}
// https?:// で始まらないURLは空扱いにする（javascript: 等のリンク化を防ぐ）
function safeUrl(u) {
  return /^https?:\/\//i.test(String(u || "")) ? u : "";
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ============================================================
// 日付範囲カレンダー（ヘッダーの開始/終了フィールド）
// 保存形式は従来どおり startDate＋numDays のまま、UI層で範囲⇔日数を変換する
// ============================================================
const MAX_TRIP_DAYS = 16; // 天気予報が16日先までのため範囲は最大16日間

// "YYYY-MM-DD" ⇔ Date の相互変換ヘルパー
function parseDateStr(s) {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d) ? null : d;
}
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDaysStr(s, n) {
  const d = parseDateStr(s);
  if (!d) return s;
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
// 開始→終了の日数（両端を含む）。不正な日付なら null
function rangeDayCount(a, b) {
  const da = parseDateStr(a);
  const db = parseDateStr(b);
  if (!da || !db) return null;
  return Math.round((db - da) / 86400000) + 1;
}
// ピル表示用の整形（例: 8月10日(月)）
function fmtFieldDate(s) {
  const d = parseDateStr(s);
  if (!d) return "未設定";
  return `${d.getMonth() + 1}月${d.getDate()}日(${"日月火水木金土"[d.getDay()]})`;
}
// 旅行の終了日（開始日＋日数−1）
function tripEndDate() {
  return addDaysStr(state.startDate, state.numDays - 1);
}

// カレンダーの一時状態（開いている間だけ使う。保存形式には入れない）
// { phase: 'start'|'end', start, end, viewY, viewM, focus }
let drp = null;

// ヘッダーの開始/終了フィールドの表示を state から更新する
function renderDateRangeField() {
  const sv = document.getElementById("date-field-start-value");
  const ev = document.getElementById("date-field-end-value");
  if (!sv || !ev) return;
  sv.textContent = fmtFieldDate(state.startDate);
  ev.textContent = fmtFieldDate(tripEndDate());
}

// デスクトップ（768px以上）は2ヶ月並び、モバイルは1ヶ月表示
function calendarMonthCount() {
  return typeof matchMedia === "function" && matchMedia("(min-width: 768px)").matches ? 2 : 1;
}

function openDateRangePopover(phase) {
  const pop = document.getElementById("date-range-popover");
  if (!pop) return;
  const startD = parseDateStr(state.startDate) || new Date();
  drp = {
    phase,
    start: state.startDate || "",
    end: state.startDate ? tripEndDate() : null,
    viewY: startD.getFullYear(),
    viewM: startD.getMonth(),
    focus: phase === "end" && state.startDate ? tripEndDate() : (state.startDate || toDateStr(new Date()))
  };
  pop.hidden = false;
  renderCalendar();
  positionDateRangePopover();
  updateDateFieldActive();
  focusCalendarCell(); // キーボード操作の起点をカレンダー内へ
}
function closeDateRangePopover() {
  if (drp && drp.inline) return; // ウィザード内のカレンダーは closeInlineCalendar() で閉じる
  const pop = document.getElementById("date-range-popover");
  if (pop) pop.hidden = true;
  drp = null;
  updateDateFieldActive();
}
// 開いている間、選択対象のフィールドを「選択中」表示にする
function updateDateFieldActive() {
  const fs = document.getElementById("date-field-start");
  const fe = document.getElementById("date-field-end");
  if (!fs || !fe) return;
  const open = !!drp && !drp.inline;
  fs.classList.toggle("active", open && drp.phase === "start");
  fe.classList.toggle("active", open && drp.phase === "end");
  fs.setAttribute("aria-expanded", open ? "true" : "false");
  fe.setAttribute("aria-expanded", open ? "true" : "false");
}

// ポップオーバーを開始フィールドの直下に置く（画面右端でははみ出さないようクランプ）
function positionDateRangePopover() {
  const pop = document.getElementById("date-range-popover");
  const anchor = document.getElementById("date-field-start");
  if (!pop || !anchor || typeof anchor.getBoundingClientRect !== "function") return;
  const vw = typeof innerWidth === "number" ? innerWidth : 1280;
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.round(r.bottom + 8) + "px";
  const w = pop.getBoundingClientRect().width;
  let left = r.left;
  if (left + w > vw - 8) left = vw - 8 - w;
  if (left < 8) left = 8;
  pop.style.left = Math.round(left) + "px";
}

// 月パネル（タイトル・曜日ヘッダー・日グリッド）を描画する
function renderCalendar() {
  if (!drp) return;
  const wrap = drp.mount ? drp.mount.months : document.getElementById("drp-months");
  if (!wrap) return;
  wrap.innerHTML = "";
  const monthCount = calendarMonthCount();
  const todayStr = toDateStr(new Date());
  const hasRange = !!(drp.start && drp.end && drp.start !== drp.end);
  for (let k = 0; k < monthCount; k++) {
    const y = drp.viewY + Math.floor((drp.viewM + k) / 12);
    const m = (drp.viewM + k) % 12;
    const month = document.createElement("div");
    month.className = "drp-month";
    const title = document.createElement("div");
    title.className = "drp-month-title";
    title.textContent = `${y}年${m + 1}月`;
    month.appendChild(title);
    const grid = document.createElement("div");
    grid.className = "drp-grid";
    "日月火水木金土".split("").forEach((w) => {
      const c = document.createElement("span");
      c.className = "drp-dow";
      c.textContent = w;
      grid.appendChild(c);
    });
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    // 月初より前の空きマス（disabledで不可視にして列を揃える）
    for (let i = 0; i < firstDow; i++) {
      const pad = document.createElement("button");
      pad.type = "button";
      pad.className = "drp-day";
      pad.disabled = true;
      pad.tabIndex = -1;
      pad.setAttribute("aria-hidden", "true");
      grid.appendChild(pad);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dt = new Date(y, m, day);
      const ds = toDateStr(dt);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "drp-day";
      btn.dataset.date = ds;
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(day);
      btn.appendChild(num);
      // YYYY-MM-DD 形式は文字列比較＝日付比較として使える
      const isStart = ds === drp.start;
      const isEnd = !!drp.end && ds === drp.end;
      if (isStart) btn.classList.add("range-start");
      if (isEnd) btn.classList.add("range-end");
      if (hasRange && (isStart || isEnd)) btn.classList.add("has-range");
      if (drp.end && ds > drp.start && ds < drp.end) btn.classList.add("in-range");
      if (ds === todayStr) btn.classList.add("today");
      btn.setAttribute("aria-selected", isStart || isEnd ? "true" : "false");
      btn.setAttribute("aria-label", `${y}年${m + 1}月${day}日(${"日月火水木金土"[dt.getDay()]})`);
      btn.tabIndex = ds === drp.focus ? 0 : -1; // ロービングタブインデックス
      btn.onclick = () => onCalendarDayClick(ds);
      grid.appendChild(btn);
    }
    month.appendChild(grid);
    wrap.appendChild(month);
  }
  const hint = drp.mount ? drp.mount.hint : document.getElementById("drp-hint");
  if (hint) {
    hint.textContent = drp.phase === "start" || !drp.start
      ? "開始日を選んでください"
      : `終了日を選んでください（同じ日で日帰り・最大${MAX_TRIP_DAYS}日間）`;
  }
}

// 日セルのクリック：1回目＝開始日、2回目＝終了日。開始日より前は選び直し
function onCalendarDayClick(ds) {
  if (!drp) return;
  drp.focus = ds;
  if (drp.phase === "start" || !drp.start || ds < drp.start) {
    drp.start = ds;
    drp.end = null;
    drp.phase = "end";
    updateDateFieldActive();
    renderCalendar();
    if (drp.onChange) drp.onChange(drp.start, null);
    return;
  }
  // 終了日の決定（同日クリック＝日帰り1日）
  const n = rangeDayCount(drp.start, ds);
  if (n == null) return;
  if (n > MAX_TRIP_DAYS) {
    showSnackbar(`旅行は最大${MAX_TRIP_DAYS}日間まで選べます（天気予報が届く範囲）`);
    // 上限超えは開始日の選び直しとして扱う
    drp.start = ds;
    drp.end = null;
    renderCalendar();
    if (drp.onChange) drp.onChange(drp.start, null);
    return;
  }
  drp.end = ds;
  if (drp.inline) {
    // ウィザード内：確定は「次へ」で行う。次のクリックは開始日の選び直し
    drp.phase = "start";
    renderCalendar();
    if (drp.onChange) drp.onChange(drp.start, drp.end);
    return;
  }
  applyDateRange(drp.start, n);
  closeDateRangePopover();
}

// 選んだ範囲を保存形式（startDate＋numDays）に変換して反映する
function applyDateRange(startDs, n) {
  state.startDate = startDs;
  // setNumDays が保存・再描画・日数減のときの予定退避まで行う
  setNumDays(n);
}

// キーボード操作：矢印で日移動（表示中の月を出たら月送り）
function normalizeCalendarView() {
  while (drp.viewM < 0) { drp.viewM += 12; drp.viewY--; }
  while (drp.viewM > 11) { drp.viewM -= 12; drp.viewY++; }
}
function moveCalendarFocus(deltaDays) {
  if (!drp) return;
  const next = addDaysStr(drp.focus, deltaDays);
  const d = parseDateStr(next);
  if (!d) return;
  drp.focus = next;
  const first = new Date(drp.viewY, drp.viewM, 1);
  const last = new Date(drp.viewY, drp.viewM + calendarMonthCount(), 0);
  if (d < first) { drp.viewM--; normalizeCalendarView(); }
  else if (d > last) { drp.viewM++; normalizeCalendarView(); }
  renderCalendar();
  focusCalendarCell();
}
function focusCalendarCell() {
  const pop = drp && drp.mount ? drp.mount.root : document.getElementById("date-range-popover");
  if (!pop || !drp || typeof pop.querySelector !== "function") return;
  const cell = pop.querySelector(`.drp-day[data-date="${drp.focus}"]`);
  if (cell && typeof cell.focus === "function") cell.focus();
}

// ---- インラインのカレンダー（ウィザード「いつ行く」）----
// ポップオーバーと同じ描画・操作を、任意の要素（mount）に描く。確定は呼び出し側が
// inlineCalendarRange() を読んで applyDateRange() する。
// mount = { root, months, hint }、opts = { start, end, onChange(start, end) }
function openInlineCalendar(mount, opts) {
  opts = opts || {};
  const startD = parseDateStr(opts.start) || new Date();
  drp = {
    inline: true,
    mount,
    onChange: opts.onChange || null,
    phase: "start",
    start: opts.start || "",
    end: opts.end || null,
    viewY: startD.getFullYear(),
    viewM: startD.getMonth(),
    focus: opts.start || toDateStr(new Date())
  };
  renderCalendar();
  // 矢印キーで日移動（ポップオーバーと同じ）。同じ要素に二重登録しない
  if (mount.root && typeof mount.root.addEventListener === "function" && !mount.root.dataset.calKeys) {
    mount.root.dataset.calKeys = "1";
    mount.root.addEventListener("keydown", (e) => {
      if (!drp || !drp.inline) return;
      const keyMap = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (keyMap[e.key] !== undefined) {
        e.preventDefault();
        moveCalendarFocus(keyMap[e.key]);
      }
    });
  }
}
function inlineCalendarNav(delta) {
  if (!drp || !drp.inline) return;
  drp.viewM += delta;
  normalizeCalendarView();
  renderCalendar();
}
function inlineCalendarRange() {
  return drp && drp.inline ? { start: drp.start, end: drp.end } : null;
}
function inlineCalendarPhase() {
  return drp && drp.inline ? drp.phase : null;
}
function setInlineCalendarPhase(phase) {
  if (!drp || !drp.inline) return;
  drp.phase = phase;
  renderCalendar();
}
function closeInlineCalendar() {
  if (drp && drp.inline) drp = null;
}

// フィールド・月送り・外側クリック・キーボードのイベント登録
function setupDateRangePicker() {
  const fs = document.getElementById("date-field-start");
  const fe = document.getElementById("date-field-end");
  const pop = document.getElementById("date-range-popover");
  renderDateRangeField();
  // フィールドクリックで開く。開いている間にもう片方を押すと選択対象が切り替わる
  fs.onclick = () => {
    if (drp) { drp.phase = "start"; updateDateFieldActive(); renderCalendar(); }
    else openDateRangePopover("start");
  };
  fe.onclick = () => {
    if (drp) { drp.phase = "end"; updateDateFieldActive(); renderCalendar(); }
    else openDateRangePopover("end");
  };
  const prev = document.getElementById("drp-prev");
  const next = document.getElementById("drp-next");
  if (prev) prev.onclick = () => { if (!drp) return; drp.viewM--; normalizeCalendarView(); renderCalendar(); };
  if (next) next.onclick = () => { if (!drp) return; drp.viewM++; normalizeCalendarView(); renderCalendar(); };
  // 外側クリックで閉じる（範囲が未確定なら破棄して元の値を保つ）
  document.addEventListener("pointerdown", (e) => {
    if (!drp || !pop || typeof pop.contains !== "function") return;
    const t = e.target;
    if (pop.contains(t) || fs.contains(t) || fe.contains(t)) return;
    closeDateRangePopover();
  });
  // Escで閉じてフィールドへフォーカスを返す
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drp) {
      closeDateRangePopover();
      if (typeof fs.focus === "function") fs.focus();
    }
  });
  // カレンダー内のキーボード操作（Enter/Spaceはbutton標準のclickに任せる）
  if (typeof pop.addEventListener === "function") {
    pop.addEventListener("keydown", (e) => {
      if (!drp) return;
      const keyMap = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (keyMap[e.key] !== undefined) {
        e.preventDefault();
        moveCalendarFocus(keyMap[e.key]);
      }
    });
  }
  // 画面幅が変わったら1ヶ月⇔2ヶ月を切り替えて置き直す
  if (typeof addEventListener === "function") {
    addEventListener("resize", () => {
      if (drp) { renderCalendar(); positionDateRangePopover(); }
    });
  }
}

// ============================================================
// 初期化・イベント登録
// ============================================================
// ============================================================
// ヒーロー画面（行き先選択）
// プラン未作成の初回と、行き先セレクトの「全国から探す」で表示する
// ============================================================
const HERO_PHOTO_CACHE_KEY = "travel-planner-dest-photos-v1";
const HERO_PHOTO_TTL_MS = 30 * 24 * 3600 * 1000; // 写真URLのキャッシュは30日

// ヒーロー（どこへ行きますか？）の開き方：
//   home    ＝ ホーム。サーバーモードでは行き先を選ぶと「新しい旅」が作られウィザードへ
//   change  ＝ 開いている旅の行き先を変えるだけ（ヘッダーの「全国から探す」）
//   restart ＝ 開いている旅をリセットしてやり直す（行き先→ウィザード）
let heroMode = "home";
function openHero(mode) {
  heroMode = mode || "home";
  const hero = document.getElementById("hero-screen");
  if (!hero) return;
  hero.hidden = false;
  if (document.body) document.body.classList.add("hero-open"); // テスト環境はbodyなし
  // Googleモードなら全国検索、キーなしなら案内文を出す
  const search = document.getElementById("hero-search");
  if (search) search.hidden = !isGoogleMode();
  const note = document.getElementById("hero-keyless-note");
  if (note) note.hidden = isGoogleMode();
  const serverMode = typeof Projects !== "undefined" && Projects.isServerMode && Projects.isServerMode();
  const lead = document.getElementById("hero-lead");
  if (lead) {
    lead.textContent = heroMode === "change" ? "この旅の行き先を変更します（日程・宿・交通はリセットされます）"
      : heroMode === "restart" ? "行き先を選んで、この旅をやり直します"
        : serverMode ? "行き先を選ぶと、新しい旅の準備がはじまります"
          : "行き先を選ぶと旅の準備がはじまります（サーバーを起動すると複数の旅を管理できます）";
  }
  // ホーム：これまでの旅を一覧に出す（ローカル保存モードは、計画を始めていればこの端末の旅を1枚だけ）。
  // サーバーモードで開いている旅がなければ閉じるボタンは出さない
  const closeBtn = document.getElementById("hero-close");
  if (closeBtn) closeBtn.hidden = !!(serverMode && !Projects.current());
  const showTrips = heroMode === "home" && typeof Projects !== "undefined" && !!Projects.renderHeroTrips
    && (serverMode || state.heroSeen || planHasContent() || (Projects.hasLocalTrips && Projects.hasLocalTrips()));
  const trips = document.getElementById("hero-trips-section");
  if (trips) trips.hidden = !showTrips;
  if (showTrips) Projects.renderHeroTrips();
  renderHeroCards();
}

// ヒーローで行き先が選ばれたとき（人気の行き先カード／全国検索の結果）
function chooseHeroDestination(dest) {
  const serverMode = typeof Projects !== "undefined" && Projects.isServerMode && Projects.isServerMode();
  if (heroMode === "home" && typeof Projects !== "undefined" && Projects.startNewTrip) {
    // 新しい旅を作ってウィザード（日程→希望→旅程案）へ。サーバーモード＝プロジェクト、ローカル＝端末内の一覧に前の旅を残す
    Projects.startNewTrip(dest);
  } else {
    if (!applyDestination(dest)) return;
    closeHero();
    // 行き先を変えるだけのとき以外は、日程からのウィザードへ
    if (heroMode !== "change" && typeof Wizard !== "undefined") Wizard.open(2);
  }
  // 任意行き先の写真は後から非同期で反映（切り替えを待たせない）
  if (dest.placeId) {
    getDestPhotoUrl(dest.name, dest.placeId).then((url) => {
      if (url && state.customDest && state.customDest.placeId === dest.placeId) {
        state.customDest.photoUrl = url;
        saveState();
      }
    }).catch(() => {});
  }
}

function closeHero() {
  const hero = document.getElementById("hero-screen");
  if (!hero || hero.hidden) return;
  hero.hidden = true;
  if (document.body) document.body.classList.remove("hero-open");
  if (!state.heroSeen) {
    state.heroSeen = true; // 閉じたら次回リロードでは出さない
    saveState();
  }
}

function showHeroIfNeeded() {
  if (!state.heroSeen && !planHasContent()) openHero("home");
}

// 7地域の写真カード（Googleモードでは写真を非同期で差し込む）
function renderHeroCards() {
  const grid = document.getElementById("hero-region-cards");
  if (!grid) return;
  grid.innerHTML = "";
  Object.keys(SPOT_DATA).forEach((r, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hero-card";
    btn.dataset.grad = String(i % 7); // 写真が出るまでの配色（キーなしでは常用）
    const count = (SPOT_DATA[r] || []).length;
    btn.innerHTML = `
      <span class="hero-card-img" aria-hidden="true"></span>
      <span class="hero-card-body">
        <span class="hero-card-name"></span>
        <span class="hero-card-count">スポット${count}件</span>
      </span>`;
    btn.querySelector(".hero-card-name").textContent = r;
    btn.onclick = () => chooseHeroDestination({ region: r });
    grid.appendChild(btn);
    if (isGoogleMode()) loadHeroCardPhoto(r, btn);
  });
}

async function loadHeroCardPhoto(regionName, btn) {
  try {
    const url = await getDestPhotoUrl(regionName, null);
    if (!url) return;
    const img = btn.querySelector(".hero-card-img");
    if (img) img.style.backgroundImage = `url("${url}")`;
    btn.classList.add("has-photo");
  } catch (e) {
    // 写真が取れなくてもグラデーション表示のまま（機能に影響なし）
  }
}

// 行き先写真のURLを取得（localStorageにキャッシュしてAPI呼び出しを抑える）
async function getDestPhotoUrl(query, placeId) {
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(HERO_PHOTO_CACHE_KEY)) || {}; } catch (e) {}
  const hit = cache[query];
  if (hit && Date.now() - hit.at < HERO_PHOTO_TTL_MS) return hit.url;
  if (typeof TravelMap === "undefined" || !TravelMap.getDestinationPhoto) return null;
  const url = await TravelMap.getDestinationPhoto({ query, placeId });
  if (url) {
    cache[query] = { url, at: Date.now() };
    try { localStorage.setItem(HERO_PHOTO_CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
  }
  return url;
}

function setupHero() {
  const closeBtn = document.getElementById("hero-close");
  if (closeBtn) closeBtn.onclick = closeHero;
  const input = document.getElementById("hero-dest-query");
  const searchBtn = document.getElementById("hero-search-btn");
  const doSearch = async () => {
    if (!isGoogleMode() || !input) return;
    const q = (input.value || "").trim();
    if (!q) return;
    const list = document.getElementById("hero-dest-results");
    list.innerHTML = '<li class="hero-note">検索中…</li>';
    try {
      const results = await TravelMap.searchPlaces(q, { basic: true, national: true });
      renderHeroResults(results);
    } catch (e) {
      list.innerHTML = '<li class="hero-note">検索に失敗しました。時間をおいて試してください</li>';
    }
  };
  if (searchBtn) searchBtn.onclick = doSearch;
  if (input) input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
}

function renderHeroResults(results) {
  const list = document.getElementById("hero-dest-results");
  if (!list) return;
  list.innerHTML = "";
  if (!results || results.length === 0) {
    list.innerHTML = '<li class="hero-note">見つかりませんでした。市区町村名や駅名で試してください</li>';
    return;
  }
  results.forEach((r) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hero-result";
    btn.innerHTML = `
      <span class="material-symbols-outlined" aria-hidden="true">location_on</span>
      <span class="hero-result-text">
        <span class="hero-result-name"></span>
        <span class="hero-result-addr"></span>
      </span>`;
    btn.querySelector(".hero-result-name").textContent = r.name;
    btn.querySelector(".hero-result-addr").textContent = r.address;
    btn.onclick = () => chooseHeroDestination({ name: r.name, lat: r.lat, lng: r.lng, placeId: r.placeId });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

// 行き先セレクトの特殊オプション
const DEST_OPTION_CUSTOM = "__custom__"; // 選択中の任意行き先（表示用）
const DEST_OPTION_SEARCH = "__search__"; // 全国検索（ヒーロー画面）を開く

// 行き先セレクトの選択肢を作り直す（任意行き先は先頭、Googleモードなら検索入口を末尾に）
function rebuildRegionOptions() {
  const sel = document.getElementById("region-select");
  if (!sel) return;
  sel.innerHTML = "";
  if (state.customDest) {
    const opt = document.createElement("option");
    opt.value = DEST_OPTION_CUSTOM;
    opt.textContent = state.customDest.name;
    sel.appendChild(opt);
  }
  Object.keys(SPOT_DATA).forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    sel.appendChild(opt);
  });
  if (isGoogleMode()) {
    const opt = document.createElement("option");
    opt.value = DEST_OPTION_SEARCH;
    opt.textContent = "🔍 全国から探す…";
    sel.appendChild(opt);
  }
  sel.value = state.customDest ? DEST_OPTION_CUSTOM : state.region;
}

// 行き先を変更する共通処理（セレクト・ヒーロー画面の両方から使う）
// dest: { region }＝サンプル地域 ／ { name, lat, lng, placeId, photoUrl }＝任意行き先
// 戻り値: 変更したら true（確認でキャンセルされたら false）
function applyDestination(dest) {
  const nextName = dest.region || dest.name;
  // 日程・宿・交通は行き先に紐づくため、中身があればリセット確認をする
  if (planHasContent()) {
    const ok = confirm(
      `行き先を「${nextName}」に変更すると、日程・宿・交通の選択はリセットされます。\n（出発地・候補リストは残ります）よろしいですか？`
    );
    if (!ok) {
      rebuildRegionOptions(); // セレクトの表示を現在の行き先に戻す
      return false;
    }
    resetPlanForRegionChange();
  }
  if (dest.region) {
    state.customDest = null;
    state.region = dest.region;
  } else {
    state.customDest = {
      name: dest.name, lat: dest.lat, lng: dest.lng,
      placeId: dest.placeId || null, photoUrl: dest.photoUrl || null
    };
    state.region = dest.name;
  }
  state.heroSeen = true; // 行き先を選んだらヒーロー画面は済み扱い
  saveState();
  rebuildRegionOptions();
  clearMapSearch(); // 行き先が変わったら地図上検索の仮ピン・結果も消す
  hideSpotMapPopup(); // 前の行き先のスポットポップアップも消す
  flyToRegion();
  renderAll();
  refreshPopularSpots(true); // 新しい行き先の周辺で人気スポットを取り直す
  showSnackbar(`行き先を「${nextName}」に変更しました`);
  return true;
}

function setupControls() {
  // 地域セレクト（選択肢は rebuildRegionOptions が管理）
  const regionSel = document.getElementById("region-select");
  rebuildRegionOptions();
  regionSel.onchange = () => {
    const next = regionSel.value;
    if (next === DEST_OPTION_SEARCH) {
      rebuildRegionOptions(); // セレクトの表示は現在の行き先のまま
      openHero("change");
      return;
    }
    if (next === DEST_OPTION_CUSTOM) return; // 選択中の任意行き先そのもの
    if (!state.customDest && next === state.region) return;
    applyDestination({ region: next });
  };

  // 日付範囲（開始〜終了）：カスタムカレンダーで選び、startDate＋numDaysに変換して保存する
  setupDateRangePicker();

  // 行き先selectはマウスクリック時にフォーカス枠を出さない（Tabで来たときは出す）
  regionSel.addEventListener("pointerdown", () => regionSel.classList.add("no-focus-ring"));
  regionSel.addEventListener("blur", () => regionSel.classList.remove("no-focus-ring"));

  // AIおすすめ順の並び替え
  document.getElementById("ai-sort-btn").onclick = applyAiOrder;

  // タイムラインの並び替えは各エントリの pointerdown（renderTimeline 内）で開始する

  // その日の出発時刻
  document.getElementById("day-start-time").onchange = (e) => {
    state.days[state.activeDay].startTime = e.target.value;
    saveState();
    renderTimeline();
  };

  // スポット絞り込み
  document.getElementById("spot-search").oninput = (e) => {
    filter.text = e.target.value.trim();
    renderSpotList();
  };
  // スポットタブ内のチップに限定する（ホテルの並び替えチップと衝突しないように）
  document.querySelectorAll("#tab-spots .filter-btns .chip").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("#tab-spots .filter-btns .chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      filter.category = btn.dataset.filter;
      renderSpotList();
    };
  });

  // 自作スポット
  document.getElementById("pick-location-btn").onclick = () => {
    pickingLocation = !pickingLocation;
    document.getElementById("pick-location-btn").classList.toggle("picking", pickingLocation);
    if (pickingLocation) {
      document.getElementById("picked-location").textContent = "地図上の置きたい場所をクリックしてください…";
    }
  };
  document.getElementById("add-custom-btn").onclick = addCustomSpot;

  // 出発地の検索（APIキーなしでもEnterで名前だけ登録できる）
  const originInput = document.getElementById("origin-query");
  const originBtn = document.getElementById("origin-search-btn");
  if (originBtn) originBtn.onclick = runOriginSearch;
  originInput.addEventListener("keydown", (e) => {
    // IME変換確定のEnter（isComposing / keyCode 229）では検索しない
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) runOriginSearch();
  });
  originInput.addEventListener("input", () => {
    if (originInput.value.trim() === "") {
      document.getElementById("origin-results").innerHTML = "";
    }
  });

  // 左パネルのタブ切り替え（スポット／ホテル／交通）
  document.querySelectorAll(".panel-tabs .ptab").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".panel-tabs .ptab").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false"); // タブ切替に合わせて支援技術向け状態も更新
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      ["spots", "hotels", "transport"].forEach((t) => {
        document.getElementById("tab-" + t).hidden = t !== btn.dataset.tab;
      });
    };
  });

  // ホテルの並び替えチップ
  document.querySelectorAll(".hotel-sort .chip").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".hotel-sort .chip").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      hotelSort = btn.dataset.sort;
      renderHotelList();
    };
  });

  // 詳細モーダルの閉じる操作（✕・外側クリック・Escキー）
  document.getElementById("detail-close").onclick = closeDetailModal;
  const overlay = document.getElementById("detail-overlay");
  overlay.onclick = (e) => {
    if (e.target === overlay) closeDetailModal();
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetailModal();
  });

  // リセット
  document.getElementById("reset-btn").onclick = () => {
    if (!confirm("この旅の計画をすべて消去して最初からやり直しますか？")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    saveState(); // サーバーモードでは空の計画をプロジェクトに保存する
    applyLoadedState();
    showSnackbar("計画をリセットしました");
    openHero("restart"); // 最初の行き先選びからやり直す
  };
}

// 状態（state）を差し替えたあとに画面全体を作り直す（リセット・プロジェクト切り替えで共用）
function applyLoadedState() {
  rebuildRegionOptions(); // 任意行き先のオプションも消して選択を戻す
  closeDateRangePopover(); // 開いたままのカレンダーは閉じる
  renderDateRangeField();
  // Google検索・出発地検索の入力と結果もクリアする
  document.getElementById("place-query").value = "";
  document.getElementById("place-results").innerHTML = "";
  document.getElementById("origin-query").value = "";
  document.getElementById("origin-results").innerHTML = "";
  clearMapSearch(); // 地図上検索の入力・仮ピン・結果もクリア
  hideSpotMapPopup(); // スポットポップアップも消す
  // 自作スポットの位置指定モードも解除する
  pickedLatLng = null;
  pickingLocation = false;
  document.getElementById("pick-location-btn").classList.remove("picking");
  document.getElementById("picked-location").textContent = "位置：未設定（地図中心を使用）";
  resetLeftPanelUI();
  flyToRegion();
  renderAll();
  refreshPopularSpots(true); // 行き先が変わっている可能性があるので人気スポットを取り直す
}

// 左パネルのタブ・フィルタ・並び替えを初期状態に戻す（リセット時に使用）
function resetLeftPanelUI() {
  filter = { text: "", category: "all" };
  hotelSort = "recommend";
  const search = document.getElementById("spot-search");
  if (search) search.value = "";
  document.querySelectorAll("#tab-spots .filter-btns .chip").forEach((b) => {
    b.classList.toggle("active", b.dataset.filter === "all");
  });
  document.querySelectorAll(".hotel-sort .chip").forEach((b) => {
    b.classList.toggle("active", b.dataset.sort === "recommend");
  });
  document.querySelectorAll(".panel-tabs .ptab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === "spots");
    b.setAttribute("aria-selected", b.dataset.tab === "spots" ? "true" : "false");
  });
  ["spots", "hotels", "transport"].forEach((t) => {
    const el = document.getElementById("tab-" + t);
    if (el) el.hidden = t !== "spots";
  });
}

// 起動：画面の初期化。サーバーモード（FastAPI あり）では projects.js が
// プロジェクトを読み込んで state を差し替えてから bootApp() を呼ぶ
let appBooted = false;
function bootApp() {
  if (appBooted) return; // 二重初期化を防ぐ
  appBooted = true;
  setupControls();
  setupHero();
  renderAll();
  showHeroIfNeeded(); // 地図の読み込みを待たずに行き先選択を出す
  if (typeof TravelMap !== "undefined") {
    const c = destCenter() || { lat: 35.0, lng: 135.0, zoom: 5 };
    // 地図の初期化は非同期（Google Maps はスクリプト読み込みを待つ）
    TravelMap.init({ lat: c.lat, lng: c.lng }, c.zoom, onMapClick).then(() => {
      setupGoogleSearch();
      setupPopularSpots();
      setupMapSearch();
      setupMapFullscreen();
      setupMapJumpButton();
      // ピンクリックでリスト選択時と同じポップアップを出す（Google/Leaflet共通）
      if (TravelMap.onSpotPinClick) TravelMap.onSpotPinClick(handleSpotPinClick);
      renderMapView();
      // Google読み込み完了後、表示中のヒーローカードに写真を差し込む
      const hero = document.getElementById("hero-screen");
      if (hero && !hero.hidden) renderHeroCards();
    });
  }
}
if (typeof Projects !== "undefined" && Projects.boot) Projects.boot(bootApp);
else bootApp();
