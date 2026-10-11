// ============================================================
// プロジェクト（旅）の管理
//  - ホーム（ヒーロー画面「どこへ行きますか？」）に「これまでの旅」を出す
//  - 行き先が選ばれたら新しい旅を作ってウィザード（日程→希望→旅程案）へ
//  - 開いている旅の切り替え・改名・複製・削除
//  - state の自動保存をサーバー（PUT /api/projects/{id}/plan）にも流し、
//    ヘッダーの「保存」ボタンで即保存＋保存状態の表示
//  - 画面モード（計画／みんなで決める／行った場所）の切り替え
// サーバーが無いときは従来の localStorage 単独モード（ホームの旅一覧とモードタブは出ない）
// ============================================================
const Projects = (() => {
  const ACTIVE_KEY = "travel-planner-active-project";
  const STATUS_LABEL = { collecting: "絵馬あつめ中", voting: "投票中", decided: "行き先決定", done: "旅おわり", local: "この端末に保存", editing: "編集中・未保存" };
  const LOCAL_TRIPS_KEY = "travel-planner-local-trips-v1"; // ローカル保存モードの旅一覧（localStorage）
  let localTrips = [];      // [{ id, name, region, startDate, numDays, spotCount, savedAt, plan }] 新しい順
  let activeLocalId = null; // 一覧のどの旅を編集中か（null＝まだ一覧にない）

  let serverMode = false;
  let startAppFn = null;
  let list = [];        // 一覧（plan は含まない）
  let current = null;   // 開いている旅
  let saveTimer = null;
  let saveDirty = false; // 未保存の変更があるか
  let saveErrorShown = false;
  let mode = "plan";    // plan | collab | history

  function $(id) { return document.getElementById(id); }
  function esc(s) { return typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s); }
  function toast(msg, action) { if (typeof showSnackbar === "function") showSnackbar(msg, action); }
  function nowLabel() {
    const d = new Date();
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // ---------- 起動 ----------
  async function boot(startApp) {
    startAppFn = startApp;
    serverMode = await Api.detect();
    if (document.body) document.body.classList.toggle("server-mode", serverMode);
    setupUi();
    if (!serverMode) {
      loadLocalTrips();
      startAppFn();
      renderHeader();
      setSaveStatus("この端末に保存されます");
      return;
    }
    try {
      await refreshList();
    } catch (e) {
      console.error(e);
    }
    const last = localStorage.getItem(ACTIVE_KEY);
    if (last && list.some((p) => p.id === last)) {
      try {
        await openProject(last);
        return;
      } catch (e) {
        console.error(e);
      }
    }
    state = defaultState();
    state.heroSeen = true; // ホーム（ヒーロー）は showHome で明示的に開く
    startAppFn();
    renderHeader();
    showHome();
  }

  function setupUi() {
    const homeBtn = $("home-btn");
    if (homeBtn) homeBtn.onclick = showHome;
    const historyLink = $("hero-history-link");
    if (historyLink) historyLink.onclick = () => { closeHero(); switchMode("history"); };
    document.querySelectorAll("#mode-tabs .mode-tab").forEach((btn) => {
      btn.onclick = () => switchMode(btn.dataset.mode);
    });
    const nameInput = $("project-name-input");
    if (nameInput) {
      nameInput.onchange = () => renameProject(nameInput.value);
      nameInput.onkeydown = (e) => { if (e.key === "Enter") nameInput.blur(); };
    }
    const saveBtn = $("save-btn");
    if (saveBtn) saveBtn.onclick = saveNow;
    const dup = $("duplicate-btn");
    if (dup) dup.onclick = () => duplicateProject(current && current.id);
    const del = $("delete-project-btn");
    if (del) del.onclick = () => deleteProject(current && current.id);
    const arch = $("archive-btn");
    if (arch) arch.onclick = () => { closeMenu(); if (typeof History !== "undefined") History.archiveCurrent(); };
    document.querySelectorAll("#project-menu .menu-list button").forEach((b) => {
      b.addEventListener("click", closeMenu);
    });
  }

  function closeMenu() {
    const m = $("project-menu");
    if (m) m.open = false;
  }

  // ---------- 一覧（ホーム＝ヒーロー画面の「これまでの旅」） ----------
  async function refreshList() {
    list = await Api.get("/api/projects");
    return list;
  }

  function dateRange(p) {
    if (!p.startDate) return "日程未定";
    const n = Number(p.numDays) || 1;
    const start = new Date(p.startDate + "T00:00:00");
    if (isNaN(start)) return "日程未定";
    const end = new Date(start);
    end.setDate(end.getDate() + n - 1);
    const f = (d) => `${d.getMonth() + 1}/${d.getDate()}（${"日月火水木金土"[d.getDay()]}）`;
    return n === 1 ? `${f(start)} 日帰り` : `${f(start)} 〜 ${f(end)}　${n}日間`;
  }

  // ホームを開く（ヒーロー画面を home モードで。開いている旅があれば✕で戻れる）
  function showHome() {
    closeMenu();
    if (typeof closeDateRangePopover === "function") closeDateRangePopover();
    if (typeof Wizard !== "undefined") Wizard.close();
    openHero("home");
  }

  function renderHeroTrips() {
    const grid = $("hero-trips");
    if (!grid) return;
    const link = $("hero-history-link");
    if (link) link.hidden = !serverMode;
    if (!serverMode) {
      // ローカル保存モード：この端末（localStorage）に保存した旅を新しい順に並べる。
      // 編集中でまだ一覧にない旅は先頭に「編集中・未保存」として出す
      grid.innerHTML = "";
      const cards = [];
      if (!activeLocalId && planHasContent()) {
        cards.push({ id: "__editing__", name: localTripName(state), region: state.region, startDate: state.startDate,
          numDays: state.days.length, status: "editing", spotCount: countSpots(state) });
      }
      localTrips.forEach((t) => cards.push(Object.assign({}, t, { status: "local" })));
      if (cards.length === 0) {
        grid.innerHTML = '<div class="trips-empty">まだ旅がありません。上の行き先を選ぶと最初の旅がはじまります。</div>';
        return;
      }
      cards.forEach((p, i) => {
        const isOpen = p.id === "__editing__" || p.id === activeLocalId;
        grid.appendChild(buildProjectCard(p, i, {
          local: true,
          current: isOpen,
          onOpen: () => { if (isOpen) { closeHero(); switchMode("plan"); } else openLocalTrip(p.id); },
          onDelete: p.id === "__editing__" ? null : () => deleteLocalTrip(p.id)
        }));
      });
      return;
    }
    const draw = () => {
      grid.innerHTML = "";
      if (list.length === 0) {
        grid.innerHTML = '<div class="trips-empty">まだ旅がありません。上の行き先を選ぶと最初の旅がはじまります。</div>';
        return;
      }
      list.forEach((p, i) => grid.appendChild(buildProjectCard(p, i)));
    };
    draw();
    refreshList().then(draw).catch(() => {});
  }

  function buildProjectCard(p, i, opts) {
    opts = opts || {};
    // 枠（掛け棒の区間）＞吊り具（紐・傾き・揺れ）＞絵馬本体
    const slot = document.createElement("div");
    slot.className = "project-slot";
    const hang = document.createElement("div");
    hang.className = "project-hang";
    slot.appendChild(hang);
    hang.style.setProperty("--tilt", `${((i % 5) - 2) * 1.1}deg`);
    hang.style.animationDelay = `${Math.min(i, 8) * 50}ms`;
    const cord = document.createElement("i");
    cord.className = "ema-cord";
    hang.appendChild(cord);
    // 触れたら1回だけ揺れる。終わるまで続けてから外す（途中で外すと元の角度へ跳ぶため）
    hang.addEventListener("mouseenter", () => hang.classList.add("is-swinging"));
    hang.addEventListener("animationend", (e) => { if (e.animationName === "ema-swing-once") hang.classList.remove("is-swinging"); });
    const card = document.createElement("article");
    card.className = "project-card" + (p.status === "done" ? " is-done" : "") + (opts.current || (!opts.local && current && current.id === p.id) ? " is-current" : "");
    card.dataset.status = p.status;
    card.dataset.grad = String((p.region || "").length % 6);
    hang.appendChild(card);
    const counts = [];
    if (p.wishCount) counts.push(`絵馬 ${p.wishCount}枚`);
    if (p.proposalCount) counts.push(`案 ${p.proposalCount}つ`);
    if (opts.local) counts.push(p.spotCount ? `スポット ${p.spotCount}か所` : "まだ日程は空です");
    card.innerHTML = `
      <button type="button" class="project-card-main">
        <span class="project-card-cover" aria-hidden="true"><span class="project-card-region"></span></span>
        <span class="project-card-body">
          <span class="project-card-name"></span>
          <span class="project-card-dates"></span>
          <span class="project-card-counts"></span>
        </span>
        <span class="status-stamp" data-status="${esc(p.status)}">${esc(STATUS_LABEL[p.status] || p.status)}</span>
      </button>
      <div class="project-card-actions">
        <button type="button" class="icon-btn" data-act="dup" title="この旅を複製" aria-label="この旅を複製"><span class="material-symbols-outlined">content_copy</span></button>
        <button type="button" class="icon-btn" data-act="del" title="この旅を削除" aria-label="この旅を削除"><span class="material-symbols-outlined">delete</span></button>
      </div>`;
    card.querySelector(".project-card-region").textContent = p.region || "行き先未定";
    card.querySelector(".project-card-name").textContent = p.name;
    card.querySelector(".project-card-dates").textContent = dateRange(p);
    card.querySelector(".project-card-counts").textContent = counts.join("・");
    if (opts.local) {
      card.querySelector(".project-card-main").onclick = opts.onOpen;
      card.querySelector('[data-act="dup"]').remove(); // 複製はサーバーモードだけ
      const del = card.querySelector('[data-act="del"]');
      if (opts.onDelete) del.onclick = opts.onDelete; else del.remove();
    } else {
      card.querySelector(".project-card-main").onclick = () => openProject(p.id).catch((e) => toast("開けませんでした：" + e.message));
      card.querySelector('[data-act="dup"]').onclick = () => duplicateProject(p.id);
      card.querySelector('[data-act="del"]').onclick = () => deleteProject(p.id);
    }
    if (p.region && typeof getDestPhotoUrl === "function" && typeof isGoogleMode === "function" && isGoogleMode()) {
      getDestPhotoUrl(p.region, null).then((url) => {
        if (!url) return;
        const cover = card.querySelector(".project-card-cover");
        if (cover) { cover.style.backgroundImage = `url("${url}")`; card.classList.add("has-photo"); }
      }).catch(() => {});
    }
    return slot;
  }

  // ---------- 開く・作る・消す ----------
  // 読み込んだプロジェクトを画面に反映する共通処理
  function activate(p) {
    current = p;
    localStorage.setItem(ACTIVE_KEY, p.id);
    state = normalizeState(p.plan || defaultState()); // app.js の state を差し替える
    if (!appBooted) startAppFn();
    else applyLoadedState();
    closeHero();
    if (typeof Wizard !== "undefined") Wizard.close();
    renderHeader();
    setSaveStatus(`保存済み ${nowLabel()}`);
    switchMode("plan");
    if (typeof Collab !== "undefined") Collab.onProjectChanged();
    if (typeof History !== "undefined") History.onProjectChanged();
  }

  async function openProject(id) {
    if (saveDirty) await flushSave(); // 前の旅の未保存分を先に書き出す
    const p = await Api.get(`/api/projects/${id}`);
    activate(p);
    return p;
  }

  // ---------- ローカル保存モードの旅一覧（localStorage） ----------
  function countSpots(plan) {
    return (plan.days || []).reduce((a, d) => a + (d.items ? d.items.length : 0), 0);
  }
  function loadLocalTrips() {
    try {
      const raw = JSON.parse(localStorage.getItem(LOCAL_TRIPS_KEY));
      if (raw && Array.isArray(raw.trips)) { localTrips = raw.trips; activeLocalId = raw.activeId || null; }
    } catch (e) { localTrips = []; activeLocalId = null; }
    if (activeLocalId && !localTrips.some((t) => t.id === activeLocalId)) activeLocalId = null;
  }
  function persistLocalTrips() {
    try { localStorage.setItem(LOCAL_TRIPS_KEY, JSON.stringify({ trips: localTrips, activeId: activeLocalId })); }
    catch (e) { console.error(e); toast("この端末への保存に失敗しました（容量不足の可能性）"); }
  }
  function localTripName(plan) {
    const sd = plan.startDate || "";
    const when = sd.length >= 10 ? `${Number(sd.slice(5, 7))}/${Number(sd.slice(8, 10))}〜` : "";
    const n = (plan.days || []).length;
    return `${plan.region || "旅"}の旅` + (when ? `（${when} ${n}日間）` : "");
  }
  // いまの state を一覧に書く（一覧になければ新しい項目として先頭へ）
  function upsertLocalTrip() {
    const snapshot = JSON.parse(JSON.stringify(state));
    let t = localTrips.find((x) => x.id === activeLocalId);
    if (!t) {
      t = { id: "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString() };
      localTrips.unshift(t);
      activeLocalId = t.id;
    }
    t.plan = snapshot;
    t.name = localTripName(snapshot);
    t.region = snapshot.region;
    t.startDate = snapshot.startDate;
    t.numDays = (snapshot.days || []).length;
    t.spotCount = countSpots(snapshot);
    t.savedAt = new Date().toISOString();
    persistLocalTrips();
    return t;
  }
  function openLocalTrip(id) {
    const t = localTrips.find((x) => x.id === id);
    if (!t) return;
    activeLocalId = id;
    persistLocalTrips();
    state = normalizeState(JSON.parse(JSON.stringify(t.plan)));
    saveState(); // 作業中の計画（travel-planner-v1）も差し替える
    applyLoadedState();
    closeHero();
    switchMode("plan");
    toast(`「${t.name}」を開きました`);
  }
  function deleteLocalTrip(id) {
    const t = localTrips.find((x) => x.id === id);
    if (!t) return;
    if (!confirm(`「${t.name}」をこの端末の一覧から削除しますか？`)) return;
    localTrips = localTrips.filter((x) => x.id !== id);
    if (activeLocalId === id) {
      // 開いていた旅を消した：作業中の計画も空に戻す（「編集中」として一覧に残らないように）
      activeLocalId = null;
      state = defaultState();
      state.heroSeen = true;
      saveState();
      applyLoadedState();
      setSaveStatus("");
    }
    persistLocalTrips();
    renderHeroTrips();
    toast("削除しました");
  }
  // ローカル保存モードでホームから行き先を選んだ：いまの旅は一覧に残し、新しい旅を始める
  function startNewLocalTrip(dest) {
    if (activeLocalId || planHasContent()) upsertLocalTrip(); // 保存済みなら最新化、未保存でも中身があれば残す
    activeLocalId = null;
    persistLocalTrips();
    state = defaultState();
    state.heroSeen = true;
    saveState();
    applyLoadedState();
    applyDestination(dest); // 空の旅なので確認なしで入る
    closeHero();
    toast(`「${state.region}」への新しい旅をはじめます（前の旅は「これまでの旅」に残っています）`);
    if (typeof Wizard !== "undefined") Wizard.open(2);
  }

  // ホームで行き先が選ばれた：新しい旅を作り、行き先を入れてウィザード（日程→希望→旅程案）へ
  async function startNewTrip(dest) {
    if (!serverMode) { startNewLocalTrip(dest); return; }
    try {
      if (saveDirty) await flushSave();
      const s = defaultState();
      s.heroSeen = true;
      const p = await Api.post("/api/projects", { plan: s });
      await refreshList();
      activate(p);
      applyDestination(dest); // 空の旅なので確認なしで入る（保存→自動命名）
      toast(`「${state.region}」への新しい旅をはじめます`);
      if (typeof Wizard !== "undefined") Wizard.open(2);
    } catch (e) {
      toast("新しい旅を作れませんでした：" + e.message);
    }
  }

  async function duplicateProject(id) {
    if (!id) return;
    try {
      const p = await Api.post(`/api/projects/${id}/duplicate`);
      await refreshList();
      activate(p);
      toast("候補リストと出発地を引き継いだ新しい旅を作りました");
    } catch (e) {
      toast("複製に失敗しました：" + e.message);
    }
  }

  async function deleteProject(id) {
    if (!id) return;
    const p = list.find((x) => x.id === id) || current;
    const name = p ? p.name : "この旅";
    if (!confirm(`「${name}」を削除します。絵馬・旅程案・投票も消えます（行った場所の記録は残ります）。よろしいですか？`)) return;
    try {
      await Api.del(`/api/projects/${id}`);
      await refreshList();
      if (current && current.id === id) {
        current = null;
        localStorage.removeItem(ACTIVE_KEY);
        state = defaultState();
        state.heroSeen = true;
        applyLoadedState();
        renderHeader();
        showHome();
      } else {
        renderHeroTrips();
      }
      toast("削除しました");
    } catch (e) {
      toast("削除に失敗しました：" + e.message);
    }
  }

  async function renameProject(name) {
    if (!current) return;
    const v = (name || "").trim();
    if (!v || v === current.name) { renderHeader(); return; }
    try {
      current = await Api.patch(`/api/projects/${current.id}`, { name: v });
      delete current.plan;
      renderHeader();
    } catch (e) {
      toast("名前の変更に失敗しました：" + e.message);
    }
  }

  async function setStatus(status) {
    if (!current) return null;
    current = await Api.patch(`/api/projects/${current.id}`, { status });
    delete current.plan;
    renderHeader();
    return current;
  }

  // ---------- 保存 ----------
  // state が変わるたびに app.js の saveState() から呼ばれる（localStorage には書かれた後）
  function onStateSaved() {
    if (!serverMode) {
      if (activeLocalId) upsertLocalTrip(); // 一覧の項目も最新に保つ
      setSaveStatus(`この端末に保存 ${nowLabel()}`);
      return;
    }
    if (!current) return;
    saveDirty = true;
    setSaveStatus("未保存");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 600);
  }

  async function flushSave() {
    if (!serverMode || !current) return false;
    clearTimeout(saveTimer);
    saveDirty = false;
    const id = current.id;
    try {
      const p = await Api.put(`/api/projects/${id}/plan`, { plan: state });
      if (current && current.id === id) {
        current.name = p.name;
        current.region = p.region;
        current.startDate = p.startDate;
        current.numDays = p.numDays;
        renderHeader();
      }
      saveErrorShown = false;
      setSaveStatus(`保存しました ${nowLabel()}`);
      return true;
    } catch (e) {
      console.error(e);
      saveDirty = true;
      setSaveStatus("保存できませんでした");
      if (!saveErrorShown) {
        saveErrorShown = true;
        toast("サーバーへの保存に失敗しました（この端末には保存されています）");
      }
      return false;
    }
  }

  // ヘッダーの「保存」ボタン：その場で書き出して結果を知らせる
  async function saveNow() {
    const btn = $("save-btn");
    if (btn) btn.disabled = true;
    try {
      if (typeof saveState === "function") saveState(); // localStorage（＋サーバーへの予約）
      if (serverMode && current) {
        const ok = await flushSave();
        if (ok) {
          showHome(); // 保存したらホームへ。「これまでの旅」に保存した旅が並び、押すとまた開ける
          toast(`「${current.name}」を保存しました。カードを押すとまた開けます`);
        } else {
          toast("保存に失敗しました。接続を確認してください");
        }
      } else if (serverMode) {
        toast("旅を開いてから保存できます");
      } else {
        const t = upsertLocalTrip(); // 一覧に載せる（既にあれば最新化）
        setSaveStatus(`この端末に保存 ${nowLabel()}`);
        showHome(); // ホームへ戻り、「これまでの旅」に並べる
        toast(`「${t.name}」をこの端末に保存しました（${localTrips.length}件）。サーバーを起動すると共有・投票も使えます`);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function setSaveStatus(text) {
    const el = $("save-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-dirty", text === "未保存");
    el.classList.toggle("is-error", text === "保存できませんでした");
  }

  // ---------- ヘッダー・モード ----------
  function renderHeader() {
    const nameInput = $("project-name-input");
    const stamp = $("project-status");
    if (nameInput) {
      nameInput.value = current ? current.name : "";
      nameInput.hidden = !serverMode || !current;
    }
    if (stamp) {
      if (serverMode && current) {
        stamp.hidden = false;
        stamp.dataset.status = current.status;
        stamp.textContent = STATUS_LABEL[current.status] || current.status;
      } else {
        stamp.hidden = true;
      }
    }
    const tabs = $("mode-tabs");
    if (tabs) tabs.hidden = !serverMode || !current;
    const menu = $("project-menu");
    if (menu) menu.querySelectorAll(".server-only").forEach((el) => { el.hidden = !serverMode || !current; });
    const offline = $("offline-note");
    if (offline) offline.hidden = serverMode;
    const saveArea = $("save-area");
    if (saveArea) saveArea.hidden = serverMode && !current;
  }

  function switchMode(next) {
    if (!serverMode && next !== "plan") next = "plan";
    mode = next;
    closeMenu();
    if (typeof closeDateRangePopover === "function") closeDateRangePopover();
    const views = { plan: $("plan-view"), collab: $("collab-view"), history: $("history-view") };
    Object.keys(views).forEach((k) => { if (views[k]) views[k].hidden = k !== next; });
    document.querySelectorAll("#mode-tabs .mode-tab").forEach((b) => {
      const on = b.dataset.mode === next;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (document.body) {
      document.body.classList.toggle("mode-plan", next === "plan");
      document.body.classList.toggle("mode-collab", next === "collab");
      document.body.classList.toggle("mode-history", next === "history");
    }
    if (next === "plan" && typeof TravelMap !== "undefined" && TravelMap.resize) {
      setTimeout(() => {
        TravelMap.resize(); // 非表示中に崩れた地図のサイズを直す
        if (typeof renderMapView === "function") renderMapView(); // 非表示中の描画はズームが狂うので描き直す
      }, 60);
    }
    if (typeof Collab !== "undefined") { if (next === "collab") Collab.show(); else Collab.hide(); }
    if (typeof History !== "undefined") { if (next === "history") History.show(); else History.hide(); }
  }

  function setCollabBadge(n) {
    const b = $("mode-collab-badge");
    if (!b) return;
    b.hidden = !n;
    b.textContent = n ? String(n) : "";
  }

  return {
    boot, onStateSaved, flushSave, saveNow, showHome, renderHeroTrips, openProject, startNewTrip, duplicateProject,
    deleteProject, renameProject, setStatus, switchMode, renderHeader, refreshList, setCollabBadge,
    current: () => current,
    hasLocalTrips: () => localTrips.length > 0,
    isServerMode: () => serverMode,
    mode: () => mode,
    statusLabel: (s) => STATUS_LABEL[s] || s
  };
})();
