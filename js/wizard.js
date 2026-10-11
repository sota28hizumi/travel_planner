// ============================================================
// 新しい旅のウィザード（行き先を選んだあとの流れ）
//   1 行き先（ホーム画面）→ 2 いつ行く（カレンダーで開始〜終了）→ 3 みんなの希望（自分の絵馬＋共有QR）
//   → 4 AIの旅程案から1つ選ぶ → 計画画面（地図）へ
// サーバーなし（ローカル保存モード）では 2 のあと計画画面へ進む
// ============================================================
const Wizard = (() => {
  let step = 0;
  let pollTimer = null;
  let wishSent = false;
  let proposals = [];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return typeof escapeHtml === "function" ? escapeHtml(s) : String(s == null ? "" : s); }
  function toast(msg, action) { if (typeof showSnackbar === "function") showSnackbar(msg, action); }
  function serverMode() { return typeof Projects !== "undefined" && Projects.isServerMode() && !!Projects.current(); }

  function open(n) {
    const el = $("wizard-screen");
    if (!el) return;
    el.hidden = false;
    if (document.body) document.body.classList.add("wizard-open");
    const closeBtn = $("wizard-close");
    if (closeBtn) closeBtn.onclick = () => finish("あとから「みんなで決める」タブで案を出すこともできます");
    wishSent = false;
    proposals = [];
    render(n || 2);
  }

  function close() {
    const el = $("wizard-screen");
    if (!el || el.hidden) return;
    el.hidden = true;
    if (document.body) document.body.classList.remove("wizard-open");
    clearInterval(pollTimer);
    pollTimer = null;
    if (typeof closeInlineCalendar === "function") closeInlineCalendar();
    step = 0;
  }

  // ウィザードを閉じて計画画面へ
  function finish(msg) {
    close();
    if (typeof Projects !== "undefined") Projects.switchMode("plan");
    if (msg) toast(msg);
  }

  function render(n) {
    step = n;
    clearInterval(pollTimer);
    if (typeof closeInlineCalendar === "function") closeInlineCalendar();
    const steps = $("wizard-steps");
    if (steps) {
      steps.querySelectorAll("li").forEach((li) => {
        const k = Number(li.dataset.step);
        li.classList.toggle("done", k < n);
        li.classList.toggle("current", k === n);
        // ローカル保存モードでは 3・4 は通らない
        li.hidden = !serverMode() && k >= 3;
      });
    }
    const title = $("wizard-title");
    const body = $("wizard-body");
    if (!body) return;
    const region = state.region || "";
    if (n === 2) {
      if (title) title.textContent = `${region}へ、いつ行きますか？`;
      renderDates(body);
    } else if (n === 3) {
      if (title) title.textContent = "みんなの希望を集めましょう";
      renderWishes(body);
    } else {
      if (title) title.textContent = "AIの旅程案から選びましょう";
      renderProposals(body);
    }
    body.scrollTop = 0;
  }

  // ---------- 2 いつ行く（計画画面と同じ範囲カレンダー） ----------
  function renderDates(body) {
    const start = state.startDate || toDateStr(new Date());
    const end = typeof tripEndDate === "function" ? tripEndDate() : start;
    body.innerHTML = `
      <div class="wizard-card wizard-dates-card">
        <p class="wizard-lead">カレンダーで開始日→終了日の順に選んでください（同じ日を2回押すと日帰り、最大${typeof MAX_TRIP_DAYS !== "undefined" ? MAX_TRIP_DAYS : 16}日間）。あとでヘッダーの「開始／終了」からも変えられます。</p>
        <div class="wz-range" role="group" aria-label="選択中の日程">
          <button type="button" class="wz-range-field" data-phase="start"><span class="pill-field-label">開始</span><span class="pill-field-value" id="wz-range-start">–</span></button>
          <span class="wz-range-arrow" aria-hidden="true">→</span>
          <button type="button" class="wz-range-field" data-phase="end"><span class="pill-field-label">終了</span><span class="pill-field-value" id="wz-range-end">–</span></button>
          <span class="wz-range-days" id="wz-range-days" aria-live="polite"></span>
        </div>
        <div class="wz-calendar" id="wz-calendar">
          <button type="button" id="wz-cal-prev" class="drp-nav-btn drp-nav-prev" aria-label="前の月へ"><span class="material-symbols-outlined">chevron_left</span></button>
          <button type="button" id="wz-cal-next" class="drp-nav-btn drp-nav-next" aria-label="次の月へ"><span class="material-symbols-outlined">chevron_right</span></button>
          <div id="wz-cal-months" class="drp-months"></div>
          <p id="wz-cal-hint" class="drp-hint" aria-live="polite"></p>
        </div>
      </div>
      <div class="wizard-actions">
        <button type="button" class="btn btn-text" id="wz-back">行き先を選び直す</button>
        <button type="button" class="btn btn-filled btn-lg" id="wz-next">${serverMode() ? "次へ：みんなの希望を聞く" : "計画をはじめる"}<span class="material-symbols-outlined">arrow_forward</span></button>
      </div>`;
    // 選択状態の表示（開始／終了フィールド・日数・次へボタン）
    const update = (s, e) => {
      $("wz-range-start").textContent = s ? fmtFieldDate(s) : "–";
      $("wz-range-end").textContent = e ? fmtFieldDate(e) : "–";
      const n = s && e ? rangeDayCount(s, e) : null;
      $("wz-range-days").textContent = n ? (n === 1 ? "日帰り" : `${n}日間`) : "終了日を選んでください";
      $("wz-next").disabled = !n;
      const phase = typeof inlineCalendarPhase === "function" ? inlineCalendarPhase() : "start";
      body.querySelectorAll(".wz-range-field").forEach((b) => b.classList.toggle("active", b.dataset.phase === phase));
    };
    openInlineCalendar({ root: $("wz-calendar"), months: $("wz-cal-months"), hint: $("wz-cal-hint") }, { start, end, onChange: update });
    update(start, end);
    $("wz-cal-prev").onclick = () => inlineCalendarNav(-1);
    $("wz-cal-next").onclick = () => inlineCalendarNav(1);
    body.querySelectorAll(".wz-range-field").forEach((b) => {
      b.onclick = () => {
        setInlineCalendarPhase(b.dataset.phase);
        const r = inlineCalendarRange();
        if (r) update(r.start, r.end);
      };
    });
    $("wz-back").onclick = () => { close(); openHero(serverMode() ? "home" : "restart"); };
    $("wz-next").onclick = () => {
      const r = inlineCalendarRange();
      const n = r && r.start && r.end ? rangeDayCount(r.start, r.end) : null;
      if (!n) { toast("終了日を選んでください"); return; }
      closeInlineCalendar();
      applyDateRange(r.start, n); // 保存・再描画まで行う
      if (serverMode()) render(3);
      else finish(`${state.region}の計画をはじめましょう。左の候補から「追加」で日程が組めます`);
    };
  }

  // ---------- 3 みんなの希望 ----------
  function renderWishes(body) {
    body.innerHTML = `
      <div class="wizard-grid">
        <section class="wizard-card ema-write">
          <h3 class="wizard-h3"><span class="ema-icon" aria-hidden="true"></span>あなたの絵馬</h3>
          <p class="hint">ざっくりでOK。雰囲気・移動手段・行きたいところ・食べたいもの。仲間の絵馬と合わせてAIが案を出します。</p>
          <form id="wz-wish-form" class="wish-form"></form>
        </section>
        <aside class="wizard-card wizard-share">
          <h3 class="wizard-h3"><span class="material-symbols-outlined">qr_code_2</span>仲間にも聞く</h3>
          <p class="hint">QRかリンクを送ると、登録なし・匿名で絵馬を掛けてもらえます。回答を待たずに次へ進めます。</p>
          <div id="wz-qr" class="share-qr"></div>
          <div class="share-url-row"><input type="text" id="wz-url" readonly aria-label="共有リンク"><button type="button" id="wz-copy" class="btn btn-outline"><span class="material-symbols-outlined">content_copy</span>コピー</button></div>
          <p class="hint" id="wz-share-note"></p>
          <div id="wz-wish-count" class="wz-count" aria-live="polite">まだ絵馬はありません</div>
        </aside>
      </div>
      <div class="wizard-actions">
        <button type="button" class="btn btn-text" id="wz-skip">スキップして自分で組む</button>
        <button type="button" class="btn btn-filled btn-lg" id="wz-next"><span class="material-symbols-outlined">auto_awesome</span>AIに旅程案を出してもらう</button>
      </div>`;
    const form = $("wz-wish-form");
    Collab.buildWishForm(form, {});
    form.onsubmit = (e) => e.preventDefault();
    Collab.ensureShare().then((s) => {
      if (!s) return;
      $("wz-url").value = s.url;
      $("wz-qr").innerHTML = `<img src="${esc(s.qrSrc)}" alt="共有リンクのQRコード">`;
      $("wz-share-note").textContent = s.note;
    }).catch((e) => { $("wz-share-note").textContent = "共有リンクを作れませんでした：" + e.message; });
    $("wz-copy").onclick = () => Collab.copyShareUrl($("wz-url"));
    $("wz-skip").onclick = () => finish("自分で日程を組みます。仲間の絵馬は「みんなで決める」タブに集まります");
    $("wz-next").onclick = async () => {
      const btn = $("wz-next");
      btn.disabled = true;
      try {
        const bodyData = Collab.readWishForm(form);
        if (bodyData && !wishSent) {
          await Api.post(`/api/projects/${Projects.current().id}/wishes`, bodyData);
          wishSent = true;
        }
        render(4);
      } catch (err) {
        toast("絵馬を送れませんでした：" + err.message);
        btn.disabled = false;
      }
    };
    const updateCount = async () => {
      try {
        const w = await Collab.fetchWishes();
        const el = $("wz-wish-count");
        if (!el) return;
        if (w.length === 0) { el.textContent = "まだ絵馬はありません"; return; }
        const names = w.map((x) => x.nickname || "匿名さん");
        el.innerHTML = `<b>${w.length}枚</b>の絵馬が集まっています：${names.map((x) => `<span class="wz-name">${esc(x)}</span>`).join("")}`;
      } catch (e) { /* 次回に */ }
    };
    updateCount();
    pollTimer = setInterval(updateCount, 5000);
  }

  // ---------- 4 旅程案 ----------
  async function renderProposals(body) {
    body.innerHTML = `
      <div class="wizard-card wizard-proposals-card">
        <div id="wz-gen" class="wizard-gen">
          <img class="brand-mark brand-mark-lg wizard-gen-mark" src="assets/icon-192.png" alt="" aria-hidden="true">
          <p id="wz-gen-text"></p>
        </div>
        <p id="wz-note" class="hint" hidden></p>
        <div id="wz-proposals" class="proposal-grid" hidden></div>
      </div>
      <div class="wizard-actions" id="wz-actions" hidden>
        <button type="button" class="btn btn-text" id="wz-self">自分で組む</button>
        <button type="button" class="btn btn-outline" id="wz-regen"><span class="material-symbols-outlined">refresh</span>作り直す</button>
        <button type="button" class="btn btn-stamp" id="wz-vote"><span class="material-symbols-outlined">approval</span>仲間に投票してもらう</button>
      </div>`;
    $("wz-self").onclick = () => finish("自分で日程を組みます。案は「みんなで決める」タブに残っています");
    $("wz-regen").onclick = () => render(4);
    $("wz-vote").onclick = async () => {
      try {
        await Projects.setStatus("voting");
        finish("投票を開始しました。共有リンクから仲間が投票できます。結果は「みんなで決める」タブで見て採用します");
      } catch (e) { toast("投票を開始できませんでした：" + e.message); }
    };
    const info = Api.info();
    $("wz-gen-text").textContent = info && info.ai
      ? "Claude が絵馬を読んで、性格の違う3案を考えています（1分ほどかかることがあります）…"
      : "絵馬のキーワードから3案を組み立てています…";
    try {
      const r = await Collab.generateProposals();
      if (step !== 4) return; // 生成中に画面が変わった
      proposals = r.proposals;
      $("wz-gen").hidden = true;
      const note = $("wz-note");
      note.textContent = Collab.sourceNote(r) + " 1つ選ぶとそのまま日程と地図になります。";
      note.hidden = false;
      const grid = $("wz-proposals");
      grid.hidden = false;
      Collab.renderProposalCards(grid, proposals, {
        status: "collecting", hideVotes: true, adoptFilled: true, adoptLabel: "この案にする",
        onAdopt: async (p) => {
          const ok = await Collab.adopt(p); // 採用→決定→計画画面へ
          if (ok !== false) close();
        }
      });
      $("wz-actions").hidden = false;
    } catch (e) {
      if (step !== 4) return;
      $("wz-gen").hidden = true;
      const note = $("wz-note");
      note.textContent = "案を作れませんでした：" + e.message + "　候補リストにスポットを入れるか、仲間に絵馬を掛けてもらってから「作り直す」を押してください。";
      note.hidden = false;
      $("wz-actions").hidden = false;
    }
  }

  return { open, close, finish, step: () => step };
})();
