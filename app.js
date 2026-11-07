/* Budget Tracker (iPhone) - the screens. Data and sync are in core.js. */
"use strict";
(() => {
  const app = document.getElementById("app");
  const sheetRoot = document.getElementById("sheet-root");
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
    "November", "December"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const store = {
    get(k, d) { try { const v = localStorage.getItem("bt." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("bt." + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    clear() { try { Object.keys(localStorage).filter(k => k.startsWith("bt.")).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ } },
  };

  const S = {
    creds: store.get("creds", null),          // { token, gist, pass }
    snapshot: store.get("snapshot", null),    // last data from the Windows app
    pending: store.get("pending", []),        // changes made here, not applied on Windows yet
    lastSync: store.get("lastSync", null),
    busy: false, error: "", errStatus: 0, deferred: false, reading: null, readStep: "",
    mode: "month", ym: null, cat: "", q: "", limit: 150,
    page: 0, wm: null,                         // page: 0 Budget, 1 Wealth; wm: month picked on Wealth
  };
  const save = () => { store.set("snapshot", S.snapshot); store.set("pending", S.pending); store.set("lastSync", S.lastSync); };

  /* ---------- helpers ---------- */
  const pad = n => String(n).padStart(2, "0");
  const isoDay = dt => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const parts = d => d.split("-").map(Number);
  const dayText = (d, year) => { const [y, m, dd] = parts(d); return `${dd} ${MON[m - 1]}${year ? " " + y : ""}`; };
  const longDay = d => { const [y, m, dd] = parts(d); return new Date(y, m - 1, dd).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); };
  const monthTitle = ym => { const [y, m] = parts(ym + "-01"); return `${MONTHS[m - 1]} ${y}`; };
  const allTxns = () => BT.viewTransactions(S.snapshot, S.pending);
  const categories = () => (S.snapshot && S.snapshot.categories) || [];
  const typeOf = (name, amount) => {
    if (name.toLowerCase() === "other") return amount > 0 ? "Income" : "Expense";
    const c = categories().find(([n]) => n.toLowerCase() === name.toLowerCase());
    return c ? c[1] : (amount > 0 ? "Income" : "Expense");
  };
  const standalone = () => window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  function toast(text, ms) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = text; document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || 2600);
  }
  const editing = () => document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);

  /* ---------- pop-up sheets: one style for all ---------- */
  function openSheet(html, mount) {
    closeSheet();
    const back = document.createElement("div");
    back.className = "backdrop";
    back.innerHTML = `<div class="sheet"><div class="grip"></div>${html}</div>`;
    back.addEventListener("click", e => { if (e.target === back) closeSheet(); });
    sheetRoot.appendChild(back);
    if (mount) mount(back.querySelector(".sheet"));
  }
  function closeSheet() { sheetRoot.innerHTML = ""; if (S.deferred) { S.deferred = false; render(); } }
  function confirmSheet(title, text, action, danger) {
    return new Promise(resolve => {
      openSheet(`<h3>${h(title)}</h3><p class="subtitle">${h(text)}</p>
        <div class="buttons"><button class="btn" data-a="no">Cancel</button>
        <button class="btn ${danger ? "danger" : "primary"}" data-a="yes">${h(action)}</button></div>`, sh => {
        sh.addEventListener("click", e => {
          const a = e.target.closest("[data-a]"); if (!a) return;
          closeSheet(); resolve(a.dataset.a === "yes");
        });
      });
    });
  }
  function chipGroups(groups, current) {
    return groups.map(([g, names]) => `<div class="group">${h(g)}</div><div class="chips">${names.map(n =>
      `<button class="chip ${current && n.toLowerCase() === current.toLowerCase() ? "on" : ""}" data-chip="${h(n)}">${h(n)}</button>`).join("")}</div>`).join("");
  }
  function pickChips(sheet, onPick) {
    sheet.addEventListener("click", e => {
      const c = e.target.closest("[data-chip]"); if (!c) return;
      sheet.querySelectorAll(`[data-chip]`).forEach(x => x.classList.toggle("on", x === c));
      onPick(c.dataset.chip);
    });
  }

  /* ---------- setup (first start) ---------- */
  function renderSetup(message) {
    document.body.classList.remove("paged");
    const fromLink = (location.hash.match(/#setup=([\w-]+)/) || [])[1] || "";
    const inBrowser = fromLink && !standalone();
    app.innerHTML = `<div class="setup">
      <img class="logo" src="icon-180.png" alt="">
      <h1>Budget Tracker</h1>
      <p class="cap">Your budget from the Windows app, on your phone. Changes sync both ways, encrypted with your passphrase.</p>
      ${inBrowser ? `<div class="card" style="margin:18px 0">
        <p style="margin:0 0 10px"><b>Put Budget on your Home Screen</b></p>
        <p class="help" style="margin:0 0 10px">Only Safari can do this. In Brave or Chrome, tap Open in Safari first.</p>
        <a class="btn" style="display:block;text-align:center;text-decoration:none;margin-bottom:14px" href="x-safari-${h(location.href)}">Open in Safari</a>
        <ol><li>In Safari tap <b>Share</b> → <b>Add to Home Screen</b> → <b>Add</b>.</li>
        <li>Open <b>Budget</b> from the Home Screen. The setup code is already filled in there: just type your passphrase.</li></ol>
        <p class="help" style="margin:0 0 10px">Code not filled in on the Home Screen app? Tap Copy setup code here, then Paste setup code there.</p>
        <button class="btn" style="width:100%" id="copy">Copy setup code</button></div>
        <p class="cap">Or use it right here in the browser:</p>` : `<p class="cap" style="margin-top:14px">In the Windows app: Settings → Show QR code (Quick Response code). Open it in Safari, tap Copy setup code, then paste it here.</p>`}
      ${!inBrowser ? `<button class="btn ${fromLink ? "" : "primary"}" style="width:100%;margin-bottom:14px" id="paste">Paste setup code</button>` : ""}
      <div class="field"><label class="label" for="code">Setup code</label>
        <textarea class="input" id="code" placeholder="Paste the setup code" autocapitalize="off" autocorrect="off" spellcheck="false">${h(fromLink)}</textarea></div>
      <div class="field"><label class="label" for="pass">Passphrase</label>
        <input class="input" id="pass" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="The one you chose in the Windows app">
        <label class="help" style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" id="show"> Show passphrase</label></div>
      ${message ? `<p class="error">${h(message)}</p>` : `<p class="error" id="err"></p>`}
      <button class="btn primary" style="width:100%" id="go">Connect</button>
    </div>`;
    const copy = document.getElementById("copy");
    if (copy) copy.onclick = async () => {
      try { await navigator.clipboard.writeText(fromLink); toast("Setup code copied - now Share → Add to Home Screen"); }
      catch (e) { document.getElementById("code").select(); toast("Select the code and copy it"); }
    };
    const paste = document.getElementById("paste");
    if (paste) paste.onclick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        document.getElementById("code").value = text;
        const err = document.querySelector(".setup .error");
        err.textContent = setupProblem(text);
        if (!err.textContent) document.getElementById("pass").focus();
      } catch (e) { document.getElementById("code").focus(); toast("Tap the box, then Paste"); }
    };
    document.getElementById("show").onchange = e => { document.getElementById("pass").type = e.target.checked ? "text" : "password"; };
    document.getElementById("go").onclick = connect;
  }

  /* ---------- a new setup code (new GitHub token on Windows): keeps the passphrase and your changes ---------- */
  const linkCode = () => (location.hash.match(/#setup=([\w-]+)/) || [])[1] || "";
  function markSeen(code) {
    if (!code) return;
    const seen = store.get("seenCodes", []);
    if (!seen.includes(code)) store.set("seenCodes", seen.concat(code).slice(-20));
  }
  function checkLinkCode() {                     // opened from a new QR code while already set up
    const code = linkCode();
    if (!code || !S.creds || store.get("seenCodes", []).includes(code)) return;
    let s; try { s = BT.parseSetup(code); } catch (e) { return; }
    if (s.token === S.creds.token && s.gist === S.creds.gist) { markSeen(code); return; }
    newCodeSheet(code);
  }
  function newCodeSheet(prefill) {
    const fromLink = !!prefill;
    openSheet(`<h3>New setup code</h3>
      <p class="subtitle">${fromLink ? "This link has a new setup code from the Windows app." :
        "After a new GitHub token in the Windows app: press Show QR code again there, open the QR code in Safari, tap Copy setup code, then Paste here."}
        Your passphrase and changes stay.</p>
      ${fromLink ? "" : `<button class="btn primary" style="width:100%;margin-bottom:12px" data-a="paste">Paste setup code</button>`}
      <div class="field"><textarea class="input" id="newcode" placeholder="Setup code" autocapitalize="off" autocorrect="off" spellcheck="false">${h(prefill || "")}</textarea></div>
      <p class="error" id="newerr"></p>
      <div class="buttons">${fromLink && !standalone() ? `<button class="btn" data-a="copy">Copy for Home Screen app</button>` : `<button class="btn" data-a="no">Cancel</button>`}
        <button class="btn primary" data-a="use">Use this code</button></div>`, sh => {
      const box = sh.querySelector("#newcode"), err = sh.querySelector("#newerr");
      sh.addEventListener("click", async e => {
        const a = e.target.closest("[data-a]"); if (!a) return;
        if (a.dataset.a === "no") { markSeen(prefill); closeSheet(); }
        if (a.dataset.a === "copy") {
          try { await navigator.clipboard.writeText(box.value.trim()); toast("Copied - in the Home Screen app: Sync → New setup code → Paste"); }
          catch (x) { box.select(); toast("Select the code and copy it"); }
        }
        if (a.dataset.a === "paste") {
          try { box.value = await navigator.clipboard.readText(); err.textContent = setupProblem(box.value); }
          catch (x) { box.focus(); toast("Tap the box, then Paste"); }
        }
        if (a.dataset.a !== "use") return;
        let setup; try { setup = BT.parseSetup(box.value); } catch (x) { err.textContent = setupProblem(box.value); return; }
        a.disabled = true; a.textContent = "Checking...";
        try {
          const sent = JSON.parse(JSON.stringify(S.pending));
          const r = await BT.sync(new BT.GitHub(setup.token), setup.gist, S.creds.pass, sent);
          S.creds = { ...S.creds, token: r.token || setup.token, gist: setup.gist };
          store.set("creds", S.creds);
          markSeen(prefill); markSeen(linkCode());
          if (r.snapshot) S.snapshot = r.snapshot;
          if (mergePending(sent, r)) setTimeout(syncNow, 500);
          S.lastSync = new Date().toISOString(); S.error = ""; S.errStatus = 0;
          save(); closeSheet(); render(); toast("Connected with the new setup code");
        } catch (x) {
          a.disabled = false; a.textContent = "Use this code";
          err.textContent = x instanceof BT.WrongPassphrase
            ? "The passphrase was changed in the Windows app. Use Sync → Forget this phone, then set up again."
            : x.status === 401 ? "GitHub refused this token too. Check the token in the Windows app, press Show QR code again and use the new code."
              : x.status ? `GitHub said: ${x.message}` : "No connection to GitHub. Check the internet connection and try again.";
        }
      });
    });
  }

  function setupProblem(text) {
    try { BT.parseSetup(text); return ""; } catch (e) { /* explained below */ }
    const t = String(text || "").trim();
    if (!t) return "The clipboard is empty. Open the QR code link in Safari and tap Copy setup code.";
    if (/github\.io|https?:\/\//i.test(t)) return "That is the app's address, not the setup code. Open the QR code link in Safari, " +
      "tap Copy setup code, and paste here without copying anything else in between.";
    return "That isn't the whole setup code. Open the QR code link in Safari and tap Copy setup code again.";
  }

  async function connect() {
    const err = document.querySelector(".setup .error");
    const btn = document.getElementById("go");
    const code = document.getElementById("code").value, pass = document.getElementById("pass").value;
    let setup;
    try { setup = BT.parseSetup(code); } catch (e) { err.textContent = setupProblem(code); return; }
    if (!pass) { err.textContent = "Type your passphrase."; return; }
    btn.disabled = true; btn.textContent = "Connecting...";
    try {
      const r = await BT.sync(new BT.GitHub(setup.token), setup.gist, pass, []);
      S.creds = { token: r.token || setup.token, gist: setup.gist, pass };
      store.set("creds", S.creds);
      markSeen(code); markSeen(linkCode());
      S.snapshot = r.snapshot; S.pending = []; S.lastSync = new Date().toISOString(); S.error = "";
      save();
      render();
      toast(r.snapshot ? "Connected" : "Connected - waiting for the Windows app to send your data");
    } catch (e) {
      err.textContent = e instanceof BT.WrongPassphrase
        ? "Wrong passphrase. It must be exactly the one in the Windows app's Settings - capital letters and spaces count. Tick Show passphrase to check it."
        : e.status === 401 ? "GitHub refused the access token in this setup code. In the Windows app press Show QR code again and use the new code."
          : e.status === 404 ? "The sync data was not found on GitHub. In the Windows app press Show QR code again."
            : e.status ? `GitHub said: ${e.message}`
              : `No connection to GitHub (${e.message || e.name}). Check the internet connection and try again.`;
      btn.disabled = false; btn.textContent = "Connect";
    }
  }

  /* ---------- main screen ---------- */
  function render() {
    if (!S.creds) { renderSetup(); return; }
    if (sheetRoot.firstChild && editing()) { S.deferred = true; return; }
    const all = allTxns();
    const ms = BT.months(all);
    if (!S.ym || !ms.includes(S.ym)) S.ym = ms[ms.length - 1] || null;
    const scope = S.mode === "month" ? S.ym : null;
    const i = ms.indexOf(S.ym);
    const tot = BT.monthTotals(all, scope);
    const title = !ms.length ? "No data yet" : scope ? monthTitle(scope) : "All months";

    const pagesEl = document.getElementById("pages");
    const tops = pagesEl ? [...pagesEl.querySelectorAll(".page")].map(p => p.scrollTop) : [0, 0];
    document.body.classList.add("paged");
    app.innerHTML = `<div class="pages" id="pages"><section class="page">
      <header class="top">
        ${tabs()}
        <div class="top-row">
          ${scope ? `<button class="nav" data-act="prev" ${i <= 0 ? "disabled" : ""}>‹</button>` : ""}
          <button class="title" data-act="picker">${h(title)} ▾</button>
          ${scope ? `<button class="nav" data-act="next" ${i >= ms.length - 1 ? "disabled" : ""}>›</button>` : ""}
          <span class="spacer"></span>
          <button class="syncpill" data-act="syncinfo"></button>
        </div>
        <div class="seg"><button data-act="mode" data-v="month" class="${S.mode === "month" ? "on" : ""}">Month</button><button data-act="mode" data-v="all" class="${S.mode === "all" ? "on" : ""}">All months</button></div>
      </header>
      <main>
        ${statementsCard()}
        ${heroCard(tot, scope, ms.length)}
        ${categoriesCard(all, scope)}
        <section class="card"><h2>Payments<span class="hint" id="count"></span></h2>
          <div class="search"><input id="q" type="search" placeholder="Search place or description" value="${h(S.q)}" autocomplete="off"></div>
          <div id="paylist"></div></section>
      </main></section>
      <section class="page">
        <header class="top">${tabs()}
          <div class="top-row"><span class="title" style="cursor:default">Wealth</span><span class="spacer"></span>
          <button class="syncpill" data-act="syncinfo"></button></div></header>
        <main>${wealthPage()}</main>
      </section></div>
      <div class="fabs ${S.page ? "hidden" : ""}" id="fab"><button class="fab light" data-act="pdf">Statement</button>
        <button class="fab" data-act="cash">+ Cash</button></div>`;
    const pages = document.getElementById("pages");
    pages.scrollLeft = S.page * pages.clientWidth;
    pages.querySelectorAll(".page").forEach((p, k) => { p.scrollTop = tops[k] || 0; });
    pages.addEventListener("scroll", () => {
      const k = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth));
      if (k !== S.page) { S.page = k; markTabs(); }
    }, { passive: true });
    pill();
    renderPayments();
    document.getElementById("q").addEventListener("input", e => { S.q = e.target.value; S.limit = 150; renderPayments(); });
  }

  function heroCard(t, scope, nMonths) {
    const parts = [[t.exp, "var(--spent)"], [t.sav, "var(--saved)"], [t.inv, "var(--invested)"], [Math.max(t.bal, 0), "var(--left)"]];
    const sum = parts.reduce((a, [v]) => a + Math.max(v, 0), 0);
    const flow = sum > 0 ? parts.filter(([v]) => v > 0).map(([v, c]) => `<span style="flex:${v / sum};background:${c}"></span>`).join("") : "";
    const legend = [["Spent", t.exp, "var(--spent)"], ["Saved", t.sav, "var(--saved)"], ["Invested", t.inv, "var(--invested)"],
      ["Left over", t.bal, t.bal < 0 ? "var(--neg)" : "var(--left)"]];
    return `<section class="card">
      <div class="hero-row">
        <div><div class="cap">Came in${scope ? "" : ` · ${nMonths} month${nMonths === 1 ? "" : "s"}`}</div><div class="big">${BT.money(t.inc)}</div></div>
        <div style="text-align:right"><div class="cap">Left over</div><div class="big ${t.bal < 0 ? "neg" : "pos"}">${BT.money(t.bal)}</div></div>
      </div>
      <div class="flow">${flow}</div>
      <div class="legend">${legend.map(([n, v, c]) => `<div><i style="background:${c}"></i>${n}<b>${BT.money(v)}</b></div>`).join("")}</div>
    </section>`;
  }

  function tabs() {
    return `<div class="tabs"><button data-act="page" data-v="0" class="${S.page === 0 ? "on" : ""}">Budget</button>` +
      `<button data-act="page" data-v="1" class="${S.page === 1 ? "on" : ""}">Wealth</button></div>`;
  }
  function markTabs() {
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", Number(b.dataset.v) === S.page));
    const fab = document.getElementById("fab"); if (fab) fab.classList.toggle("hidden", S.page !== 0);
  }

  const ACCOUNT_COLORS = { Swedbank: "#1E5A4F", Revolut: "#4FA3A5", Cash: "#E3A33B", Savings: "#2F7FA0", Investments: "#7A5CC0" };
  const accColor = a => ACCOUNT_COLORS[a] || "#8AA8A1";

  function wealthSeries() {
    const b = S.snapshot && S.snapshot.balances;
    const ms = b && b.months ? Object.keys(b.months).sort() : [];
    let prev = null;
    return ms.map(m => {
      const { row, accounts } = BT.balancesFor(S.snapshot, S.pending, m);
      const known = accounts.filter(a => row[a] != null);
      const total = known.length ? Math.round(known.reduce((s, a) => s + row[a], 0) * 100) / 100 : null;
      let change = null;
      if (prev) {
        const common = known.filter(a => prev[a] != null);
        if (common.length) change = Math.round(common.reduce((s, a) => s + row[a] - prev[a], 0) * 100) / 100;
      }
      prev = row;
      return { m, row, accounts, total, change, market: BT.balancesFor(S.snapshot, S.pending, m).market };
    });
  }

  function niceStep(span) {
    if (span <= 0) return 1;
    const raw = span / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw);
  }

  function wealthChart(series, sel) {
    const W = 340, H = 190, L = 44, R = 6, T = 8, B = 22;
    const pos = series.map(s => s.accounts.reduce((a, k) => a + Math.max(s.row[k] || 0, 0), 0));
    const neg = series.map(s => s.accounts.reduce((a, k) => a + Math.min(s.row[k] || 0, 0), 0));
    const step = niceStep(Math.max(...pos, 0) - Math.min(...neg, 0));
    const top = Math.max(step, Math.ceil(Math.max(...pos, 0) / step) * step), bottom = Math.floor(Math.min(...neg, 0) / step) * step;
    const y = v => T + (top - v) / (top - bottom) * (H - T - B);
    const slot = (W - L - R) / series.length, bw = Math.min(26, slot * 0.62);
    const every = Math.max(1, Math.ceil(series.length / 7));
    const fmt = v => Math.abs(top) >= 10000 || Math.abs(bottom) >= 10000 ? `€${Math.round(v / 1000)}k` : `€${Math.round(v)}`;
    let svg = "";
    for (let v = bottom; v <= top + step / 2; v += step) {
      svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${Math.abs(v) < 1e-9 ? "#B9C5C1" : "#DCE3E0"}" stroke-width="1"/>`;
      svg += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    }
    series.forEach((s, i) => {
      const x0 = L + slot * i, x = x0 + (slot - bw) / 2;
      if (s.m === sel) svg += `<rect x="${x0}" y="${T}" width="${slot}" height="${H - T - B}" fill="#EEF4F1" rx="6"/>`;
      let up = 0, down = 0;
      for (const a of s.accounts) {
        const v = s.row[a]; if (!v) continue;
        const [y0, y1] = v > 0 ? [y(up), y(up + v)] : [y(down + v), y(down)];
        if (v > 0) up += v; else down += v;
        svg += `<rect x="${x}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.abs(y1 - y0)}" fill="${accColor(a)}"/>`;
      }
      if (i % every === 0 || i === series.length - 1) svg += `<text x="${x0 + slot / 2}" y="${H - 6}" text-anchor="middle">${MON[Number(s.m.slice(5)) - 1]}</text>`;
      svg += `<rect x="${x0}" y="0" width="${slot}" height="${H}" fill="transparent" data-act="wm" data-v="${s.m}"/>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth by month">${svg}</svg>`;
  }

  function wealthPage() {
    const series = wealthSeries();
    if (!series.length) return `<section class="card"><div class="empty">No balances yet. They arrive with the next sync from the Windows app.</div></section>`;
    if (!S.wm || !series.some(s => s.m === S.wm)) S.wm = series[series.length - 1].m;
    const k = series.findIndex(s => s.m === S.wm), cur = series[k], prev = series[k - 1];
    const since = series.slice(0, k + 1).reduce((a, s) => a + (s.change || 0), 0);
    const first = series.find(s => s.total != null);
    const positive = cur.accounts.filter(a => (cur.row[a] || 0) > 0);
    const posTotal = positive.reduce((s, a) => s + cur.row[a], 0) || 1;
    const missing = cur.accounts.filter(a => cur.row[a] == null);
    return `<section class="card">
        <div class="cap">Net worth at the end of ${monthTitle(cur.m)}</div>
        <div class="big ${cur.total < 0 ? "neg" : ""}">${cur.total == null ? "—" : BT.money(cur.total)}</div>
        <div class="hero-row" style="margin-top:12px">
          <div><div class="cap">This month</div><div class="mid ${cur.change < 0 ? "neg" : "pos"}">${cur.change == null ? "—" : BT.money(cur.change, true)}</div></div>
          <div style="text-align:right"><div class="cap">Since ${first ? monthTitle(first.m) : "start"}</div><div class="mid ${since < 0 ? "neg" : "pos"}">${BT.money(since, true)}</div></div>
        </div>
        <div class="flow">${positive.map(a => `<span style="flex:${cur.row[a] / posTotal};background:${accColor(a)}"></span>`).join("")}</div>
      </section>
      <section class="card"><h2>Over time<span class="hint">Tap a month</span></h2>${wealthChart(series, cur.m)}</section>
      <section class="card"><h2>Accounts<span class="hint">end of ${MONTHS[Number(cur.m.slice(5)) - 1]}</span></h2>
        ${cur.accounts.map(a => {
          const v = cur.row[a], p = prev && prev.row[a], d = v != null && p != null ? v - p : null;
          const mk = cur.market && cur.market[a];
          const editable = ["Cash", "Savings", "Investments"].includes(a);
          return `<div class="acct" ${editable ? `data-act="value" data-v="${h(a)}"` : ""}><i style="background:${accColor(a)}"></i><div class="main"><div class="place">${h(a)}${editable ? ` <span class="edit">Update</span>` : ""}</div>
            <div class="sub">${v == null ? "not set - tap to set" : `${Math.round(Math.max(v, 0) / posTotal * 100)}% of your money`}${mk ? ` · market ${BT.money(mk, true)}` : ""}</div></div>
            <div style="text-align:right"><div class="amt">${v == null ? "—" : BT.money(v)}</div>
            ${d == null || Math.abs(d) < 0.005 ? "" : `<div class="sub ${d < 0 ? "negtext" : "postext"}">${BT.money(d, true)}</div>`}</div></div>`;
        }).join("")}
        <p class="help">Banks come from your statements by themselves. Tap cash, savings or investments to enter today's value - e.g. after the market moved.</p>
      </section>`;
  }

  function balancesCard(ym) {
    const b = ym && BT.balancesFor(S.snapshot, S.pending, ym);
    if (!b) return "";
    const known = b.accounts.filter(a => b.row[a] != null);
    const total = known.reduce((s, a) => s + b.row[a], 0);
    const colors = { Cash: "var(--spent)", Savings: "var(--saved)", Investments: "var(--invested)" };
    return `<section class="card"><h2>You have<span class="hint">end of ${MONTHS[Number(ym.slice(5)) - 1]}</span></h2>
      <div class="big ${total < 0 ? "neg" : ""}" style="margin-bottom:12px">${known.length ? BT.money(total) : "—"}</div>
      <div class="legend">${b.accounts.map(a => `<div><i style="background:${colors[a] || "var(--spruce)"}"></i>${h(a)}<b style="${b.row[a] == null ? "color:var(--muted);font-weight:400" : ""}">${b.row[a] == null ? "not set" : BT.money(b.row[a])}</b></div>`).join("")}</div>
      ${b.accounts.some(a => b.row[a] == null) ? `<p class="help">Set cash, savings and investments in the Windows app: Balances.</p>` : ""}
    </section>`;
  }

  function categoriesCard(all, scope) {
    const rows = BT.spendingByCategory(all, scope);
    const max = rows.length ? rows[0][1] : 1;
    const total = rows.reduce((a, [, v]) => a + v, 0);
    return `<section class="card"><h2>Spending by category<span class="hint">${rows.length ? "Tap to filter" : ""}</span></h2>
      ${rows.length ? rows.map(([c, v]) => `<div class="catrow ${S.cat === c ? "on" : ""}" data-act="cat" data-v="${h(c)}">
        <span class="name">${h(c)}</span><div class="bar"><span style="width:${Math.max(3, v / max * 100)}%;${c === "Other" ? "background:var(--other)" : ""}"></span></div>
        <span class="amt">${BT.money(v)}<div class="cap" style="font-weight:400">${Math.round(v / total * 100)}%</div></span></div>`).join("")
        : `<div class="empty">No spending in this ${scope ? "month" : "period"}.</div>`}</section>`;
  }

  let shown = [];
  function renderPayments() {
    const all = allTxns();
    const scope = S.mode === "month" ? S.ym : null;
    const q = S.q.trim().toLowerCase();
    shown = all.filter(t => (!scope || t.d.startsWith(scope)) && (!S.cat || (t.c || "Other") === S.cat)
      && (!q || `${t.p} ${t.s} ${BT.isCash(t) ? "cash" : ""}`.toLowerCase().includes(q)));
    const total = shown.filter(t => t.t !== "Transfer").reduce((a, t) => a + t.a, 0);
    document.getElementById("count").textContent = `${shown.length} · ${BT.money(total, true)}`;
    const list = document.getElementById("paylist");
    list.innerHTML = (S.cat ? `<button class="filter" data-act="cat" data-v="${h(S.cat)}">${h(S.cat)} ✕</button>` : "")
      + (shown.length ? shown.slice(0, S.limit).map((t, n) => `<div class="pay ${t.t === "Transfer" ? "transfer" : ""}" data-act="pay" data-v="${n}">
        <div class="main"><div class="place">${h(t.p)}${BT.isCash(t) ? `<span class="tag">cash</span>` : ""}${t.pending ? `<span class="tag wait">not synced</span>` : ""}</div>
        <div class="sub">${dayText(t.d, !scope)} · ${h(t.c || "Other")}</div></div>
        <div class="amt ${t.a > 0 ? "pos" : ""}">${BT.money(t.a, true)}</div></div>`).join("")
        + (shown.length > S.limit ? `<button class="more" data-act="more">Show more (${shown.length - S.limit})</button>` : "")
        : `<div class="empty">No payments${q || S.cat ? " match" : ""}.</div>`);
  }

  function pill() {
    const pills = document.querySelectorAll(".syncpill"); if (!pills.length) return;
    const n = S.pending.length;
    // when the Windows app last sent new data: tells at a glance whether a new statement has arrived
    const up = S.snapshot && S.snapshot.updated ? new Date(S.snapshot.updated) : null;
    const pc = !up ? "" : up.toDateString() === new Date().toDateString()
      ? up.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : up.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const [cls, text] = S.busy ? ["busy", "Syncing"] : S.error ? ["bad", S.errStatus === 401 ? "Token refused" : S.errStatus ? "Sync problem" : "Offline"]
      : n ? ["wait", `${n} waiting`]
      : S.lastSync ? ["ok", pc ? `PC data ${pc}` : "Synced"] : ["", "Sync"];
    pills.forEach(p => { p.innerHTML = `<span class="dot ${cls}"></span>${text}`; });
  }

  /* ---------- actions ---------- */
  app.addEventListener("click", e => {
    const el = e.target.closest("[data-act]"); if (!el) return;
    const ms = BT.months(allTxns());
    const i = ms.indexOf(S.ym);
    switch (el.dataset.act) {
      case "prev": if (i > 0) { S.ym = ms[i - 1]; S.cat = ""; render(); } break;
      case "next": if (i < ms.length - 1) { S.ym = ms[i + 1]; S.cat = ""; render(); } break;
      case "mode": S.mode = el.dataset.v; S.limit = 150; render(); break;
      case "picker": monthPicker(ms); break;
      case "cat": S.cat = S.cat === el.dataset.v ? "" : el.dataset.v; S.limit = 150; render();
        if (S.cat) document.getElementById("paylist").scrollIntoView({ behavior: "smooth", block: "start" }); break;
      case "more": S.limit += 150; renderPayments(); break;
      case "pay": { const t = shown[Number(el.dataset.v)]; if (t) (BT.isCash(t) ? cashSheet(t) : categorySheet(t)); break; }
      case "cash": cashSheet(null); break;
      case "pdf": pickStatements(); break;
      case "unpdf": cancelStatement(el.dataset.v); break;
      case "syncinfo": syncSheet(); break;
      case "page": { const p = document.getElementById("pages"); S.page = Number(el.dataset.v); markTabs();
        p.scrollTo({ left: S.page * p.clientWidth, behavior: "smooth" }); break; }
      case "wm": S.wm = el.dataset.v; render(); break;
      case "value": valueSheet(el.dataset.v); break;
    }
  });

  function monthPicker(ms) {
    if (!ms.length) return;
    const years = [...new Set(ms.map(m => m.slice(0, 4)))];
    let y = (S.ym || ms[ms.length - 1]).slice(0, 4);
    const draw = sh => {
      const yi = years.indexOf(y);
      sh.querySelector(".ynav").innerHTML = `<button data-y="-1" ${yi <= 0 ? "disabled" : ""}>‹</button><span>${y}</span><button data-y="1" ${yi >= years.length - 1 ? "disabled" : ""}>›</button>`;
      sh.querySelector(".mgrid").innerHTML = MON.map((m, k) => {
        const ym = `${y}-${pad(k + 1)}`;
        return `<button class="mcell ${S.mode === "month" && ym === S.ym ? "on" : ""}" data-m="${ym}" ${ms.includes(ym) ? "" : "disabled"}>${m}</button>`;
      }).join("");
    };
    openSheet(`<h3>Choose a month</h3><p class="subtitle">Months without statements are greyed out.</p>
      <div class="ynav"></div><div class="mgrid"></div>
      <div class="buttons"><button class="btn" data-m="all">All months</button></div>`, sh => {
      draw(sh);
      sh.addEventListener("click", e => {
        const yb = e.target.closest("[data-y]");
        if (yb) { y = years[years.indexOf(y) + Number(yb.dataset.y)] || y; draw(sh); return; }
        const mb = e.target.closest("[data-m]"); if (!mb) return;
        if (mb.dataset.m === "all") S.mode = "all"; else { S.mode = "month"; S.ym = mb.dataset.m; }
        S.cat = ""; S.limit = 150; closeSheet(); render();
      });
    });
  }

  function groupedCategories(filterType, extra) {
    const groups = new Map();
    for (const [n, t] of categories()) {
      if (filterType && t !== filterType) continue;
      if (filterType && n.toLowerCase() === "cash") continue;          // 'Cash' = ATM withdrawals
      const g = BT.GROUP_OF[t] || "Spending";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(n);
    }
    if (extra && ![...groups.values()].flat().some(n => n.toLowerCase() === extra.toLowerCase()) && extra.toLowerCase() !== "other") {
      const g = BT.GROUP_OF[typeOf(extra, 0)] || "Spending";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(extra);
    }
    return BT.GROUP_ORDER.filter(g => groups.has(g)).map(g => [g, groups.get(g).sort((a, b) => a.localeCompare(b))]);
  }

  function categorySheet(t) {
    let chosen = t.c || "Other";
    const groups = groupedCategories(null, chosen);
    const otherGroup = t.a > 0 ? "Income" : "Spending";
    const g = groups.find(([name]) => name === otherGroup);
    if (g) g[1].push("Other"); else groups.push([otherGroup, ["Other"]]);
    openSheet(`<h3>${h(t.p)}</h3><p class="subtitle">${longDay(t.d)}</p>
      <div class="info"><div class="big" style="color:${t.a > 0 ? "var(--left)" : "var(--ink)"}">${BT.money(t.a, true)}</div><div class="desc">${h(t.s)}</div></div>
      <span class="label">Category</span>${chipGroups(groups, chosen)}
      <p class="help" style="margin-top:-4px">Only this payment changes. The Windows app applies it the next time it syncs.</p>
      <div class="buttons stick"><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="save">Save</button></div>`, sh => {
      pickChips(sh, n => { chosen = n; });
      sh.addEventListener("click", e => {
        const a = e.target.closest("[data-a]"); if (!a) return;
        if (a.dataset.a === "cancel") return closeSheet();
        if (chosen.toLowerCase() !== (t.c || "Other").toLowerCase()) changeCategory(t, chosen);
        closeSheet();
      });
    });
  }

  function changeCategory(t, cat) {
    const type = typeOf(cat, t.a);
    if (t.k[0] === "pending") {                          // a cash payment that isn't on Windows yet
      const op = S.pending.find(c => c.id === t.k[1]);
      if (op) { op.tx.c = cat; op.tx.t = type; }
    } else {
      S.pending = S.pending.filter(c => !(c.op === "edit" && BT.sameKey(c.key, t.k)));
      S.pending.push({ id: BT.newId(), at: new Date().toISOString(), op: "edit", key: t.k, category: cat, type });
    }
    changed(`${t.p}: ${cat}`);
  }

  /* ---------- statements: read on this phone (pyworker.js, the Windows app's own Python code), so their payments
     show at once; Windows stores them (and rebuilds Excel) at its next sync. A statement this phone can't read
     is sent to Windows as the PDF. ---------- */
  const MAX_PDF = 4 * 1024 * 1024;
  let worker = null, jobs = 0;
  const waits = new Map();
  function reader() {
    if (worker) return worker;
    try { worker = new Worker("pyworker.js"); } catch (e) { return null; }
    worker.onmessage = e => {
      const m = e.data, w = waits.get(m.id); if (!w) return;
      if (m.progress) { w.progress(m.progress); return; }
      waits.delete(m.id); clearTimeout(w.timer);
      if (m.error) w.reject(new Error(m.error)); else w.resolve(m.result);
    };
    worker.onerror = e => {
      for (const w of waits.values()) { clearTimeout(w.timer); w.reject(new Error(e.message || "the reader stopped")); }
      waits.clear(); worker = null;
    };
    return worker;
  }
  function ask(msg, progress, ms, transfer) {
    const w = reader(); if (!w) return Promise.reject(new Error("this browser can't run the reader"));
    const id = ++jobs;
    return new Promise((resolve, reject) => {
      const timer = ms ? setTimeout(() => { waits.delete(id); reject(new Error("it took too long")); }, ms) : 0;
      waits.set(id, { resolve, reject, progress: progress || (() => {}), timer });
      w.postMessage({ id, ...msg }, transfer || []);
    });
  }
  const latestNow = () => { const ms = BT.months(allTxns()), ws = wealthSeries(); return [ms[ms.length - 1] || null, ws.length ? ws[ws.length - 1].m : null]; };
  function followLatest([oldM, oldW]) {             // you were on the latest month: go to the new latest one
    const [newM, newW] = latestNow();
    if (!S.ym || S.ym === oldM) { if (S.ym !== newM) S.cat = ""; S.ym = newM; }
    if (!S.wm || S.wm === oldW) S.wm = newW;
  }
  function readingStep(text) {
    S.readStep = text;
    const el = document.getElementById("readstep");
    if (el) el.textContent = text; else render();
  }
  function pickStatements() {
    ask({ op: "warm" }).catch(() => {});             // Python starts while you pick the file
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/pdf,.pdf"; input.multiple = true; input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = async () => {
      const files = [...input.files]; input.remove();
      const notes = [], mark = latestNow(); let changedAny = false;
      for (const f of files) {
        const name = f.name || "statement.pdf";
        if (S.pending.some(c => (c.op === "import_pdf" || c.op === "import_txns") && c.name === name && c.size === f.size)) { notes.push(`${name} is already waiting`); continue; }
        if (f.size > MAX_PDF) { notes.push(`${name} is too big (over 4 MB)`); continue; }
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") { notes.push(`${name} is not a PDF`); continue; }
        S.reading = name; readingStep("Reading...");
        const snap = S.snapshot || {};
        let r = null, why = "";
        try {
          r = await ask({ op: "read", name, data: bytes.slice().buffer, rules: snap.rules || [], settings: snap.rule_settings || {} },
            readingStep, 120000);
        } catch (e) { why = e.message || String(e); }
        if (r && r.txns && r.txns.length) {
          const fresh = BT.newRows(allTxns(), r.txns);
          if (!fresh.length) { notes.push(`${name}: ${r.bank}, nothing new - it was already imported`); continue; }
          S.pending.push({ id: BT.newId(), at: new Date().toISOString(), op: "import_txns", name, size: f.size, bank: r.bank,
            ok: r.ok, why: r.why, added: fresh.length, data: BT.b64.to(bytes),
            txns: r.txns.map(t => ({ k: t.k, d: t.d, s: t.s, a: t.a, bal: t.bal, p: t.p, c: t.c, t: t.t })) });
          changedAny = true;
          notes.push(`${name}: ${r.bank}, ${fresh.length} new payment${fresh.length === 1 ? "" : "s"}` +
            (r.ok === true ? ", adds up to the statement ✓" : r.ok === false ? ` - ⚠ they don't add up to the statement (${r.why}): a page may be missing` : ""));
        } else if (r) {
          notes.push(`${name}: no payments found - is it a Swedbank or Revolut statement?`);
        } else {                                      // couldn't read it here: Windows reads the PDF
          S.pending.push({ id: BT.newId(), at: new Date().toISOString(), op: "import_pdf", name, size: f.size, data: BT.b64.to(bytes) });
          changedAny = true;
          notes.push(`${name}: couldn't be read on this phone (${why}) - sent to your PC, it imports it within 5 minutes`);
        }
      }
      S.reading = null;
      if (changedAny) { followLatest(mark); save(); }
      render();
      if (changedAny) syncNow();
      if (notes.length) toast(notes.join(" · "), 6000);
    };
    input.click();
  }
  /* why your changes haven't reached Windows yet (from the Windows app), or what to check */
  function waitingNote(list) {
    const w = S.snapshot && S.snapshot.waiting;
    if (w && w.reason && list.some(c => (w.ids || []).includes(c.id))) return `The Windows app got ${list.length > 1 ? "them" : "it"}, but ${w.reason}.`;
    const up = S.snapshot && S.snapshot.updated ? new Date(S.snapshot.updated) : null;
    const last = up ? ` It last sent data ${up.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : "";
    return `Not picked up yet - your PC syncs every 5 minutes while it is on (the app window doesn't have to be open).${last}`;
  }
  function statementsCard() {
    const list = S.pending.filter(c => c.op === "import_pdf" || c.op === "import_txns");
    if (!list.length && !S.reading) return "";
    const read = list.filter(c => c.op === "import_txns"), pdfs = list.filter(c => c.op === "import_pdf");
    const help = [];
    if (read.length) help.push(`Their payments are in the list already (marked "not synced"). Your PC stores them and updates Excel at its next sync - ${h(waitingNote(read)).replace(/^Not picked up yet - /, "")}`);
    if (pdfs.length) help.push(h(waitingNote(pdfs)));
    return `<section class="card stmts"><h2>Statements</h2>
      ${S.reading ? `<div class="stmt"><span class="ico">PDF</span><span class="nm">${h(S.reading)}</span><span class="hint" id="readstep">${h(S.readStep || "")}</span></div>` : ""}
      ${list.map(c => `<button class="stmt" data-act="unpdf" data-v="${h(c.id)}"><span class="ico">PDF</span>
        <span class="nm">${h(c.name)}${c.op === "import_txns" ? `<span class="sub">${h(c.bank)} · ${c.added} new payment${c.added === 1 ? "" : "s"}${c.ok === false ? " · ⚠ doesn't add up" : ""}</span>`
          : `<span class="sub">waiting for your PC to read it</span>`}</span><span class="hint">Cancel</span></button>`).join("")}
      ${help.map(x => `<p class="help">${x}</p>`).join("")}</section>`;
  }
  async function cancelStatement(id) {
    const c = S.pending.find(x => x.id === id); if (!c) return;
    if (!await confirmSheet("Cancel this statement?", `${c.name} won't be imported${c.op === "import_txns" ? " - its payments disappear from this phone" : ""}.`, "Cancel it", true)) return;
    S.pending = S.pending.filter(x => x.id !== id);
    save(); render(); syncNow();
  }
  function statementResults(sent, r) {             // statements Windows took in this sync: say how it went
    const done = sent.filter(c => (c.op === "import_pdf" || c.op === "import_txns") && !r.pending.some(x => x.id === c.id));
    const told = ((r.snapshot && r.snapshot.imports) || []);
    const lines = done.map(c => {
      const x = told.find(i => i.id === c.id);
      if (c.op === "import_txns" && x && x.text && !x.text.startsWith("Not imported")) return null;   // said when it was read
      return `${c.name}: ${x && x.text ? x.text : "not imported - the Windows app is an older version. Update it and upload the statement again."}`;
    }).filter(Boolean);
    if (lines.length) toast(lines.join(" · "), 6000);
  }

  function cashSheet(t) {
    const editingTx = !!t;
    let dir = t ? (t.a > 0 ? "Income" : "Expense") : "Expense";
    let chosen = t ? (t.c || "Other") : "";
    let day = t ? t.d : (() => {
      const today = isoDay(new Date());
      if (S.mode === "month" && S.ym && !today.startsWith(S.ym)) {
        const [y, m] = parts(S.ym + "-01"); return isoDay(new Date(y, m, 0));
      }
      return today;
    })();
    const chipsFor = () => {
      const groups = groupedCategories(dir, chosen && typeOf(chosen, dir === "Income" ? 1 : -1) === dir ? chosen : null);
      const g = groups.find(([n]) => n === (dir === "Income" ? "Income" : "Spending"));
      if (g) g[1].push("Other"); else groups.push([dir === "Income" ? "Income" : "Spending", ["Other"]]);
      return chipGroups(groups, chosen);
    };
    openSheet(`<h3>${editingTx ? "Cash payment" : "Add cash"}</h3><p class="subtitle">Cash you spent or received. Statement payments are never changed by it.</p>
      <span class="label">Money</span><div class="chips" id="dir">
        <button class="chip ${dir === "Expense" ? "on" : ""}" data-dir="Expense">Spent</button>
        <button class="chip ${dir === "Income" ? "on" : ""}" data-dir="Income">Received</button></div>
      <div class="row2">
        <div class="field"><label class="label" for="amt">Amount, €</label><input class="input" id="amt" inputmode="decimal" placeholder="0.00" value="${t ? Math.abs(t.a).toFixed(2) : ""}"></div>
        <div class="field"><label class="label" for="day">Date</label><input class="input" id="day" type="date" value="${day}"></div>
      </div>
      <div class="field"><label class="label" for="desc">Description</label><input class="input" id="desc" placeholder="e.g. Market at the bazaar" value="${t && t.s !== t.c ? h(t.s) : ""}"></div>
      <span class="label">Category</span><div id="cats">${chipsFor()}</div>
      <p class="error" id="err"></p>
      <div class="buttons stick">${editingTx ? `<button class="btn danger" data-a="delete">Delete</button>` : ""}
        <button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="save">${editingTx ? "Save" : "Add"}</button></div>`, sh => {
      if (!editingTx) setTimeout(() => sh.querySelector("#amt").focus(), 250);
      sh.addEventListener("click", async e => {
        const d = e.target.closest("[data-dir]");
        if (d) {
          dir = d.dataset.dir;
          sh.querySelectorAll("[data-dir]").forEach(x => x.classList.toggle("on", x === d));
          if (chosen && chosen !== "Other" && typeOf(chosen, 0) !== dir) chosen = "";
          sh.querySelector("#cats").innerHTML = chipsFor();
          return;
        }
        const c = e.target.closest("[data-chip]");
        if (c) { chosen = c.dataset.chip; sh.querySelectorAll("[data-chip]").forEach(x => x.classList.toggle("on", x === c)); return; }
        const a = e.target.closest("[data-a]"); if (!a) return;
        if (a.dataset.a === "cancel") return closeSheet();
        if (a.dataset.a === "delete") {
          if (await confirmSheet("Delete this cash payment?", `${dayText(t.d, true)} · ${t.s} · ${BT.money(t.a, true)}`, "Delete", true)) deleteCash(t);
          return;
        }
        const amount = BT.parseAmount(sh.querySelector("#amt").value);
        const date = sh.querySelector("#day").value;
        const err = sh.querySelector("#err");
        if (!amount) { err.textContent = "Type the amount, e.g. 12.50"; return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err.textContent = "Pick a date."; return; }
        if (!chosen) { err.textContent = "Tap a category."; return; }
        const desc = sh.querySelector("#desc").value.trim().replace(/\s+/g, " ");
        const tx = { d: date, s: desc || chosen, a: (dir === "Income" ? 1 : -1) * amount, c: chosen,
          t: chosen === "Other" ? dir : typeOf(chosen, dir === "Income" ? 1 : -1) };
        if (t && t.k[0] === "pending") {
          const op = S.pending.find(x => x.id === t.k[1]); if (op) op.tx = tx;
        } else {
          if (t) S.pending.push({ id: BT.newId(), at: new Date().toISOString(), op: "delete_cash", key: t.k });
          S.pending.push({ id: BT.newId(), at: new Date().toISOString(), op: "add_cash", tx });
        }
        closeSheet();
        if (S.mode === "month") S.ym = date.slice(0, 7);
        changed(`${tx.s} ${BT.money(tx.a, true)}`);
      });
    });
  }

  function valueSheet(acct) {
    const series = wealthSeries();
    const now = series.length ? series[series.length - 1].row[acct] : null;
    const help = { Cash: "Count your wallet. Cash payments you add move it from then on.",
      Savings: "All savings accounts together, e.g. after interest was paid.",
      Investments: "The value in your broker's app now. Money you put in or take out is counted by itself; the rest shows as market change." }[acct];
    openSheet(`<h3>Update ${h(acct)}</h3><p class="subtitle">${h(help)}</p>
      <div class="info"><div class="cap">Now in the app</div><div class="big">${now == null ? "—" : BT.money(now)}</div></div>
      <div class="row2">
        <div class="field"><label class="label" for="val">Value, €</label><input class="input" id="val" inputmode="decimal" placeholder="0.00"></div>
        <div class="field"><label class="label" for="vday">Date</label><input class="input" id="vday" type="date" value="${isoDay(new Date())}"></div>
      </div>
      <p class="error" id="err"></p>
      <div class="buttons"><button class="btn" data-a="cancel">Cancel</button><button class="btn primary" data-a="save">Save</button></div>`, sh => {
      setTimeout(() => sh.querySelector("#val").focus(), 250);
      sh.addEventListener("click", e => {
        const a = e.target.closest("[data-a]"); if (!a) return;
        if (a.dataset.a === "cancel") return closeSheet();
        const raw = sh.querySelector("#val").value.trim();
        const v = /^\s*[-−]/.test(raw) ? -BT.parseAmount(raw.replace(/[-−]/, "")) : (raw.replace(/[€\s]/g, "") === "0" ? 0 : BT.parseAmount(raw));
        const d = sh.querySelector("#vday").value;
        if (v == null || Number.isNaN(v)) { sh.querySelector("#err").textContent = "Type the value, e.g. 1250.00"; return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { sh.querySelector("#err").textContent = "Pick a date."; return; }
        S.pending = S.pending.filter(c => !(c.op === "set_balance" && c.account === acct && c.d === d));
        S.pending.push({ id: BT.newId(), at: new Date().toISOString(), op: "set_balance", account: acct, d, value: v });
        closeSheet();
        changed(`${acct}: ${BT.money(v)}`);
      });
    });
  }

  function deleteCash(t) {
    if (t.k[0] === "pending") S.pending = S.pending.filter(c => c.id !== t.k[1]);
    else S.pending.push({ id: BT.newId(), at: new Date().toISOString(), op: "delete_cash", key: t.k });
    changed("Cash payment deleted");
  }

  function changed(message) {
    save(); render(); toast(message); syncNow();
  }

  function syncSheet() {
    const when = S.lastSync ? new Date(S.lastSync).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";
    const fromWin = S.snapshot && S.snapshot.updated ? new Date(S.snapshot.updated).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "nothing yet";
    const n = S.pending.length;
    const imports = ((S.snapshot && S.snapshot.imports) || []).slice(-3).reverse();
    openSheet(`<h3>Sync</h3><p class="subtitle">Your data is encrypted with your passphrase before it leaves the phone.</p>
      <div class="info"><div>Last synced: <b>${when}</b></div><div>Data from Windows: <b>${fromWin}</b></div>
      <div>${n ? `<b>${n}</b> change${n === 1 ? "" : "s"} waiting. ${h(waitingNote(S.pending))}` : "No changes waiting"}</div>
      ${S.error ? `<div class="error" style="margin:8px 0 0">${h(S.error)}</div>` : ""}</div>
      ${imports.length ? `<div class="info"><div><b>Statements from this phone</b></div>${imports.map(x =>
        `<div class="help" style="margin-top:6px">${h(x.name)}: ${h(x.text)}</div>`).join("")}</div>` : ""}
      <div class="buttons">${S.errStatus === 401 ? `<button class="btn primary" data-a="newcode">New setup code</button>`
        : `<button class="btn primary" data-a="sync">Sync now</button>`}</div>
      <div class="buttons">${S.errStatus === 401 ? `<button class="btn" data-a="sync">Sync now</button>`
        : `<button class="btn" data-a="newcode">New setup code</button>`}
        <button class="btn danger" data-a="forget">Forget this phone</button></div>`, sh => {
      sh.addEventListener("click", async e => {
        const a = e.target.closest("[data-a]"); if (!a) return;
        if (a.dataset.a === "sync") { closeSheet(); await syncNow(); if (!S.error) toast("Synced"); }
        if (a.dataset.a === "newcode") newCodeSheet("");
        if (a.dataset.a === "forget" && await confirmSheet("Forget this phone?",
          (n ? `${n} change${n === 1 ? "" : "s"} not synced yet will be lost. ` : "") + "Your data stays on Windows and GitHub; set up again with the QR code.", "Forget", true)) {
          store.clear(); Object.assign(S, { creds: null, snapshot: null, pending: [], lastSync: null, error: "" }); render();
        }
      });
    });
  }

  /* ---------- sync ---------- */
  /* After a sync: drop the changes Windows applied, keep what was added, cancelled or changed while it ran.
     Returns true when the phone's list differs from what was just uploaded (then it syncs again). */
  function mergePending(sent, r) {
    const sentIds = new Set(sent.map(c => c.id)), left = new Set(r.pending.map(c => c.id));
    S.pending = S.pending.filter(c => !sentIds.has(c.id) || left.has(c.id));
    const uploaded = sent.filter(c => left.has(c.id));
    return JSON.stringify(uploaded) !== JSON.stringify(S.pending);
  }
  async function syncNow() {
    if (!S.creds || S.busy) { pill(); return; }
    if (!navigator.onLine) { S.error = "Offline - your changes are kept and sent when you're online."; pill(); return; }
    S.busy = true; pill();
    const sent = JSON.parse(JSON.stringify(S.pending));       // as uploaded (edits made meanwhile are noticed)
    try {
      const r = await BT.sync(new BT.GitHub(S.creds.token), S.creds.gist, S.creds.pass, sent);
      if (r.token) { S.creds = { ...S.creds, token: r.token }; store.set("creds", S.creds); toast("New GitHub token picked up from Windows"); }
      if (r.snapshot) {
        // If you were looking at the latest month, follow it to the new latest month (a new statement adds one).
        const mark = latestNow();
        S.snapshot = r.snapshot;
        followLatest(mark);
      }
      statementResults(sent, r);
      const again = mergePending(sent, r);              // made / cancelled while this sync was running
      S.lastSync = new Date().toISOString(); S.error = ""; S.errStatus = 0;
      save();
      S.busy = false;
      if (editing() || sheetRoot.firstChild) { S.deferred = true; pill(); } else render();
      if (again) setTimeout(syncNow, 500);
    } catch (e) {
      S.busy = false; S.errStatus = e.status || 0;
      S.error = e instanceof BT.WrongPassphrase ? "The passphrase doesn't match the data any more (changed in the Windows app?). Forget this phone and set it up again."
        : e.status === 401 ? "GitHub refused the access token: it expired or was replaced, so nothing syncs. In the Windows app: Settings → paste a new token (Expiration: No expiration) → Show QR code again. Then tap New setup code here."
          : (e.message && e.status ? e.message : "Offline - your changes are kept and sent when you're online.");
      pill();
    }
  }

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  window.addEventListener("online", () => syncNow());
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60000);
  document.addEventListener("focusout", () => setTimeout(() => { if (S.deferred && !editing() && !sheetRoot.firstChild) { S.deferred = false; render(); } }, 50));

  /* no zooming: pinch (Safari's gesture events and two-finger moves); double-tap zoom is off via CSS touch-action */
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  document.addEventListener("touchmove", e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  render();
  checkLinkCode();
  syncNow();
})();
