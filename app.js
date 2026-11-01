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
    busy: false, error: "", deferred: false,
    mode: "month", ym: null, cat: "", q: "", limit: 150,
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
  function toast(text) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = text; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
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
      ${!fromLink ? `<button class="btn primary" style="width:100%;margin-bottom:14px" id="paste">Paste setup code</button>` : ""}
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
      S.creds = { token: setup.token, gist: setup.gist, pass };
      store.set("creds", S.creds);
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

    app.innerHTML = `
      <header class="top">
        <div class="top-row">
          ${scope ? `<button class="nav" data-act="prev" ${i <= 0 ? "disabled" : ""}>‹</button>` : ""}
          <button class="title" data-act="picker">${h(title)} ▾</button>
          ${scope ? `<button class="nav" data-act="next" ${i >= ms.length - 1 ? "disabled" : ""}>›</button>` : ""}
          <span class="spacer"></span>
          <button class="syncpill" data-act="syncinfo" id="pill"></button>
        </div>
        <div class="seg"><button data-act="mode" data-v="month" class="${S.mode === "month" ? "on" : ""}">Month</button><button data-act="mode" data-v="all" class="${S.mode === "all" ? "on" : ""}">All months</button></div>
      </header>
      <main>
        ${heroCard(tot, scope, ms.length)}
        ${categoriesCard(all, scope)}
        <section class="card"><h2>Payments<span class="hint" id="count"></span></h2>
          <div class="search"><input id="q" type="search" placeholder="Search place or description" value="${h(S.q)}" autocomplete="off"></div>
          <div id="paylist"></div></section>
      </main>
      <button class="fab" data-act="cash">+ Cash</button>`;
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
    const p = document.getElementById("pill"); if (!p) return;
    const n = S.pending.length;
    const [cls, text] = S.busy ? ["busy", "Syncing"] : S.error ? ["bad", "Offline"] : n ? ["wait", `${n} waiting`]
      : S.lastSync ? ["ok", "Synced"] : ["", "Sync"];
    p.innerHTML = `<span class="dot ${cls}"></span>${text}`;
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
      case "syncinfo": syncSheet(); break;
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
    openSheet(`<h3>Sync</h3><p class="subtitle">Your data is encrypted with your passphrase before it leaves the phone.</p>
      <div class="info"><div>Last synced: <b>${when}</b></div><div>Data from Windows: <b>${fromWin}</b></div>
      <div>${n ? `<b>${n}</b> change${n === 1 ? "" : "s"} waiting for the Windows app (applied when it next opens or syncs)` : "No changes waiting"}</div>
      ${S.error ? `<div class="error" style="margin:8px 0 0">${h(S.error)}</div>` : ""}</div>
      <div class="buttons"><button class="btn primary" data-a="sync">Sync now</button></div>
      <div class="buttons"><button class="btn danger" data-a="forget">Forget this phone</button></div>`, sh => {
      sh.addEventListener("click", async e => {
        const a = e.target.closest("[data-a]"); if (!a) return;
        if (a.dataset.a === "sync") { closeSheet(); await syncNow(); if (!S.error) toast("Synced"); }
        if (a.dataset.a === "forget" && await confirmSheet("Forget this phone?",
          (n ? `${n} change${n === 1 ? "" : "s"} not synced yet will be lost. ` : "") + "Your data stays on Windows and GitHub; set up again with the QR code.", "Forget", true)) {
          store.clear(); Object.assign(S, { creds: null, snapshot: null, pending: [], lastSync: null, error: "" }); render();
        }
      });
    });
  }

  /* ---------- sync ---------- */
  async function syncNow() {
    if (!S.creds || S.busy) { pill(); return; }
    if (!navigator.onLine) { S.error = "Offline - your changes are kept and sent when you're online."; pill(); return; }
    S.busy = true; pill();
    const sent = S.pending.slice();
    try {
      const r = await BT.sync(new BT.GitHub(S.creds.token), S.creds.gist, S.creds.pass, sent);
      if (r.snapshot) S.snapshot = r.snapshot;
      const added = S.pending.filter(c => !sent.includes(c));   // made while this sync was running
      S.pending = r.pending.map(c => S.pending.find(x => x.id === c.id) || c).concat(added);
      S.lastSync = new Date().toISOString(); S.error = "";
      save();
      S.busy = false;
      if (editing() || sheetRoot.firstChild) { S.deferred = true; pill(); } else render();
      if (added.length) setTimeout(syncNow, 500);
    } catch (e) {
      S.busy = false;
      S.error = e instanceof BT.WrongPassphrase ? "The passphrase doesn't match the data any more (changed in the Windows app?). Forget this phone and set it up again."
        : e.status === 401 ? "GitHub refused the access token. Set up again from the Windows app."
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
  syncNow();
})();
