// ============================================================
// 行った場所の記録（履歴DB）
//  - 旅を完了すると、日程に入れたスポット・宿を店舗情報（住所・評価・電話・サイト）ごと記録
//  - 「行った場所」タブで検索・メモ編集・候補リストへの再追加ができる（再検索の手間を減らす）
//  - 計画画面の候補リスト下に「以前行った場所」を自動表示する
// ============================================================
const History = (() => {
  let places = [];      // 検索結果（現在の絞り込み）
  let regionCache = {}; // region -> places（候補リスト下の表示用）
  let trips = [];
  let visible = false;
  let query = "";
  let regionFilter = "";
  let setupDone = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s); }
  function toast(msg, action) { if (typeof showSnackbar === "function") showSnackbar(msg, action); }
  function canSave() { return typeof Projects !== "undefined" && Projects.isServerMode(); }

  function onProjectChanged() {
    regionCache = {};
    renderInline();
  }

  // ---------- 記録 ----------
  // 詳細モーダルから：1件だけ記録（訪問回数は増やさない）
  async function savePlace(spot, g) {
    if (!canSave() || !spot || !spot.name) return;
    try {
      const body = placeBody(spot, g);
      await Api.post("/api/history/places", body);
      regionCache = {};
      renderInline();
      toast(`「${spot.name}」を行った場所に記録しました`);
    } catch (e) { toast("記録に失敗しました：" + e.message); }
  }

  function placeBody(spot, g, extra) {
    const isHotel = spot.category === "hotel";
    return Object.assign({
      name: spot.name,
      category: isHotel ? "hotel" : spot.category === "food" ? "food" : "sightseeing",
      region: state.region,
      lat: spot.lat != null ? spot.lat : null,
      lng: spot.lng != null ? spot.lng : null,
      placeId: spot.placeId || null,
      address: g && g.address ? g.address : (spot.isCustom && spot.source === "google" ? spot.desc : null),
      rating: g && g.rating != null ? g.rating : (spot.rating != null ? spot.rating : null),
      ratingCount: g && g.ratingCount != null ? g.ratingCount : null,
      photoUrl: g && g.photos && g.photos[0] ? g.photos[0] : null,
      website: g && g.website ? g.website : null,
      phone: g && g.phone ? g.phone : null,
      memo: null,
      stayMin: isHotel ? null : (Number(spot.stayMin) || null),
      cost: isHotel ? (Number(spot.price) || null) : (Number(spot.cost) || 0)
    }, extra || {});
  }

  // 旅を完了：日程のスポットと宿をまとめて記録
  async function archiveCurrent() {
    const p = Projects.current();
    if (!p) return;
    const items = [];
    const seen = new Set();
    state.days.forEach((d) => {
      d.items.forEach((it) => {
        const s = findSpot(it.spotId);
        if (!s || seen.has(s.id)) return;
        seen.add(s.id);
        const g = typeof detailCache !== "undefined" ? detailCache[s.id] : null;
        items.push(placeBody(Object.assign({}, s, { stayMin: it.stayMin, cost: it.cost }), g));
      });
      if (d.hotel && d.hotel.name && !seen.has("hotel:" + d.hotel.name)) {
        seen.add("hotel:" + d.hotel.name);
        const key = typeof hotelDetailKey === "function" ? hotelDetailKey(d.hotel) : null;
        const g = key && typeof detailCache !== "undefined" ? detailCache[key] : null;
        items.push(placeBody(Object.assign({ category: "hotel" }, d.hotel), g));
      }
    });
    if (items.length === 0) {
      toast("日程にスポットや宿が入っていないので、記録するものがありません");
      return;
    }
    if (!confirm(`「${p.name}」を完了にして、${items.length}か所を行った場所に記録します。よろしいですか？`)) return;
    try {
      const total = typeof grandTotal === "function" ? grandTotal() : null;
      const r = await Api.post(`/api/projects/${p.id}/archive`, { places: items, totalCost: total });
      await Projects.setStatus("done");
      regionCache = {};
      renderInline();
      toast(`${r.savedPlaces}か所を記録しました。「行った場所」タブで見られます`, { label: "見る", onClick: () => Projects.switchMode("history") });
    } catch (e) { toast("記録に失敗しました：" + e.message); }
  }

  // ---------- 候補リスト下の「以前行った場所」 ----------
  function placesForRegion(region) {
    return (regionCache[region] || []).slice();
  }

  async function loadRegion(region) {
    if (!canSave() || !region) return [];
    if (regionCache[region]) return regionCache[region];
    try {
      const r = await Api.get(`/api/history/places?region=${encodeURIComponent(region)}&limit=50`);
      regionCache[region] = r;
      return r;
    } catch (e) { return []; }
  }

  function renderInline() {
    const box = $("history-spots");
    const ul = $("history-results");
    if (!box || !ul) return;
    if (!canSave() || !state || !state.region) { box.hidden = true; return; }
    const region = state.region;
    const cached = regionCache[region];
    if (!cached) {
      loadRegion(region).then(() => { if (state.region === region) renderInline(); });
      box.hidden = true;
      return;
    }
    const items = cached.filter((h) => h.category !== "hotel");
    if (items.length === 0) { box.hidden = true; return; }
    box.hidden = false;
    ul.innerHTML = "";
    items.slice(0, 12).forEach((h) => {
      const li = document.createElement("li");
      li.className = "place-result history-row";
      const already = isInCandidates(h);
      li.innerHTML = `
        <span class="history-mark" aria-hidden="true">${h.visitCount || 0}</span>
        <div class="pr-info">
          <div class="pr-name"></div>
          <div class="pr-address"></div>
        </div>`;
      li.querySelector(".pr-name").textContent = h.name;
      li.querySelector(".pr-address").textContent = [h.lastVisited ? `最終 ${fmtDate(h.lastVisited)}` : "", h.rating ? `★${h.rating}` : "", h.memo || h.address || ""].filter(Boolean).join("　");
      li.querySelector(".pr-info").onclick = () => openHistoryDetail(h);
      const btn = document.createElement("button");
      btn.className = "add-spot-btn";
      if (already) { btn.textContent = "候補にあります"; btn.disabled = true; }
      else { btn.textContent = "候補に追加"; btn.onclick = () => addToCandidates(h); }
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  function isInCandidates(h) {
    const spots = typeof spotsForRegion === "function" ? spotsForRegion() : [];
    return spots.some((s) => (h.placeId && s.placeId === h.placeId) || s.name === h.name);
  }

  function addToCandidates(h) {
    if (isInCandidates(h)) { toast(`「${h.name}」は候補にあります`); return; }
    if (h.lat == null || h.lng == null) { toast("位置情報がない場所は候補に追加できません"); return; }
    const id = "g-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    state.customSpots.push({
      id, placeId: h.placeId || null, name: h.name, category: h.category === "food" ? "food" : "sightseeing",
      desc: h.memo || h.address || "", lat: h.lat, lng: h.lng, stayMin: h.stayMin || 60, cost: h.cost || 0,
      region: state.region, isCustom: true, source: h.placeId ? "google" : "history"
    });
    saveState();
    renderAll();
    if (typeof highlightSpot === "function") highlightSpot(id);
    toast(`「${h.name}」を候補リストに追加しました`);
  }

  function openHistoryDetail(h) {
    // 履歴の店舗情報を詳細モーダルで見せる（Google照会なし。記録済みの情報だけ）
    if (typeof renderDetailModal !== "function") return;
    const spotLike = { name: h.name, category: h.category, desc: h.memo || "", stayMin: h.stayMin || 60, cost: h.cost || 0, lat: h.lat, lng: h.lng, price: h.cost || 0, priceUnknown: !h.cost, rating: h.rating };
    const g = {
      photos: h.photoUrl ? [h.photoUrl] : [], rating: h.rating, ratingCount: h.ratingCount, summary: h.memo ? `メモ：${h.memo}` : "",
      address: h.address || "", phone: h.phone || "", website: h.website || "", mapsUrl: h.lat != null ? `https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}` : "",
      openingHours: [], reviews: []
    };
    renderDetailModal(spotLike, g, false);
    if (typeof TravelMap !== "undefined" && h.lat != null && Projects.mode() === "plan") TravelMap.panTo({ lat: h.lat, lng: h.lng });
  }

  function fmtDate(s) {
    if (!s || s.length < 10) return s || "";
    return `${s.slice(0, 4)}/${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  }

  // ---------- 「行った場所」タブ ----------
  async function show() {
    visible = true;
    setupOnce();
    await Promise.all([search(), loadTrips()]);
  }
  function hide() { visible = false; }

  function setupOnce() {
    if (setupDone) return;
    setupDone = true;
    const input = $("history-search");
    if (input) {
      let t = null;
      input.oninput = () => { clearTimeout(t); t = setTimeout(() => { query = input.value.trim(); search(); }, 250); };
    }
  }

  async function search() {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (regionFilter) params.set("region", regionFilter);
    try {
      places = await Api.get("/api/history/places?" + params.toString());
    } catch (e) { places = []; }
    renderRegionChips();
    renderPlaces();
  }

  async function loadTrips() {
    try { trips = await Api.get("/api/history/trips"); } catch (e) { trips = []; }
    renderTrips();
  }

  function renderRegionChips() {
    const wrap = $("history-regions");
    if (!wrap) return;
    const regions = Array.from(new Set(places.map((p) => p.region).filter(Boolean)));
    if (regionFilter && !regions.includes(regionFilter)) regions.unshift(regionFilter);
    wrap.innerHTML = "";
    const all = document.createElement("button");
    all.type = "button";
    all.className = "chip" + (regionFilter ? "" : " active");
    all.textContent = "すべて";
    all.onclick = () => { regionFilter = ""; search(); };
    wrap.appendChild(all);
    regions.forEach((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (regionFilter === r ? " active" : "");
      b.textContent = r;
      b.onclick = () => { regionFilter = r; search(); };
      wrap.appendChild(b);
    });
  }

  function renderPlaces() {
    const list = $("history-list");
    const count = $("history-count");
    if (!list) return;
    if (count) count.textContent = String(places.length);
    list.innerHTML = "";
    if (places.length === 0) {
      list.innerHTML = '<div class="history-empty"><span class="material-symbols-outlined">menu_book</span>' + (query || regionFilter ? "該当する場所がありません" : "まだ記録がありません。旅が終わったら「旅を完了して記録」でここに店舗情報が残ります。") + "</div>";
      return;
    }
    const current = Projects.current();
    places.forEach((h, i) => {
      const card = document.createElement("article");
      card.className = "history-card";
      card.dataset.cat = h.category || "sightseeing";
      card.style.animationDelay = `${Math.min(i, 12) * 40}ms`;
      const catLabel = h.category === "hotel" ? "宿" : h.category === "food" ? "グルメ" : "観光";
      card.innerHTML = `
        <div class="history-card-cover" aria-hidden="true">${h.photoUrl ? `<img src="${esc(h.photoUrl)}" alt="" loading="lazy">` : `<span class="material-symbols-outlined">${h.category === "hotel" ? "hotel" : h.category === "food" ? "restaurant" : "attractions"}</span>`}</div>
        <div class="history-card-body">
          <div class="history-card-top">
            <span class="cat-badge ${h.category === "hotel" ? "cat-hotel" : h.category === "food" ? "cat-food" : "cat-sightseeing"}">${catLabel}</span>
            <span class="history-region">${esc(h.region || "")}</span>
            <span class="history-visits" title="訪問回数">${h.visitCount || 0}回</span>
          </div>
          <h3 class="history-name"></h3>
          <div class="history-meta">${h.rating ? `<span class="pr-rating">★ ${h.rating}${h.ratingCount ? ` <span class="count">(${Number(h.ratingCount).toLocaleString()})</span>` : ""}</span>` : ""}${h.lastVisited ? `<span>最終訪問 ${esc(fmtDate(h.lastVisited))}</span>` : ""}${h.cost ? `<span>${Number(h.cost).toLocaleString()}円</span>` : ""}</div>
          <div class="history-address"></div>
          <div class="history-links">${h.phone ? `<a href="tel:${esc(h.phone)}"><span class="material-symbols-outlined">call</span>${esc(h.phone)}</a>` : ""}${h.website ? `<a href="${esc(h.website)}" target="_blank" rel="noopener"><span class="material-symbols-outlined">language</span>公式サイト</a>` : ""}${h.lat != null ? `<a href="https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}" target="_blank" rel="noopener"><span class="material-symbols-outlined">map</span>地図</a>` : ""}</div>
          <label class="history-memo"><span class="material-symbols-outlined">edit_note</span><input type="text" placeholder="メモ（次回のために：混み具合・おすすめ・注意）" maxlength="500"></label>
        </div>
        <div class="history-card-actions">
          <button type="button" class="btn btn-outline btn-sm" data-act="add"><span class="material-symbols-outlined">add_location_alt</span>候補に追加</button>
          <button type="button" class="icon-btn" data-act="del" title="記録を削除" aria-label="記録を削除"><span class="material-symbols-outlined">delete</span></button>
        </div>`;
      card.querySelector(".history-name").textContent = h.name;
      card.querySelector(".history-address").textContent = h.address || "";
      const memo = card.querySelector(".history-memo input");
      memo.value = h.memo || "";
      memo.onchange = async () => {
        try { const r = await Api.patch(`/api/history/places/${h.id}`, { memo: memo.value }); h.memo = r.memo; regionCache = {}; toast("メモを保存しました"); }
        catch (e) { toast("保存に失敗しました：" + e.message); }
      };
      const addBtn = card.querySelector('[data-act="add"]');
      if (!current || h.category === "hotel") { addBtn.disabled = true; addBtn.title = !current ? "旅を開いてから追加できます" : "宿はホテルタブから選びます"; }
      else if (h.region && h.region !== state.region) { addBtn.title = `いまの旅（${state.region}）と地域が違います`; addBtn.onclick = () => { if (confirm(`この場所は「${h.region}」の記録です。いまの旅（${state.region}）の候補に追加しますか？`)) { addToCandidates(h); Projects.switchMode("plan"); } }; }
      else addBtn.onclick = () => { addToCandidates(h); Projects.switchMode("plan"); };
      card.querySelector('[data-act="del"]').onclick = async () => {
        if (!confirm(`「${h.name}」の記録を削除しますか？`)) return;
        try { await Api.del(`/api/history/places/${h.id}`); regionCache = {}; await search(); renderInline(); toast("削除しました"); }
        catch (e) { toast("削除に失敗しました：" + e.message); }
      };
      list.appendChild(card);
    });
  }

  function renderTrips() {
    const box = $("history-trips");
    if (!box) return;
    box.innerHTML = "";
    if (trips.length === 0) { box.innerHTML = '<div class="history-empty history-empty-sub">完了した旅はまだありません。</div>'; return; }
    trips.forEach((t) => {
      const row = document.createElement("article");
      row.className = "trip-row";
      const n = (t.places || []).length;
      row.innerHTML = `
        <div class="trip-main">
          <div class="trip-name"></div>
          <div class="trip-meta"><span class="trip-region"></span>${t.startDate ? `<span>${esc(fmtDate(t.startDate))}〜 ${t.numDays || 1}日間</span>` : ""}<span>${n}か所</span>${t.totalCost ? `<span>¥${Number(t.totalCost).toLocaleString()}</span>` : ""}</div>
          <div class="trip-places">${(t.places || []).slice(0, 8).map((p) => `<span>${esc(p.name)}</span>`).join("")}${n > 8 ? `<span>…他${n - 8}</span>` : ""}</div>
        </div>
        <div class="trip-actions">
          <button type="button" class="btn btn-outline btn-sm" data-act="reuse"><span class="material-symbols-outlined">restart_alt</span>この旅を土台に新しい旅</button>
          <button type="button" class="icon-btn" data-act="del" title="旅の記録を削除" aria-label="旅の記録を削除"><span class="material-symbols-outlined">delete</span></button>
        </div>`;
      row.querySelector(".trip-name").textContent = t.name || "旅";
      row.querySelector(".trip-region").textContent = t.region || "";
      row.querySelector('[data-act="reuse"]').onclick = () => Projects.duplicateProject(t.projectId).catch(() => toast("元の旅が削除されているため複製できません"));
      row.querySelector('[data-act="del"]').onclick = async () => {
        if (!confirm(`「${t.name}」の旅の記録を削除しますか？（場所の記録は残ります）`)) return;
        try { await Api.del(`/api/history/trips/${t.id}`); await loadTrips(); } catch (e) { toast("削除に失敗しました：" + e.message); }
      };
      box.appendChild(row);
    });
  }

  return { show, hide, onProjectChanged, savePlace, archiveCurrent, canSave, renderInline, placesForRegion, addToCandidates };
})();
