/* Budget Tracker (iPhone) - data, encryption and sync. No page code here, so it can be tested on its own.
   Encryption: AES-256-GCM (Advanced Encryption Standard, Galois/Counter Mode) with a key from your
   passphrase via PBKDF2 (Password-Based Key Derivation Function 2) - the same format the Windows app writes. */
"use strict";

const BT = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const API = "https://api.github.com";
  const BUDGET_FILE = "budget.enc";
  const PHONE_FILE = "phone.enc";
  const ITERATIONS = 200000;

  const b64 = {
    from(s) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; },
    to(bytes) { let s = ""; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); },
  };

  const keyCache = new Map();
  async function deriveKey(passphrase, salt, iterations) {
    const id = passphrase.length + ":" + b64.to(salt) + ":" + iterations;
    if (keyCache.has(id)) return keyCache.get(id);
    const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    keyCache.clear();
    keyCache.set(id, key);
    return key;
  }

  async function encrypt(obj, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, ITERATIONS);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
    return JSON.stringify({ v: 1, kdf: "pbkdf2-sha256", iter: ITERATIONS, salt: b64.to(salt), iv: b64.to(iv), ct: b64.to(ct) });
  }

  class WrongPassphrase extends Error {}

  async function decrypt(text, passphrase) {
    if (!text || !text.trim() || text.trim() === "{}") return null;
    const box = JSON.parse(text);
    const key = await deriveKey(passphrase, b64.from(box.salt), box.iter || ITERATIONS);
    try {
      const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.from(box.iv) }, key, b64.from(box.ct));
      return JSON.parse(dec.decode(data));
    } catch (e) {
      throw new WrongPassphrase("Wrong passphrase");
    }
  }

  function parseSetup(code) {
    const s = String(code || "").trim().replace(/^.*#setup=/, "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = s + "===".slice((s.length + 3) % 4);
    const obj = JSON.parse(dec.decode(b64.from(padded)));
    if (!obj.t || !obj.g) throw new Error("Not a setup code");
    return { token: obj.t, gist: obj.g };
  }

  class GitHub {
    constructor(token, api = API) { this.token = token; this.api = api; }
    async call(method, path, body) {
      const r = await fetch(path.startsWith("http") ? path : this.api + path, {
        method, cache: "no-store",
        headers: { Authorization: "Bearer " + this.token, Accept: "application/vnd.github+json",
          ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) {
        let msg = ""; try { msg = (await r.json()).message || ""; } catch (e) { /* not JSON */ }
        const err = new Error(r.status === 401 ? "GitHub refused the access token." :
          r.status === 404 ? "The sync data was not found on GitHub. Set up again from the Windows app." :
          `GitHub ${r.status} ${msg}`.trim());
        err.status = r.status;
        throw err;
      }
      return r.status === 204 ? null : r.json();
    }
    async readFiles(gist) {
      const g = await this.call("GET", `/gists/${gist}`);
      const out = {};
      for (const [name, f] of Object.entries(g.files || {})) {
        out[name] = f.truncated ? await (await fetch(f.raw_url, { cache: "no-store" })).text() : (f.content || "");
      }
      return out;
    }
    writeFile(gist, name, content) {
      return this.call("PATCH", `/gists/${gist}`, { files: { [name]: { content } } });
    }
  }

  /* ---------- data ---------- */
  const GROUP_OF = { Expense: "Spending", Income: "Income", Savings: "Savings and investments",
    Investment: "Savings and investments", Transfer: "Transfers between your own accounts" };
  const GROUP_ORDER = ["Spending", "Income", "Savings and investments", "Transfers between your own accounts"];

  function newId() {
    const b = crypto.getRandomValues(new Uint8Array(12));
    return "p" + Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  }

  const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* Payments as the phone shows them: the last data from Windows + your changes not applied there yet. */
  function viewTransactions(snapshot, pending) {
    let txns = (snapshot && snapshot.transactions ? snapshot.transactions : []).map(t => ({ ...t }));
    for (const c of pending || []) {
      if (c.op === "add_cash") {
        const x = c.tx;
        txns.push({ k: ["pending", c.id], d: x.d, p: x.s || x.c, s: x.s || x.c, a: x.a, c: x.c, t: x.t, b: "Cash",
          n: "Entered by hand", pending: true, change: c.id });
      } else if (c.op === "delete_cash") {
        txns = txns.filter(t => !sameKey(t.k, c.key));
      } else if (c.op === "edit") {
        for (const t of txns) if (sameKey(t.k, c.key)) { t.c = c.category; t.t = c.type; t.pending = true; }
      }
    }
    return txns.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  }

  const isCash = t => String(t.b || "").toLowerCase() === "cash";
  const monthOf = t => t.d.slice(0, 7);

  function monthTotals(txns, ym) {
    const s = { Income: 0, Expense: 0, Savings: 0, Investment: 0 };
    for (const t of txns) if (!ym || monthOf(t) === ym) if (t.t in s) s[t.t] += t.a;
    const r = v => Math.round(v * 100) / 100 + 0;
    const inc = r(s.Income), exp = r(-s.Expense), sav = r(-s.Savings), inv = r(-s.Investment);
    return { inc, exp, sav, inv, bal: r(inc - exp - sav - inv) };
  }

  function spendingByCategory(txns, ym) {
    const by = new Map();
    for (const t of txns) {
      if (t.t !== "Expense" || (ym && monthOf(t) !== ym)) continue;
      const c = t.c || "Other";
      by.set(c, (by.get(c) || 0) - t.a);
    }
    return [...by.entries()].filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]);
  }

  function months(txns) {
    return [...new Set(txns.map(monthOf))].sort();
  }

  function money(v, signed) {
    const text = "€" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v < -0.004) return "−" + text;
    return signed && v > 0.004 ? "+" + text : text;
  }

  function parseAmount(text) {
    let s = String(text || "").replace(/[€\s ]/g, "");
    if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else s = s.replace(",", ".");
    const v = Math.abs(Math.round(parseFloat(s) * 100) / 100);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  /* One sync round: read what Windows wrote, drop changes it has applied, upload the rest. */
  async function sync(gh, gist, passphrase, pending) {
    const files = await gh.readFiles(gist);
    const snapshot = await decrypt(files[BUDGET_FILE] || "", passphrase);
    const applied = new Set((snapshot && snapshot.applied) || []);
    const left = pending.filter(c => !applied.has(c.id));
    let phone = null;
    try { phone = await decrypt(files[PHONE_FILE] || "", passphrase); } catch (e) { phone = null; }
    const onGitHub = JSON.stringify((phone && phone.changes) || []);
    if (onGitHub !== JSON.stringify(left)) {
      await gh.writeFile(gist, PHONE_FILE, await encrypt({ v: 1, changes: left }, passphrase));
    }
    return { snapshot, pending: left };
  }

  return { b64, encrypt, decrypt, WrongPassphrase, parseSetup, GitHub, GROUP_OF, GROUP_ORDER, newId,
    viewTransactions, monthTotals, spendingByCategory, months, money, parseAmount, isCash, sameKey, sync,
    BUDGET_FILE, PHONE_FILE };
})();

if (typeof module !== "undefined") module.exports = BT;
