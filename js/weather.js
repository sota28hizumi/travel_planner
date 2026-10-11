// ============================================================
// 天気予報表示（Open-Meteo Forecast API）
// - キー不要・無料・CORS対応。行き先地域の16日分の日別予報を取得する
// - キャッシュは localStorage の別キー（state には保存しない）
// - 取得失敗時は天気UIを丸ごと非表示にし、アプリ本体には影響させない
// ============================================================

const WEATHER_CACHE_KEY = "travel-planner-weather-v1";
const WEATHER_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 有効期限3時間
const WEATHER_FORECAST_DAYS = 16; // Open-Meteo の最大予報日数

// ---------- WMO weather_code → 絵文字・和名（企画書4.4の対応表） ----------
function weatherCodeInfo(code) {
  const c = Number(code);
  if (c === 0) return { emoji: "☀", label: "快晴" };
  if (c === 1 || c === 2) return { emoji: "🌤", label: "晴れ時々曇り" };
  if (c === 3) return { emoji: "☁", label: "曇り" };
  if (c === 45 || c === 48) return { emoji: "🌫", label: "霧" };
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return { emoji: "🌧", label: "雨" };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { emoji: "🌨", label: "雪" };
  if (c >= 95 && c <= 99) return { emoji: "⛈", label: "雷雨" };
  return null; // 未知コードは表示しない
}

// ---------- 地域の中心座標（その地域のスポット座標の平均） ----------
function weatherRegionCenter(region) {
  const spots = (typeof SPOT_DATA !== "undefined" && SPOT_DATA[region]) || [];
  const pts = spots.filter((s) => typeof s.lat === "number" && typeof s.lng === "number");
  if (pts.length === 0) {
    // サンプル外の行き先（Google検索で選択）は選択時の座標で予報を取る
    const d = typeof state !== "undefined" && state.customDest;
    if (d && d.name === region && typeof d.lat === "number") return { lat: d.lat, lng: d.lng };
    return null;
  }
  return {
    lat: pts.reduce((a, s) => a + s.lat, 0) / pts.length,
    lng: pts.reduce((a, s) => a + s.lng, 0) / pts.length
  };
}

// ---------- キャッシュ ----------
// 同一地域かつ取得から3時間未満なら有効
function isWeatherCacheValid(cache, region, nowMs) {
  if (!cache || cache.region !== region || !cache.daily) return false;
  const age = nowMs - Number(cache.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < WEATHER_CACHE_TTL_MS;
}
function loadWeatherCache() {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function saveWeatherCache(data) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    // 保存できなくても表示は続行する（次回また取得すればよい）
  }
}

// ---------- 日付ユーティリティ ----------
// 出発日 + dayIdx日 の "YYYY-MM-DD"（ローカル日付）。不正なら null
function weatherDateStr(startDate, dayIdx) {
  if (!startDate) return null;
  const d = new Date(startDate + "T00:00:00");
  if (isNaN(d)) return null;
  d.setDate(d.getDate() + dayIdx);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- 予報の検索 ----------
// daily（Open-Meteo の daily オブジェクト）から日付一致の予報を返す。なければ null
function weatherForDate(daily, dateStr) {
  if (!daily || !Array.isArray(daily.time) || !dateStr) return null;
  const i = daily.time.indexOf(dateStr);
  if (i === -1) return null;
  const info = weatherCodeInfo((daily.weather_code || [])[i]);
  return {
    emoji: info ? info.emoji : "",
    label: info ? info.label : "",
    tmax: (daily.temperature_2m_max || [])[i],
    tmin: (daily.temperature_2m_min || [])[i],
    pop: (daily.precipitation_probability_max || [])[i] // 降水確率（%）。null のことがある
  };
}
// 日付が予報範囲に対してどの位置か: "ok"=予報あり / "beyond"=範囲より先（16日超） / "none"=過去・不正
function weatherDateStatus(daily, dateStr) {
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0 || !dateStr) return "none";
  if (daily.time.indexOf(dateStr) !== -1) return "ok";
  // ISO形式（YYYY-MM-DD）は文字列比較で日付順になる
  return dateStr > daily.time[daily.time.length - 1] ? "beyond" : "none";
}

// ============================================================
// 取得と描画
// ============================================================
let weatherData = null;     // 表示中の予報 { region, lat, lng, fetchedAt, daily }
let weatherFetching = false; // 二重fetch防止

// app.js から呼ばれる入口（renderAll の末尾・出発日変更時）。
// キャッシュが有効なら fetch せず、そのまま描画だけやり直す
function renderWeather() {
  const region = state.region;
  const now = Date.now();
  if (!isWeatherCacheValid(weatherData, region, now)) {
    weatherData = null;
    const cache = loadWeatherCache();
    if (isWeatherCacheValid(cache, region, now)) {
      weatherData = cache;
    } else {
      fetchWeather(region); // 非同期。完了後に applyWeatherUI() が再実行される
    }
  }
  applyWeatherUI();
}

async function fetchWeather(region) {
  if (weatherFetching) return;
  if (typeof fetch !== "function") return; // テスト環境・非対応環境では何もしない
  const center = weatherRegionCenter(region);
  if (!center) return;
  weatherFetching = true;
  try {
    const url = "https://api.open-meteo.com/v1/forecast"
      + `?latitude=${center.lat.toFixed(4)}&longitude=${center.lng.toFixed(4)}`
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
      + `&timezone=Asia%2FTokyo&forecast_days=${WEATHER_FORECAST_DAYS}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (!json || !json.daily || !Array.isArray(json.daily.time)) throw new Error("応答の形式が不正");
    weatherData = { region, lat: center.lat, lng: center.lng, fetchedAt: Date.now(), daily: json.daily };
    saveWeatherCache(weatherData);
  } catch (e) {
    // 失敗時は天気UIを出さないだけ（エラー表示なし・他機能へ影響なし）
    weatherData = null;
  } finally {
    weatherFetching = false;
    applyWeatherUI();
    // 取得中に地域が変わっていたら改めて取得し直す
    if (state.region !== region) renderWeather();
  }
}

// 現在の表示に使える予報データ（地域一致のもの）。なければ null
function currentWeatherDaily() {
  return weatherData && weatherData.region === state.region ? weatherData.daily : null;
}

function applyWeatherUI() {
  applyWeatherToDayTabs();
  applyWeatherSummary();
}

// ① 日タブ: 絵文字＋最高気温を小さく追記（例: 1日目（2/14）☀ 12°）
function applyWeatherToDayTabs() {
  const wrap = document.getElementById("day-tabs");
  if (!wrap) return;
  const daily = currentWeatherDaily();
  const tabs = wrap.querySelectorAll(".day-tab");
  tabs.forEach((btn, i) => {
    const old = btn.querySelector(".day-tab-weather");
    if (old) old.remove();
    if (!daily) return;
    const f = weatherForDate(daily, weatherDateStr(state.startDate, i));
    if (!f || typeof f.tmax !== "number") return;
    const span = document.createElement("span");
    span.className = "day-tab-weather";
    span.textContent = `${f.emoji} ${Math.round(f.tmax)}°`;
    btn.appendChild(span);
  });
}

// ② タイムライン上部の1行（例: ☀ 晴れ 最高12° / 最低3°　降水確率10%）
function applyWeatherSummary() {
  const el = document.getElementById("weather-summary");
  if (!el) return;
  const hide = () => {
    el.hidden = true;
    el.innerHTML = "";
    el.title = "";
  };
  const daily = currentWeatherDaily();
  if (!daily) { hide(); return; }
  const dateStr = weatherDateStr(state.startDate, state.activeDay);
  const status = weatherDateStatus(daily, dateStr);
  if (status === "beyond") {
    // 出発日が16日より先：予報はまだ出ない
    el.innerHTML = '<span class="weather-note">この日の予報はまだありません（2週間前から表示されます）</span>';
    el.title = "";
    el.hidden = false;
    return;
  }
  const f = status === "ok" ? weatherForDate(daily, dateStr) : null;
  if (!f) { hide(); return; }
  let html = `<span class="weather-emoji">${f.emoji}</span> ${f.label}`;
  if (typeof f.tmax === "number") html += ` 最高${Math.round(f.tmax)}°`;
  if (typeof f.tmin === "number") html += ` / 最低${Math.round(f.tmin)}°`;
  if (typeof f.pop === "number") {
    // 降水確率50%以上は強調（スタイルはデザイナーが後で調整する）
    const popClass = f.pop >= 50 ? "weather-pop weather-pop-high" : "weather-pop";
    html += `　<span class="${popClass}">降水確率${Math.round(f.pop)}%</span>`;
  }
  el.innerHTML = html;
  const fetched = new Date(Number(weatherData.fetchedAt));
  el.title = `Open-Meteoによる予報（取得: ${fetched.getMonth() + 1}/${fetched.getDate()} ${fetched.getHours()}:${String(fetched.getMinutes()).padStart(2, "0")}）`;
  el.hidden = false;
}
