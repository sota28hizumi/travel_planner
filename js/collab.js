// ============================================================
// みんなで決める（共有リンク・QR／絵馬＝要望／AI旅程案／投票／採用）
//  - 「みんなで決める」タブ（#collab-view）の描画
//  - ウィザード（wizard.js）からも使う部品：希望フォーム・共有情報・案の生成と表示・採用
// 要望は「絵馬」、投票は「朱印」の見立てで描く（CSS: .ema / .stamp）
// ============================================================
const Collab = (() => {
  const VOTER_KEY = "travel-planner-owner-voter";
  const VIBES = ["グルメ", "絶景・自然", "歴史・文化", "のんびり", "アクティブ", "ショッピング", "温泉", "夜景・夜遊び", "写真映え", "子連れ・家族"];
  const TRANSPORTS = ["電車・バス", "車・レンタカー", "徒歩中心", "自転車", "おまかせ"];
  const BUDGETS = ["〜1万円", "1〜3万円", "3〜5万円", "5万円〜", "こだわらない"];

  let visible = false;
  let wishes = [];
  let proposals = [];
  let lastSig = "";
  let pollTimer = null;
  let shareUrl = "";
  let generating = false;
  let lastCandidatePool = null;
  let setupDone = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s); }
  function toast(msg, action) { if (typeof showSnackbar === "function") showSnackbar(msg, action); }
  function pid() { const p = Projects.current(); return p ? p.id : null; }
  function status() { const p = Projects.current(); return p ? p.status : "collecting"; }

  function voterId() {
    let v = localStorage.getItem(VOTER_KEY);
    if (!v) { v = "owner-" + Math.random().toString(36).slice(2, 10); localStorage.setItem(VOTER_KEY, v); }
    return v;
  }

  // ---------- タブの表示・ポーリング ----------
  function onProjectChanged() {
    wishes = [];
    proposals = [];
    lastSig = "";
    shareUrl = "";
    lastCandidatePool = null;
    if (visible) show();
  }

  async function show() {
    visible = true;
    if (!pid()) return;
    setupOnce();
    renderPhase();
    await Promise.all([renderShareCard(), refresh()]);
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (visible) refresh(); }, 8000);
  }

  function hide() {
    visible = false;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function setupOnce() {
    if (setupDone) return;
    setupDone = true;
    const copy = $("share-copy");
    if (copy) copy.onclick = () => copyShareUrl($("share-url"));
    const refreshBtn = $("wish-refresh");
    if (refreshBtn) refreshBtn.onclick = () => refresh(true);
    const gen = $("generate-btn");
    if (gen) gen.onclick = generateForTab;
    const form = $("owner-wish-form");
    if (form) {
      buildWishForm(form, { submitLabel: "絵馬を掛ける" });
      form.onsubmit = async (e) => {
        e.preventDefault();
        const body = readWishForm(form);
        if (!body) { toast("雰囲気か、行きたい場所をひとつは入れてください"); return; }
        try {
          await Api.post(`/api/projects/${pid()}/wishes`, body);
          resetWishForm(form);
          const det = form.closest("details");
          if (det) det.open = false;
          await refresh(true);
          toast("絵馬を掛けました");
        } catch (err) { toast("送信に失敗しました：" + err.message); }
      };
    }
  }

  // ---------- 共有リンク・QR ----------
  async function ensureShare() {
    const id = pid();
    if (!id) return null;
    if (!shareUrl) {
      const r = await Api.post(`/api/projects/${id}/share`);
      shareUrl = r.url;
    }
    const info = Api.info();
    const lanOnly = !(info && info.shareBase && !/^https?:\/\/(127\.|localhost)/.test(info.shareBase));
    return {
      url: shareUrl,
      qrSrc: `/api/projects/${encodeURIComponent(id)}/qr.svg?t=${Date.now()}`,
      note: lanOnly
        ? "いまはこのPCからしか開けないURLです。同じWi-Fiの端末に送るには、サーバーを --host 0.0.0.0 で起動してください。"
        : "同じWi-Fiにいる人がスマホで開けます（登録不要・匿名）。外出先の人にも送るなら、トンネル等で公開してURLを PLANNER_PUBLIC_URL に設定します。"
    };
  }

  async function renderShareCard() {
    try {
      const s = await ensureShare();
      if (!s) return;
      const input = $("share-url");
      if (input) input.value = s.url;
      const qr = $("share-qr");
      if (qr) qr.innerHTML = `<img src="${esc(s.qrSrc)}" alt="共有リンクのQRコード">`;
      const note = $("share-note");
      if (note) note.textContent = s.note;
    } catch (e) {
      console.error(e);
    }
  }

  async function copyShareUrl(input) {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast("共有リンクをコピーしました");
    } catch (e) {
      if (input) { input.select(); document.execCommand && document.execCommand("copy"); }
      toast("リンクを選択しました（Ctrl+C でコピー）");
    }
  }

  // ---------- データ取得 ----------
  async function fetchWishes() {
    const id = pid();
    if (!id) return [];
    wishes = await Api.get(`/api/projects/${id}/wishes`);
    Projects.setCollabBadge(wishes.length);
    return wishes;
  }

  async function refresh(force) {
    const id = pid();
    if (!id) return;
    try {
      const [w, p] = await Promise.all([Api.get(`/api/projects/${id}/wishes`), Api.get(`/api/projects/${id}/proposals`)]);
      const sig = JSON.stringify([w, p]);
      if (force || sig !== lastSig) {
        lastSig = sig;
        wishes = w;
        proposals = p;
        renderWishes();
        renderProposals();
        renderPhase();
      }
      Projects.setCollabBadge(w.length);
    } catch (e) {
      console.error(e);
    }
  }

  // ---------- 進行フェーズ ----------
  function renderPhase() {
    const st = status();
    const steps = $("phase-steps");
    if (steps) {
      const order = ["collecting", "proposals", "voting", "decided"];
      let reached = st === "collecting" ? (proposals.length ? 1 : 0) : st === "voting" ? 2 : 3;
      if (st === "done") reached = 3;
      steps.querySelectorAll("li").forEach((li) => {
        const i = order.indexOf(li.dataset.phase);
        li.classList.toggle("done", i < reached);
        li.classList.toggle("current", i === reached);
      });
    }
    const box = $("phase-actions");
    if (!box) return;
    box.innerHTML = "";
    const add = (label, cls, fn, icon, disabled) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn " + cls;
      b.innerHTML = (icon ? `<span class="material-symbols-outlined">${icon}</span>` : "") + esc(label);
      b.disabled = !!disabled;
      b.onclick = fn;
      box.appendChild(b);
      return b;
    };
    if (st === "collecting") {
      add("投票を開始する", "btn-filled", () => changeStatus("voting"), "how_to_vote", proposals.length === 0);
      if (proposals.length === 0) {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = "絵馬が集まったら「AIで旅程案をつくる」→ 投票を開始できます。";
        box.appendChild(p);
      }
    } else if (st === "voting") {
      add("投票を締め切って1位を採用", "btn-filled", adoptTop, "verified", proposals.length === 0);
      add("絵馬あつめに戻す", "btn-outline", () => changeStatus("collecting"), "undo");
    } else if (st === "decided") {
      add("日程を見る", "btn-filled", () => Projects.switchMode("plan"), "calendar_month");
      add("投票をやり直す", "btn-outline", () => changeStatus("voting"), "restart_alt");
    } else {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "この旅は完了しています。行った場所は「行った場所」タブに記録されています。";
      box.appendChild(p);
    }
  }

  async function changeStatus(st) {
    try {
      await Projects.setStatus(st);
      renderPhase();
      renderProposals();
      const msg = { collecting: "絵馬あつめに戻しました", voting: "投票を開始しました。共有リンクを開くと投票できます", decided: "決定しました" }[st];
      if (msg) toast(msg);
    } catch (e) {
      toast("変更に失敗しました：" + e.message);
    }
  }

  // ---------- 絵馬（要望） ----------
  // 触れたら1回だけ揺れる。終わるまで続けてから外す（途中で外すと元の角度へ跳ぶため）
  function attachSwing(el) {
    el.addEventListener("mouseenter", () => el.classList.add("is-swinging"));
    el.addEventListener("animationend", (e) => { if (e.animationName === "ema-swing-once") el.classList.remove("is-swinging"); });
  }
  function renderWishes() {
    const count = $("wish-count");
    if (count) count.textContent = String(wishes.length);
    const tally = $("wish-tally");
    if (tally) {
      const vibes = {};
      const trans = {};
      wishes.forEach((w) => {
        (w.vibes || []).forEach((v) => { vibes[v] = (vibes[v] || 0) + 1; });
        if (w.transport) trans[w.transport] = (trans[w.transport] || 0) + 1;
      });
      const top = Object.entries(vibes).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const topT = Object.entries(trans).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const max = top.length ? top[0][1] : 1;
      tally.innerHTML = wishes.length === 0 ? "" :
        '<div class="tally-group"><span class="tally-label">雰囲気</span>'
        + top.map(([k, n]) => `<span class="tally-chip" style="--w:${Math.round((n / max) * 100)}%"><i></i><span>${esc(k)}</span><b>${n}</b></span>`).join("")
        + "</div>"
        + (topT.length ? '<div class="tally-group"><span class="tally-label">移動</span>'
          + topT.map(([k, n]) => `<span class="tally-chip tally-chip-flat"><span>${esc(k)}</span><b>${n}</b></span>`).join("") + "</div>" : "");
    }
    const board = $("wish-board");
    if (!board) return;
    board.innerHTML = "";
    if (wishes.length === 0) {
      board.innerHTML = '<div class="ema-empty"><span class="material-symbols-outlined">forum</span>まだ絵馬はありません。共有リンクかQRを送って、みんなの「行きたい」を集めましょう。</div>';
      return;
    }
    wishes.forEach((w, i) => board.appendChild(buildEma(w, i)));
  }

  function buildEma(w, i) {
    // 枠（掛け棒の区間）＞吊り具（紐・傾き・揺れ）＞絵馬本体
    const slot = document.createElement("div");
    slot.className = "ema-slot";
    const hang = document.createElement("div");
    hang.className = "ema-hang";
    slot.appendChild(hang);
    hang.style.setProperty("--tilt", `${((i % 5) - 2) * 1.2}deg`);
    hang.style.animationDelay = `${Math.min(i, 10) * 50}ms`;
    const cord = document.createElement("i");
    cord.className = "ema-cord";
    hang.appendChild(cord);
    attachSwing(hang);
    const card = document.createElement("article");
    card.className = "ema";
    hang.appendChild(card);
    const rows = [];
    if (w.places) rows.push(["place", "行きたい", w.places]);
    if (w.foods) rows.push(["restaurant", "食べたい", w.foods]);
    if (w.must) rows.push(["priority_high", "これだけは", w.must]);
    if (w.avoid) rows.push(["block", "避けたい", w.avoid]);
    if (w.freeText) rows.push(["chat_bubble", "", w.freeText]);
    card.innerHTML = `
      <div class="ema-head">
        <span class="ema-name">${esc(w.nickname || "匿名さん")}</span>
        <button type="button" class="icon-btn ema-del" title="この絵馬を外す" aria-label="この絵馬を外す"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="ema-chips">${(w.vibes || []).map((v) => `<span class="ema-chip">${esc(v)}</span>`).join("")}
        ${w.transport ? `<span class="ema-chip ema-chip-sub"><span class="material-symbols-outlined">commute</span>${esc(w.transport)}</span>` : ""}
        ${w.budget ? `<span class="ema-chip ema-chip-sub"><span class="material-symbols-outlined">payments</span>${esc(w.budget)}</span>` : ""}
      </div>
      <dl class="ema-rows">${rows.map(([ic, k, v]) => `<div class="ema-row"><dt><span class="material-symbols-outlined">${ic}</span>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
    card.querySelector(".ema-del").onclick = async () => {
      if (!confirm(`「${w.nickname || "匿名さん"}」の絵馬を外しますか？`)) return;
      try {
        await Api.del(`/api/projects/${pid()}/wishes/${w.id}`);
        await refresh(true);
      } catch (e) { toast("削除に失敗しました：" + e.message); }
    };
    return slot;
  }

  // ---------- 希望フォーム（主催者用。参加者ページと同じ項目） ----------
  // form 要素の中身を組み立てる。opts.submitLabel を渡すと送信ボタンを付ける（ウィザードでは付けない）
  function buildWishForm(form, opts) {
    opts = opts || {};
    form.innerHTML = `
      <label class="field"><span>名前（ニックネーム）</span><input type="text" name="nickname" maxlength="40" placeholder="例：さとう"></label>
      <div class="field"><span>雰囲気<small>いくつでも</small></span><div class="chip-set" data-multi="1">${VIBES.map((v) => `<button type="button" class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div></div>
      <div class="field"><span>移動手段</span><div class="chip-set" data-name="transport">${TRANSPORTS.map((v) => `<button type="button" class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div></div>
      <div class="field"><span>予算<small>1人・交通費込みの目安</small></span><div class="chip-set" data-name="budget">${BUDGETS.map((v) => `<button type="button" class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div></div>
      <label class="field"><span>行きたいところ</span><textarea name="places" rows="2" maxlength="400" placeholder="例：伏見稲荷、夜は鴨川を歩きたい"></textarea></label>
      <label class="field"><span>食べたいもの</span><input type="text" name="foods" maxlength="400" placeholder="例：抹茶パフェ、湯豆腐"></label>
      <label class="field"><span>これだけは外せない</span><input type="text" name="must" maxlength="400"></label>
      <label class="field"><span>苦手・避けたい</span><input type="text" name="avoid" maxlength="400" placeholder="例：人混み、長い階段"></label>
      <label class="field"><span>ひとこと</span><textarea name="freeText" rows="2" maxlength="800"></textarea></label>
      ${opts.submitLabel ? `<div class="form-actions"><button type="submit" class="btn btn-filled"><span class="material-symbols-outlined">send</span>${esc(opts.submitLabel)}</button></div>` : ""}`;
    form.querySelectorAll(".chip-set").forEach((set) => {
      const multi = set.dataset.multi === "1";
      set.querySelectorAll(".chip").forEach((chip) => {
        chip.onclick = () => {
          if (!multi) set.querySelectorAll(".chip").forEach((c) => { if (c !== chip) c.classList.remove("active"); });
          chip.classList.toggle("active");
        };
      });
    });
  }

  // フォームの内容を API の形に。何も入っていなければ null
  function readWishForm(form) {
    const fd = new FormData(form);
    const pick = (sel) => Array.from(form.querySelectorAll(sel + " .chip.active")).map((c) => c.dataset.v);
    const v = (k) => String(fd.get(k) || "").trim();
    const body = {
      nickname: v("nickname"), vibes: pick('[data-multi="1"]'),
      transport: pick('[data-name="transport"]')[0] || "", budget: pick('[data-name="budget"]')[0] || "",
      places: v("places"), foods: v("foods"), must: v("must"), avoid: v("avoid"), freeText: v("freeText")
    };
    if (!body.vibes.length && !body.places && !body.foods && !body.must && !body.freeText) return null;
    return body;
  }

  function resetWishForm(form) {
    form.reset();
    form.querySelectorAll(".chip.active").forEach((c) => c.classList.remove("active"));
  }

  // ---------- 旅程案の生成 ----------
  // AI／ルールベースに渡す候補地：候補リスト＋人気スポット＋以前行った場所
  function candidatePool() {
    const pool = [];
    const seen = new Set();
    const push = (c) => { const k = (c.name || "").trim(); if (!k || seen.has(k)) return; seen.add(k); pool.push(c); };
    if (typeof spotsForRegion === "function") {
      spotsForRegion().forEach((s) => push({
        id: s.id, name: s.name, category: s.category, lat: s.lat, lng: s.lng, stayMin: s.stayMin, cost: s.cost,
        desc: s.desc || "", source: s.isCustom ? "custom" : "sample", placeId: s.placeId || null
      }));
    }
    if (typeof popularResults !== "undefined" && Array.isArray(popularResults)) {
      popularResults.forEach((r) => push({
        id: null, placeId: r.placeId || null, name: r.name, category: typeof guessCategory === "function" ? guessCategory(r.types) : "sightseeing",
        lat: r.lat, lng: r.lng, stayMin: 60, cost: 0, desc: r.address || "", rating: r.rating || null, source: "popular"
      }));
    }
    if (typeof History !== "undefined" && History.placesForRegion) {
      History.placesForRegion(state.region).forEach((h) => push({
        id: null, placeId: h.placeId || null, name: h.name, category: h.category === "food" ? "food" : "sightseeing",
        lat: h.lat, lng: h.lng, stayMin: h.stayMin || 60, cost: h.cost || 0, desc: h.memo || h.address || "",
        rating: h.rating || null, source: "history", historyId: h.id
      }));
    }
    return pool.filter((c) => c.category !== "hotel");
  }

  // Googleモードで人気スポットがまだ無ければ取りに行く（任意行き先でも候補地を用意する）
  async function ensureCandidates() {
    if (typeof isGoogleMode === "function" && isGoogleMode() && typeof refreshPopularSpots === "function"
        && typeof popularResults !== "undefined" && (!popularResults || popularResults.length === 0)) {
      try { await refreshPopularSpots(true); } catch (e) { /* 取れなくても候補リストだけで進む */ }
    }
    return candidatePool();
  }

  // 案を生成して保存する。{ proposals, source, note } を返す（失敗は throw）
  async function generateProposals() {
    const id = pid();
    if (!id) throw new Error("旅が開かれていません");
    if (generating) throw new Error("生成中です");
    generating = true;
    try {
      const pool = await ensureCandidates();
      const r = await Api.post(`/api/projects/${id}/proposals/generate`, { candidates: pool, count: 3 });
      lastCandidatePool = pool;
      proposals = r.proposals;
      lastSig = "";
      return r;
    } finally {
      generating = false;
    }
  }

  function sourceNote(r) {
    if (r.note) return r.note;
    return r.source === "claude"
      ? "Claude が絵馬と候補地から3案をつくりました。"
      : "簡易生成（ANTHROPIC_API_KEY 未設定）で3案をつくりました。絵馬の「行きたい」と雰囲気チップを候補リストに当てはめています。";
  }

  async function generateForTab() {
    const btn = $("generate-btn");
    const note = $("proposal-note");
    if (btn) { btn.disabled = true; btn.classList.add("busy"); }
    const info = Api.info();
    if (note) note.textContent = info && info.ai ? "Claude が絵馬を読んで案を考えています（1分ほどかかることがあります）…" : "絵馬のキーワードから案を組み立てています…";
    try {
      const r = await generateProposals();
      renderProposals();
      renderPhase();
      if (note) note.textContent = sourceNote(r);
      toast("旅程案ができました");
    } catch (e) {
      if (note) note.textContent = "";
      toast("案の生成に失敗しました：" + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("busy"); }
    }
  }

  // ---------- 旅程案カード（タブとウィザードで共用） ----------
  // opts: { status, onAdopt(p), onVote(p), adoptLabel, emptyText }
  function renderProposalCards(container, props, opts) {
    opts = opts || {};
    container.innerHTML = "";
    if (!props || props.length === 0) {
      container.innerHTML = `<div class="proposal-empty"><span class="material-symbols-outlined">auto_awesome</span>${esc(opts.emptyText || "絵馬と候補リストから、性格の違う3案をつくります。")}</div>`;
      return;
    }
    const st = opts.status || "collecting";
    const maxVotes = Math.max(...props.map((p) => p.votes || 0), 0);
    props.forEach((p, i) => {
      const card = document.createElement("article");
      card.className = "proposal" + (maxVotes > 0 && p.votes === maxVotes ? " leading" : "");
      card.style.animationDelay = `${i * 80}ms`;
      const daysHtml = (p.days || []).map((d, di) => `
        <div class="proposal-day">
          <div class="proposal-day-title">${esc(d.title || `${di + 1}日目`)}</div>
          <ol class="proposal-spots">${(d.spots || []).map((s) => `
            <li class="${s.category === "food" ? "is-food" : ""}">
              <span class="proposal-spot-name">${esc(s.name)}</span>
              <span class="proposal-spot-meta">${esc(s.category === "food" ? "グルメ" : "観光")}・${Number(s.stayMin) || 60}分${s.fromCandidates ? "" : ' <span class="proposal-new">新規</span>'}</span>
              ${s.note ? `<span class="proposal-spot-note">${esc(s.note)}</span>` : ""}
            </li>`).join("")}</ol>
        </div>`).join("");
      const stamps = (p.voters || []).slice(0, 8).map((v) => `<span class="stamp" title="${esc(v.nickname || "匿名")}${v.comment ? "：" + esc(v.comment) : ""}">推</span>`).join("")
        + ((p.voters || []).length > 8 ? `<span class="stamp-more">+${p.voters.length - 8}</span>` : "");
      card.innerHTML = `
        <header class="proposal-head">
          <span class="proposal-index">${"ABCD"[i] || i + 1}</span>
          <div class="proposal-titles">
            <h3 class="proposal-title">${esc(p.title)}</h3>
            <p class="proposal-concept">${esc(p.concept)}</p>
          </div>
          <span class="proposal-source">${p.source === "claude" ? "Claude" : "簡易"}</span>
        </header>
        ${(p.matched || []).length ? `<ul class="proposal-matched">${p.matched.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
        <div class="proposal-days">${daysHtml}</div>
        ${opts.hideVotes ? "" : `<footer class="proposal-foot">
          <div class="stamp-row" aria-label="${p.votes || 0}票">${stamps || '<span class="stamp-none">まだ票がありません</span>'}</div>
          <div class="proposal-votes"><b>${p.votes || 0}</b><span>票</span></div>
        </footer>`}
        <div class="proposal-actions">
          ${opts.onVote && st === "voting" ? '<button type="button" class="btn btn-stamp" data-act="vote"><span class="material-symbols-outlined">approval</span>この案に一票</button>' : ""}
          ${opts.onAdopt && st !== "done" ? `<button type="button" class="btn ${opts.adoptFilled ? "btn-filled" : "btn-outline"}" data-act="adopt"><span class="material-symbols-outlined">route</span>${esc(opts.adoptLabel || "この案を日程にする")}</button>` : ""}
        </div>`;
      const voteBtn = card.querySelector('[data-act="vote"]');
      if (voteBtn) voteBtn.onclick = () => opts.onVote(p);
      const adoptBtn = card.querySelector('[data-act="adopt"]');
      if (adoptBtn) adoptBtn.onclick = () => opts.onAdopt(p);
      container.appendChild(card);
    });
  }

  function renderProposals() {
    const grid = $("proposal-grid");
    if (!grid) return;
    renderProposalCards(grid, proposals, { status: status(), onAdopt: adopt, onVote: vote });
  }

  async function vote(p) {
    try {
      proposals = await Api.post(`/api/projects/${pid()}/vote`, { proposalId: p.id, voterId: voterId(), nickname: "主催者" });
      lastSig = "";
      renderProposals();
      toast(`「${p.title}」に一票入れました`);
    } catch (e) { toast("投票に失敗しました：" + e.message); }
  }

  async function adoptTop() {
    if (proposals.length === 0) return;
    const top = proposals.slice().sort((a, b) => (b.votes || 0) - (a.votes || 0))[0];
    await adopt(top);
  }

  // ---------- 採用：案を日程（state.days）に流し込む ----------
  async function adopt(p) {
    if (typeof planHasContent === "function" && planHasContent()) {
      if (!confirm(`「${p.title}」を日程にします。いまの日程の中身は置き換わります（宿・交通は残ります）。よろしいですか？`)) return false;
    }
    const pool = lastCandidatePool || candidatePool();
    const missing = [];
    const days = p.days || [];
    while (state.days.length < days.length && state.days.length < 16) state.days.push(newDay());
    for (let di = 0; di < state.days.length; di++) {
      const src = days[di];
      const items = [];
      if (src) {
        for (const s of src.spots || []) {
          const spotId = await resolveSpot(s, pool, missing);
          if (!spotId) continue;
          if (items.some((it) => it.spotId === spotId)) continue;
          const base = findSpot(spotId);
          items.push({ spotId, stayMin: Number(s.stayMin) || (base ? base.stayMin : 60), cost: base ? base.cost : 0, travelMin: 0 });
        }
      }
      state.days[di].items = items;
    }
    state.activeDay = 0;
    saveState();
    if (typeof ensureSegmentTravels === "function") ensureSegmentTravels();
    renderAll();
    try { await Projects.setStatus("decided"); } catch (e) { console.error(e); }
    renderPhase();
    renderProposals();
    Projects.switchMode("plan");
    toast(missing.length ? `日程に反映しました（位置が分からず入れられなかった場所：${missing.join("、")}）` : `「${p.title}」を日程に反映しました`);
    return true;
  }

  // 案のスポット名 → state 上の spotId。候補になければ自作スポットとして追加（座標は案のもの／Google検索）
  async function resolveSpot(s, pool, missing) {
    const name = (s.name || "").trim();
    if (!name) return null;
    const norm = (x) => x.replace(/\s+/g, "");
    const hit = pool.find((c) => norm(c.name) === norm(name)) || pool.find((c) => norm(c.name).includes(norm(name)) || norm(name).includes(norm(c.name)));
    if (hit && hit.id) return hit.id;
    const existing = state.customSpots.find((c) => norm(c.name) === norm(name) && c.region === state.region);
    if (existing) return existing.id;
    let lat = hit ? hit.lat : s.lat;
    let lng = hit ? hit.lng : s.lng;
    let placeId = hit ? hit.placeId : null;
    let desc = hit ? hit.desc : (s.note || "");
    if ((lat == null || lng == null) && typeof isGoogleMode === "function" && isGoogleMode()) {
      try {
        const results = await TravelMap.searchPlaces(`${name} ${state.region}`, { basic: true });
        if (results && results[0]) {
          lat = results[0].lat; lng = results[0].lng; placeId = results[0].placeId || null; desc = results[0].address || desc;
        }
      } catch (e) { /* 見つからなければ下で skip */ }
    }
    if (lat == null || lng == null) { missing.push(name); return null; }
    const id = "g-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    state.customSpots.push({
      id, placeId, name, category: s.category === "food" ? "food" : (hit ? hit.category : "sightseeing"),
      desc: desc || "", lat, lng, stayMin: Number(s.stayMin) || (hit ? hit.stayMin : 60), cost: hit ? (hit.cost || 0) : 0,
      region: state.region, isCustom: true, source: placeId ? "google" : "proposal"
    });
    return id;
  }

  return {
    show, hide, onProjectChanged, refresh, candidatePool,
    // ウィザードから使う部品
    ensureShare, copyShareUrl, fetchWishes, buildWishForm, readWishForm, resetWishForm,
    generateProposals, sourceNote, renderProposalCards, adopt,
    proposals: () => proposals
  };
})();
