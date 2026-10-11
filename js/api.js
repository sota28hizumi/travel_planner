// ============================================================
// サーバーAPI クライアント（server/main.py の FastAPI）
// サーバーが無いとき（index.html を直接開いた／python -m http.server で配信）は
// available=false になり、アプリは従来どおり localStorage だけで動く
// ============================================================
const Api = (() => {
  let available = null; // null=未判定 / true / false
  let info = null;      // GET /api/info の結果（AI利用可否・共有URLの土台など）

  async function req(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j && j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      } catch (e) { /* 本文がJSONでなければステータスだけ */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // サーバーの有無を短いタイムアウトで判定する（file:// では fetch が失敗して false になる）
  async function detect() {
    if (typeof fetch !== "function") { available = false; return false; }
    try {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
      const res = await fetch("/api/info", { signal: ctrl ? ctrl.signal : undefined, cache: "no-store" });
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error(String(res.status));
      info = await res.json();
      available = !!(info && info.ok);
    } catch (e) {
      available = false;
    }
    return available;
  }

  return {
    detect,
    req,
    isAvailable: () => available === true,
    info: () => info,
    get: (p) => req("GET", p),
    post: (p, b) => req("POST", p, b === undefined ? {} : b),
    put: (p, b) => req("PUT", p, b),
    patch: (p, b) => req("PATCH", p, b),
    del: (p) => req("DELETE", p)
  };
})();
