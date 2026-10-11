// ============================================================
// 参加者ページ（/s/{token}）：登録なし・匿名で要望を送る／旅程案に投票する
// 主催者のアプリとは別の軽いページ。サーバーAPI（/api/s/…）だけを使う
// ============================================================
(() => {
  const VIBES = ["グルメ", "絶景・自然", "歴史・文化", "のんびり", "アクティブ", "ショッピング", "温泉", "夜景・夜遊び", "写真映え", "子連れ・家族"];
  const TRANSPORTS = ["電車・バス", "車・レンタカー", "徒歩中心", "自転車", "おまかせ"];
  const BUDGETS = ["〜1万円", "1〜3万円", "3〜5万円", "5万円〜", "こだわらない"];
  const STATUS_LABEL = { collecting: "絵馬あつめ中", voting: "投票中", decided: "行き先決定", done: "旅おわり" };

  const token = (location.pathname.match(/\/s\/([^/?#]+)/) || [])[1] || new URLSearchParams(location.search).get("t") || "";
  const root = document.getElementById("app");
  let info = null;
  let pollTimer = null;
  let sent = 0;
  let lastNickname = "";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function voterId() {
    let v = localStorage.getItem("tp-voter-id");
    if (!v) { v = "v-" + Math.random().toString(36).slice(2, 12); localStorage.setItem("tp-voter-id", v); }
    return v;
  }

  async function api(method, path, body) {
    const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j.detail) msg = j.detail; } catch (e) { /* noop */ }
      throw new Error(msg);
    }
    return res.json();
  }

  function dateRange(p) {
    if (!p.startDate) return "日程はこれから";
    const n = Number(p.numDays) || 1;
    const start = new Date(p.startDate + "T00:00:00");
    if (isNaN(start)) return "";
    const end = new Date(start);
    end.setDate(end.getDate() + n - 1);
    const f = (d) => `${d.getMonth() + 1}/${d.getDate()}（${"日月火水木金土"[d.getDay()]}）`;
    return n === 1 ? `${f(start)} 日帰り` : `${f(start)} 〜 ${f(end)}・${n}日間`;
  }

  async function load() {
    if (!token) { renderError("共有リンクが正しくありません"); return; }
    try {
      info = await api("GET", `/api/s/${encodeURIComponent(token)}?voter=${encodeURIComponent(voterId())}`);
      render();
    } catch (e) {
      renderError(e.message === "HTTP 404" ? "この共有リンクは無効か、旅が削除されています" : "読み込みに失敗しました：" + e.message);
    }
  }

  function renderError(msg) {
    root.innerHTML = `<div class="sh-card sh-error"><span class="material-symbols-outlined">link_off</span><p>${esc(msg)}</p></div>`;
  }

  function header() {
    return `
      <header class="sh-head">
        <div class="sh-brand"><img class="brand-mark" src="/assets/icon-192.png" alt="" aria-hidden="true">たびえま</div>
        <h1 class="sh-title">${esc(info.name)}</h1>
        <p class="sh-sub">${esc(info.region || "行き先はこれから")}　${esc(dateRange(info))}</p>
        <span class="status-stamp" data-status="${esc(info.status)}">${esc(STATUS_LABEL[info.status] || info.status)}</span>
        <div class="sh-rack" aria-hidden="true">
          <span class="ema-hang-mini"><i class="ema-cord"></i><span class="ema-mini">行きたい</span></span>
          <span class="ema-hang-mini"><i class="ema-cord"></i><span class="ema-mini">食べたい</span></span>
          <span class="ema-hang-mini"><i class="ema-cord"></i><span class="ema-mini">のんびり</span></span>
        </div>
      </header>`;
  }

  function render() {
    clearInterval(pollTimer);
    if (info.status === "collecting") renderWishForm();
    else if (info.status === "voting") { renderVoting(); pollTimer = setInterval(refreshVotes, 10000); }
    else renderDecided();
  }

  // ---------- 要望フォーム ----------
  function renderWishForm() {
    const tally = tallyHtml();
    root.innerHTML = header() + `
      <section class="sh-card ema-write">
        <h2 class="sh-h2">絵馬を掛けてください</h2>
        <p class="sh-lead">ざっくりで大丈夫。みんなの「行きたい」からAIが旅程案をつくります。${info.wishCount ? `いま <b>${info.wishCount}枚</b> の絵馬が集まっています。` : ""}</p>
        <form id="wish-form" class="sh-form">
          <label class="field"><span>名前（ニックネーム）</span><input type="text" name="nickname" maxlength="40" placeholder="例：さとう" value="${esc(lastNickname)}"></label>
          <div class="field"><span>どんな雰囲気がいい？<small>いくつでも</small></span><div class="chip-set" data-multi="1">${VIBES.map((v) => `<button type="button" class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div></div>
          <div class="field"><span>移動手段</span><div class="chip-set" data-name="transport">${TRANSPORTS.map((v) => `<button type="button" class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div></div>
          <div class="field"><span>予算の目安<small>1人・交通費込み</small></span><div class="chip-set" data-name="budget">${BUDGETS.map((v) => `<button type="button" class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join("")}</div></div>
          <label class="field"><span>行きたいところ</span><textarea name="places" rows="2" maxlength="400" placeholder="例：伏見稲荷、夜は鴨川を歩きたい"></textarea></label>
          <label class="field"><span>食べたいもの</span><input type="text" name="foods" maxlength="400" placeholder="例：抹茶パフェ、湯豆腐"></label>
          <label class="field"><span>これだけは外せない</span><input type="text" name="must" maxlength="400" placeholder="例：温泉には入りたい"></label>
          <label class="field"><span>苦手・避けたい</span><input type="text" name="avoid" maxlength="400" placeholder="例：人混み、長い階段、生もの"></label>
          <label class="field"><span>ひとこと（自由に）</span><textarea name="freeText" rows="2" maxlength="800"></textarea></label>
          <button type="submit" class="btn btn-filled btn-lg"><span class="material-symbols-outlined">send</span>絵馬を掛ける</button>
        </form>
      </section>
      ${tally}`;
    const form = document.getElementById("wish-form");
    form.querySelectorAll(".chip-set").forEach((set) => {
      const multi = set.dataset.multi === "1";
      set.querySelectorAll(".chip").forEach((chip) => {
        chip.onclick = () => {
          if (!multi) set.querySelectorAll(".chip").forEach((c) => { if (c !== chip) c.classList.remove("active"); });
          chip.classList.toggle("active");
        };
      });
    });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const pick = (sel) => Array.from(form.querySelectorAll(sel + " .chip.active")).map((c) => c.dataset.v);
      const body = {
        nickname: fd.get("nickname") || "", vibes: pick('[data-multi="1"]'),
        transport: pick('[data-name="transport"]')[0] || "", budget: pick('[data-name="budget"]')[0] || "",
        places: fd.get("places") || "", foods: fd.get("foods") || "", must: fd.get("must") || "", avoid: fd.get("avoid") || "", freeText: fd.get("freeText") || ""
      };
      if (!body.vibes.length && !body.places.trim() && !body.foods.trim() && !body.must.trim() && !body.freeText.trim()) {
        flash("雰囲気か、行きたいところ・食べたいものをひとつは入れてください");
        return;
      }
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const r = await api("POST", `/api/s/${encodeURIComponent(token)}/wishes`, body);
        lastNickname = body.nickname;
        sent++;
        renderThanks(r.wishCount);
      } catch (err) {
        btn.disabled = false;
        flash("送信に失敗しました：" + err.message);
      }
    };
  }

  function renderThanks(count) {
    root.innerHTML = header() + `
      <section class="sh-card sh-thanks">
        <div class="stamp stamp-big stamp-pop" aria-hidden="true">受</div>
        <h2 class="sh-h2">絵馬を掛けました</h2>
        <p class="sh-lead">ありがとうございます。いま <b>${Number(count) || 0}枚</b> の絵馬が集まっています。<br>旅程案ができたら、このリンクから投票できます。</p>
        <div class="sh-actions">
          <button type="button" class="btn btn-outline" id="again"><span class="material-symbols-outlined">add</span>もう1件書く</button>
          <button type="button" class="btn btn-text" id="reload"><span class="material-symbols-outlined">refresh</span>状況を見る</button>
        </div>
      </section>`;
    document.getElementById("again").onclick = () => load().then(() => { if (info.status === "collecting") renderWishForm(); });
    document.getElementById("reload").onclick = load;
  }

  function tallyHtml() {
    const vibes = Object.entries(info.vibeTally || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (vibes.length === 0) return "";
    const max = vibes[0][1];
    return `<section class="sh-card sh-tally">
      <h2 class="sh-h2 sh-h2-sm">いまの空気感</h2>
      <div class="tally-list">${vibes.map(([k, n]) => `<div class="tally-row"><span>${esc(k)}</span><i style="--w:${Math.round((n / max) * 100)}%"></i><b>${n}</b></div>`).join("")}</div>
    </section>`;
  }

  // ---------- 投票 ----------
  function proposalCard(p, i, mine, canVote) {
    const stamps = (p.voters || []).slice(0, 10).map((v) => `<span class="stamp" title="${esc(v.nickname || "匿名")}">推</span>`).join("")
      + ((p.voters || []).length > 10 ? `<span class="stamp-more">+${p.voters.length - 10}</span>` : "");
    return `
      <article class="proposal ${mine ? "mine" : ""}" data-id="${esc(p.id)}">
        <header class="proposal-head">
          <span class="proposal-index">${"ABCD"[i] || i + 1}</span>
          <div class="proposal-titles"><h3 class="proposal-title">${esc(p.title)}</h3><p class="proposal-concept">${esc(p.concept)}</p></div>
        </header>
        ${(p.matched || []).length ? `<ul class="proposal-matched">${p.matched.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
        <div class="proposal-days">${(p.days || []).map((d, di) => `
          <div class="proposal-day"><div class="proposal-day-title">${esc(d.title || `${di + 1}日目`)}</div>
          <ol class="proposal-spots">${(d.spots || []).map((s) => `<li class="${s.category === "food" ? "is-food" : ""}"><span class="proposal-spot-name">${esc(s.name)}</span><span class="proposal-spot-meta">${s.category === "food" ? "グルメ" : "観光"}・${Number(s.stayMin) || 60}分</span>${s.note ? `<span class="proposal-spot-note">${esc(s.note)}</span>` : ""}</li>`).join("")}</ol></div>`).join("")}</div>
        <footer class="proposal-foot">
          <div class="stamp-row">${stamps || '<span class="stamp-none">まだ票がありません</span>'}</div>
          <div class="proposal-votes"><b>${p.votes || 0}</b><span>票</span></div>
        </footer>
        ${canVote ? `<div class="proposal-actions"><button type="button" class="btn ${mine ? "btn-filled" : "btn-stamp"}" data-vote="${esc(p.id)}"><span class="material-symbols-outlined">${mine ? "check" : "approval"}</span>${mine ? "この案に投票中" : "この案に一票"}</button></div>` : ""}
      </article>`;
  }

  function renderVoting() {
    const props = info.proposals || [];
    root.innerHTML = header() + `
      <section class="sh-card">
        <h2 class="sh-h2">どの案がいい？</h2>
        <p class="sh-lead">みんなの要望から作った${props.length}案です。1人1票、あとから変えられます。</p>
        <label class="field sh-nick"><span>名前（任意・スタンプに表示）</span><input type="text" id="vote-nick" maxlength="40" value="${esc(lastNickname || localStorage.getItem("tp-nick") || "")}" placeholder="例：さとう"></label>
      </section>
      <div class="proposal-grid">${props.map((p, i) => proposalCard(p, i, info.myVote === p.id, true)).join("")}</div>
      <p class="sh-foot">絵馬を追加したいときは主催者に伝えてください（募集は終了しています）。</p>`;
    root.querySelectorAll("[data-vote]").forEach((btn) => {
      btn.onclick = async () => {
        const nick = (document.getElementById("vote-nick").value || "").trim();
        localStorage.setItem("tp-nick", nick);
        btn.disabled = true;
        try {
          const r = await api("POST", `/api/s/${encodeURIComponent(token)}/vote`, { proposalId: btn.dataset.vote, voterId: voterId(), nickname: nick });
          info.proposals = r.proposals;
          info.myVote = r.myVote;
          renderVoting();
          const card = root.querySelector(`.proposal[data-id="${CSS.escape(r.myVote)}"]`);
          if (card) { card.classList.add("stamped"); card.scrollIntoView({ behavior: "smooth", block: "center" }); }
        } catch (e) {
          btn.disabled = false;
          flash("投票に失敗しました：" + e.message);
        }
      };
    });
  }

  async function refreshVotes() {
    try {
      const fresh = await api("GET", `/api/s/${encodeURIComponent(token)}?voter=${encodeURIComponent(voterId())}`);
      if (fresh.status !== info.status) { info = fresh; render(); return; }
      const changed = JSON.stringify(fresh.proposals) !== JSON.stringify(info.proposals);
      info = fresh;
      if (changed && !document.activeElement?.matches?.("input")) renderVoting();
    } catch (e) { /* 次回に */ }
  }

  // ---------- 決定 ----------
  function renderDecided() {
    const props = (info.proposals || []).slice().sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const top = props[0];
    root.innerHTML = header() + `
      <section class="sh-card sh-decided">
        <div class="stamp stamp-big" aria-hidden="true">決</div>
        <h2 class="sh-h2">${info.status === "done" ? "この旅はおわりました" : "行き先が決まりました"}</h2>
        <p class="sh-lead">${top ? `いちばん票を集めたのは「<b>${esc(top.title)}</b>」（${top.votes || 0}票）。主催者が日程を仕上げています。` : "主催者が日程を仕上げています。"}</p>
      </section>
      ${top ? `<div class="proposal-grid">${props.map((p, i) => proposalCard(p, i, info.myVote === p.id, false)).join("")}</div>` : ""}`;
  }

  function flash(msg) {
    let el = document.getElementById("sh-flash");
    if (!el) { el = document.createElement("div"); el.id = "sh-flash"; el.className = "snackbar"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 3000);
  }

  load();
})();
