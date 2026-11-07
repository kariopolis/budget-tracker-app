/* Budget Tracker (iPhone) - reads bank statements on the phone.
   It runs the Windows app's own Python code (budget_core.py) with Pyodide: Python compiled to
   WebAssembly, so it runs inside the browser. Nothing leaves the phone while a statement is read.
   pylib.zip = budget_core.py + budget_merchants.py + the PDF reader they use (pdfplumber, pdfminer.six) + openpyxl.
   Messages: {id, op: "warm"} starts Python early; {id, op: "read", name, data, rules, settings} reads a statement
   and categorizes it with your rules (the same way Windows does). */
"use strict";

const PYODIDE_VERSIONS = ["0.27.7", "0.27.2", "0.26.4"];   // newest first; the first one that loads is used
let py = null, booting = null, version = null;

async function boot(progress) {
  const t0 = performance.now();
  for (const v of PYODIDE_VERSIONS) {
    try {
      importScripts(`https://cdn.jsdelivr.net/pyodide/v${v}/full/pyodide.js`);
      version = v;
      break;
    } catch (e) { /* not there: try the next one */ }
  }
  if (typeof loadPyodide !== "function") throw new Error("Could not download Pyodide (no connection?)");
  progress("Starting Python...");
  py = await loadPyodide();
  progress("Loading the PDF reader...");
  await py.loadPackage(["cryptography"]);
  const zip = await (await fetch("pylib.zip")).arrayBuffer();
  py.unpackArchive(zip, "zip", { extractDir: "/home/pyodide/lib" });
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide/lib'); import budget_core");
  return (performance.now() - t0) / 1000;
}

const READ = `
import json, budget_core as core, budget_merchants as merchants
r = core.read_statement(pdf_path)
cfg = json.loads(rules_json)
rset = cfg.get("settings") or {}
rules, type_map, order = core.read_rules([tuple(x) for x in cfg.get("rules") or []], rset)
if rset.get("tracks_cash"):
    type_map["cash"] = "Transfer"
names = dict(core.BUILTIN_CATS)
names.update({c.lower(): c for c, _ in order if c.lower() not in names})
names.update(core.merged_categories(rset))
out = []
for t in r["txns"]:
    cat = core.match_category(rules, t["desc"], t["amount"])
    if cat == "Other":
        hit = merchants.guess(t["desc"], t["amount"], None)
        if hit:
            cat = hit[0]
    cat = names.get(cat.lower(), cat)
    typ = "Income" if t["amount"] > 0 else "Expense"
    if cat.lower() != "other":
        typ = type_map.get(cat.lower(), typ)
    out.append({"k": list(core.tx_key(t)), "d": t["date"].isoformat(), "s": t["desc"], "a": t["amount"],
                "bal": t.get("balance"), "p": t.get("place") or "", "c": cat, "t": typ})
json.dumps({"bank": r["bank"], "warnings": r["warnings"], "ok": r["check"][0], "why": r["check"][1], "txns": out})
`;

self.onmessage = async (e) => {
  const { id, op, name, data, rules, settings } = e.data;
  const progress = text => self.postMessage({ id, progress: text });
  try {
    if (!booting) booting = boot(progress);
    const bootSeconds = await booting;
    if (op === "warm") { self.postMessage({ id, result: { ready: true, version } }); return; }
    const t0 = performance.now();
    const safe = String(name || "statement.pdf").replace(/[^\w.\- ]+/g, "_");
    py.FS.writeFile(`/tmp/${safe}`, new Uint8Array(data));
    py.globals.set("pdf_path", `/tmp/${safe}`);
    py.globals.set("rules_json", JSON.stringify({ rules: rules || [], settings: settings || {} }));
    let out;
    try { out = JSON.parse(py.runPython(READ)); } finally { try { py.FS.unlink(`/tmp/${safe}`); } catch (x) { /* gone */ } }
    self.postMessage({ id, result: { ...out, version, bootSeconds, readSeconds: (performance.now() - t0) / 1000 } });
  } catch (err) {
    if (!py) booting = null;                     // a failed start is tried again next time
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
