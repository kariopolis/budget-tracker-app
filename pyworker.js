/* Budget Tracker (iPhone) - reads bank statements on the phone.
   It runs the Windows app's own Python code (budget_core.py) with Pyodide: Python compiled to
   WebAssembly, so it runs inside the browser. Nothing leaves the phone while a statement is read.
   pylib.zip = budget_core.py + the PDF reader it uses (pdfplumber, pdfminer.six) + openpyxl. */
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
import json, budget_core as core
r = core.read_statement(pdf_path)
json.dumps({"bank": r["bank"], "warnings": r["warnings"], "ok": r["check"][0], "why": r["check"][1],
            "txns": [{"d": t["date"].isoformat(), "s": t["desc"], "a": t["amount"], "p": t.get("place") or "",
                      "b": t.get("balance")} for t in r["txns"]]})
`;

self.onmessage = async (e) => {
  const { id, name, data } = e.data;
  const progress = text => self.postMessage({ id, progress: text });
  try {
    let bootSeconds = 0;
    if (!booting) booting = boot(progress);
    bootSeconds = await booting;
    const t0 = performance.now();
    const safe = String(name || "statement.pdf").replace(/[^\w.\- ]+/g, "_");
    py.FS.writeFile(`/tmp/${safe}`, new Uint8Array(data));
    py.globals.set("pdf_path", `/tmp/${safe}`);
    const out = JSON.parse(py.runPython(READ));
    py.FS.unlink(`/tmp/${safe}`);
    self.postMessage({ id, result: { ...out, version, bootSeconds, readSeconds: (performance.now() - t0) / 1000 } });
  } catch (err) {
    booting = py ? booting : null;               // a failed start is tried again next time
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
