// =====================================================================
// Statement check (admins): a vendor's statement next to QuickBooks.
// Add the statement (PDF, Excel or CSV) and a QuickBooks export for that
// vendor; the page lists every invoice that's missing, entered twice,
// a different amount, paid on one side but open on the other, and any
// payments QuickBooks hasn't applied. Nothing is saved; the result can be
// downloaded as a branded Excel file. Matching logic: js/statement-match.js
//   statements.html         live (admins only)
//   statements.html?demo    try it without signing in
// =====================================================================
(function () {
  const cfg = window.HH_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const DEMO = params.has("demo") || !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const TT = cfg.TIME_TRACKER_URL || "https://harmony-horticulture.github.io/time-tracker/";
  const M = window.StatementMatch;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n == null ? "" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const nice = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load " + src)); document.head.appendChild(s); });
    return loaded[src];
  }
  let toastTimer;
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), isError ? 7000 : 3200);
  }

  const state = { stmt: null, stmtFile: "", qb: null, qbFile: "", vendor: "", editing: false, result: null };

  // =====================================================================
  // Sign in (admins only)
  // =====================================================================
  let sb = null;
  async function me() {
    if (DEMO) return { full_name: "Demo Admin", role: "admin", active: true };
    sb = sb || window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    const res = await sb.from("profiles").select("id, email, full_name, role, active").eq("id", data.session.user.id).single();
    if (res.error) throw new Error(res.error.message);
    return res.data;
  }
  function showAuth(msg) {
    $("#loading").classList.add("hidden");
    $("#appView").classList.add("hidden");
    $("#authView").classList.remove("hidden");
    $("#authContent").innerHTML = `
      <h1>Sign in</h1>
      ${msg ? `<p class="error-text" style="text-align:center">${esc(msg)}</p>` : ""}
      <form id="signInForm">
        <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required></div>
        <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
        <button class="primary" type="submit">Sign in</button>
      </form>
      <p class="small muted" style="text-align:center;margin-top:14px">Same email and password as the Reports app and the Time Tracker.</p>`;
    $("#signInForm").onsubmit = async (e) => {
      e.preventDefault();
      const r = await sb.auth.signInWithPassword({ email: $("#em").value.trim(), password: $("#pw").value });
      if (r.error) return showAuth(/Invalid login/i.test(r.error.message) ? "That email and password don't match." : r.error.message);
      start();
    };
  }
  async function start() {
    let user;
    try { user = await me(); } catch (e) { return showAuth(e.message); }
    if (!user) return showAuth();
    if (!user.active) return showAuth("Your account is switched off. Ask an admin.");
    if (user.role !== "admin") return showAuth("The statement check is for admins.");
    $("#loading").classList.add("hidden");
    $("#authView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    $("#demoBanner").classList.toggle("hidden", !DEMO);
    $("#whoName").textContent = user.full_name || user.email;
    $("#whoRole").textContent = "Admin";
    const q = DEMO ? "?demo" : "";
    const tt = esc(TT);
    $("#sideNav").innerHTML = `<a class="nav-link" href="dashboard.html${q}">Dashboard</a>
      <a class="nav-link" href="leads.html${q}">Leads</a>
      <a class="nav-link active" href="statements.html${q}">Statement check</a>
      <a class="nav-link" href="flowers.html${q}">Flower planner</a>
      <a class="nav-link" href="index.html${q}">Reports</a>
      <a class="nav-link" href="sops.html${q}">SOPs</a>
      <a class="nav-link" href="${tt}">Time tracker ↗</a>
      <a class="nav-link" href="${tt}#people">People ↗</a>`;
    $("#bottomNav").innerHTML = `<a class="nav-link" href="dashboard.html${q}">Home</a><a class="nav-link" href="leads.html${q}">Leads</a><a class="nav-link active" href="statements.html${q}">Statements</a><a class="nav-link" href="index.html${q}">Reports</a>`;
    const out = async () => { if (sb) await sb.auth.signOut(); location.reload(); };
    $("#signOutBtn").onclick = out;
    $("#signOutBtnMobile").onclick = out;
    render();
  }

  // =====================================================================
  // Reading files
  // =====================================================================
  async function pdfLines(file) {
    await loadScript("vendor/pdfjs/pdf.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
    const doc = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      // Group the bits of text into printed lines by their height on the page
      const rows = [];
      tc.items.forEach((it) => {
        if (!it.str || !it.str.trim()) return;
        const x = it.transform[4], y = it.transform[5];
        let row = rows.find((r) => Math.abs(r.y - y) < 3);
        if (!row) { row = { y, parts: [] }; rows.push(row); }
        row.parts.push({ x, s: it.str });
      });
      rows.sort((a, b) => b.y - a.y).forEach((r) => lines.push(r.parts.sort((a, b) => a.x - b.x).map((x) => x.s).join("  ")));
    }
    return lines;
  }
  async function sheetRows(file) {
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") return [M.parseCSV(await file.text())];
    if (/\.xls$/i.test(file.name)) throw new Error("That's an old .xls file. Open it and save it as .xlsx, or export it from QuickBooks as Excel again.");
    const buf = await file.arrayBuffer();
    try { return (await window.XlsxLite.read(buf)).map((s) => s.rows); }
    catch (e) {
      await loadScript("vendor/exceljs.min.js");
      const wb = new window.ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      return wb.worksheets.map((ws) => {
        const rows = [];
        ws.eachRow({ includeEmpty: false }, (r) => {
          const out = [];
          for (let c = 1; c <= r.cellCount; c++) {
            let v = r.getCell(c).value;
            if (v && typeof v === "object" && !(v instanceof Date)) v = v.result !== undefined ? v.result : v.text || "";
            out.push(v == null ? "" : v);
          }
          rows.push(out);
        });
        return rows;
      });
    }
  }
  async function readStatement(file) {
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      const lines = await pdfLines(file);
      const p = M.parseStatementLines(lines);
      if (!p.lines.length) throw new Error("No invoice lines found in that PDF. If it's a scanned picture, ask the vendor for the statement as a PDF or Excel file.");
      return p;
    }
    const sheets = await sheetRows(file);
    let best = null;
    sheets.forEach((rows) => { const p = M.parseStatementRows(rows); if (!best || p.lines.length > best.lines.length) best = p; });
    if (!best || !best.lines.length) throw new Error((best && best.error) || "No invoice lines found in that file.");
    return best;
  }
  async function readQuickBooks(file) {
    const sheets = await sheetRows(file);
    let best = null;
    sheets.forEach((rows) => { const p = M.parseQuickBooks(rows); if (!best || p.items.length > best.items.length) best = p; });
    if (!best || !best.items.length) throw new Error((best && best.error) || "No transactions found in that file.");
    return best;
  }

  // =====================================================================
  // The page
  // =====================================================================
  const TONE = { ok: "approved", warn: "new", bad: "pending", muted: "sent" };
  const badge = (tone, text) => `<span class="badge ${TONE[tone] || "sent"}">${esc(text)}</span>`;

  function compute() {
    state.result = null;
    if (!state.stmt || !state.qb) return;
    const items = state.vendor ? state.qb.items.filter((x) => x.vendor === state.vendor || !x.vendor) : state.qb.items;
    state.result = M.reconcile(state.stmt.lines, items, { openOnly: state.qb.openOnly, statementDate: state.stmt.statementDate });
  }

  function render() {
    const s = state.stmt, q = state.qb;
    $("#view").innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Admin · before you pay a vendor</p><h1>Statement check</h1></div></div>
      <div class="card">
        <p class="muted small" style="margin-top:0">Add the vendor's statement and a QuickBooks report for the same vendor. The app checks every invoice against QuickBooks and lists anything that's missing, entered twice, a different amount, or paid on one side but still open on the other. Nothing is saved or changed in QuickBooks.</p>
        <div class="st-steps">
          <div class="st-step">
            <h3>1. Vendor statement</h3>
            <label class="st-drop"><input type="file" id="stFile" accept=".pdf,.xlsx,.csv"><span>${s ? `<strong>${esc(state.stmtFile)}</strong><br>${s.lines.length} lines${s.vendor ? ` from ${esc(s.vendor)}` : ""}${s.statementNo ? `, statement #${esc(s.statementNo)}` : ""}${s.statementDate ? ` dated ${esc(nice(s.statementDate))}` : ""}. Choose another to replace it.` : "Choose the statement: PDF, Excel or CSV"}</span></label>
            ${s ? `<button type="button" class="ghost small" id="stEdit">${state.editing ? "Done checking lines" : "Check or fix the lines it read"}</button>` : ""}
          </div>
          <div class="st-step">
            <h3>2. From QuickBooks</h3>
            <label class="st-drop"><input type="file" id="qbFile" accept=".xlsx,.csv,.xls"><span>${q ? `<strong>${esc(state.qbFile)}</strong><br>${q.items.length} transactions${q.openOnly ? " (unpaid bills only)" : ""}. Choose another to replace it.` : "Choose a QuickBooks export (Excel or CSV)"}</span></label>
            ${q && q.vendors.length > 1 ? `<div class="field" style="margin-top:10px"><label for="vendorSel">Vendor in QuickBooks</label><select id="vendorSel"><option value="">Everyone in the file</option>${q.vendors.map((v) => `<option ${v === state.vendor ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>` : ""}
            ${!q ? `<p class="small muted">Best: <strong>Vendor Balance Detail</strong> or the vendor's own transaction list (Expenses &gt; Vendors &gt; the vendor &gt; Export). Also works: Transaction List by Vendor, Unpaid Bills, A/P Aging Detail.</p>` : ""}
          </div>
        </div>
      </div>
      <div id="stLines"></div>
      <div id="stResult"></div>`;

    $("#stFile").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        state.stmt = await readStatement(f); state.stmtFile = f.name;
        if (state.qb) state.vendor = M.guessVendor(state.stmt.vendor, state.qb.vendors) || state.vendor;
        compute(); render();
      } catch (err) { console.warn(err); toast(err.message || "Couldn't read that file.", true); }
    };
    $("#qbFile").onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        state.qb = await readQuickBooks(f); state.qbFile = f.name;
        state.vendor = M.guessVendor(state.stmt ? state.stmt.vendor : "", state.qb.vendors) || (state.qb.vendors.length === 1 ? state.qb.vendors[0] : "");
        compute(); render();
      } catch (err) { console.warn(err); toast(err.message || "Couldn't read that file.", true); }
    };
    if ($("#vendorSel")) $("#vendorSel").onchange = (e) => { state.vendor = e.target.value; compute(); render(); };
    if ($("#stEdit")) $("#stEdit").onclick = () => { state.editing = !state.editing; compute(); render(); };
    if (state.editing && s) renderLines();
    renderResult();
  }

  // The statement lines as read, editable, for PDFs that didn't read perfectly
  function renderLines() {
    const s = state.stmt;
    $("#stLines").innerHTML = `
      <div class="card">
        <h2 style="margin-top:0">Lines read from the statement</h2>
        <p class="small muted">Fix anything that was read wrong. Kind: invoice or payment. "Vendor received" is what the vendor shows as paid on that invoice.</p>
        <div class="table-wrap"><table class="st-edit">
          <thead><tr><th>Date</th><th>Kind</th><th>Invoice #</th><th>Description</th><th class="num">Amount</th><th class="num">Vendor received</th><th></th></tr></thead>
          <tbody>${s.lines.map((l, i) => `<tr data-i="${i}">
            <td><input type="date" data-k="date" value="${esc(l.date)}"></td>
            <td><select data-k="kind">${["invoice", "payment", "credit", "balance"].map((k) => `<option ${k === l.kind ? "selected" : ""}>${k}</option>`).join("")}</select></td>
            <td><input data-k="ref" value="${esc(l.ref)}" style="width:110px"></td>
            <td><input data-k="description" value="${esc(l.description)}"></td>
            <td><input data-k="amount" type="number" step="0.01" value="${l.amount}" style="width:110px;text-align:right"></td>
            <td><input data-k="received" type="number" step="0.01" value="${l.received == null ? "" : l.received}" style="width:110px;text-align:right"></td>
            <td><button type="button" class="ghost small" data-del aria-label="Remove line">✕</button></td></tr>`).join("")}</tbody>
        </table></div>
        <button type="button" class="secondary small" id="stAdd" style="margin-top:10px">+ Add a line</button>
      </div>`;
    $$(".st-edit [data-k]").forEach((el) => (el.onchange = () => {
      const l = s.lines[Number(el.closest("tr").dataset.i)];
      const k = el.dataset.k;
      l[k] = k === "amount" ? Number(el.value) || 0 : k === "received" ? (el.value === "" ? null : Number(el.value)) : el.value;
      compute(); renderResult();
    }));
    $$(".st-edit [data-del]").forEach((b) => (b.onclick = () => { s.lines.splice(Number(b.closest("tr").dataset.i), 1); compute(); renderLines(); renderResult(); }));
    $("#stAdd").onclick = () => { s.lines.push({ date: s.statementDate || "", kind: "invoice", ref: "", description: "", amount: 0, received: null }); renderLines(); };
  }

  function renderResult() {
    const r = state.result;
    const el = $("#stResult");
    if (!r) { el.innerHTML = state.stmt || state.qb ? `<div class="card"><p class="muted" style="margin:0">Add ${state.stmt ? "the QuickBooks report" : "the vendor's statement"} to see the check.</p></div>` : ""; return; }
    const t = r.totals;
    const issues = r.rows.filter((x) => x.tone === "bad" || x.tone === "warn");
    const payIssues = r.payRows.filter((x) => x.tone === "bad" || x.tone === "warn");
    const gapTone = t.gap != null && Math.abs(t.gap) > 0.005 ? "var(--pink)" : "var(--leaf)";
    const sRow = (x) => {
      const b = x.qb[0];
      return `<tr>
        <td style="white-space:nowrap">${esc(nice(x.s ? x.s.date : b.date))}</td>
        <td>${esc(x.s ? x.s.ref : "")}</td>
        <td class="small">${esc(x.s ? x.s.description : b.memo)}</td>
        <td class="num">${x.s ? money(x.s.amount) : ""}</td>
        <td class="num">${x.stOpen != null ? money(x.stOpen) : ""}</td>
        <td class="small">${x.qb.map((y) => `${esc(y.num || "no number")} · ${money(y.amount)}${y.open != null ? ` · ${money(y.open)} open` : ""}`).join("<br>")}</td>
        <td>${badge(x.tone, x.status)}${x.note ? `<div class="small muted" style="margin-top:4px">${esc(x.note)}</div>` : ""}</td></tr>`;
    };
    const head = `<thead><tr><th>Date</th><th>Invoice #</th><th>Description</th><th class="num">Statement</th><th class="num">Vendor says open</th><th>QuickBooks</th><th>Result</th></tr></thead>`;
    el.innerHTML = `
      <div class="stat-row">
        <div class="stat"><div class="label">Vendor says you owe</div><div class="num">${money(t.stOpen)}</div></div>
        <div class="stat"><div class="label">QuickBooks shows open</div><div class="num">${t.qbOpen == null ? "–" : money(t.qbOpen)}</div></div>
        <div class="stat" style="border-left-color:${gapTone}"><div class="label">Difference</div><div class="num">${t.gap == null ? "–" : money(t.gap)}</div></div>
        <div class="stat" style="border-left-color:${t.unapplied ? "var(--pink)" : "var(--leaf)"}"><div class="label">Payments not applied in QuickBooks</div><div class="num">${money(-t.unapplied)}</div></div>
      </div>
      <div class="card">
        <div class="btn-row" style="margin-bottom:12px"><h2 style="margin:0;flex:1">${issues.length + payIssues.length ? `${issues.length + payIssues.length} ${issues.length + payIssues.length === 1 ? "thing" : "things"} to check` : "Everything matches"}</h2>
          <button type="button" id="stDownload">Download Excel</button></div>
        ${t.qbOpen == null ? `<p class="small muted">This QuickBooks report doesn't show open balances, so only invoices and amounts are compared. Use Vendor Balance Detail or the vendor's transaction list to compare what's still owed.</p>` : ""}
        ${issues.length ? `<div class="table-wrap"><table>${head}<tbody>${issues.map(sRow).join("")}</tbody></table></div>` : `<p class="muted">Every invoice on the statement matches QuickBooks.</p>`}
      </div>
      ${r.unapplied.length ? `<div class="card"><h2 style="margin-top:0">Payments QuickBooks hasn't applied to a bill</h2>
        <p class="small muted">These payments are in QuickBooks but not matched to bills, so bills they paid can still show as open. Apply each one to the bills it paid (the vendor's statement shows which).</p>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th class="num">Payment</th><th class="num">Not applied</th></tr></thead>
        <tbody>${r.unapplied.map((x) => `<tr><td>${esc(nice(x.date))}</td><td>${esc(x.type)}</td><td>${esc(x.num)}</td><td class="num">${money(x.amount)}</td><td class="num">${money(-x.open)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      ${r.payRows.length ? `<div class="card"><h2 style="margin-top:0">Payments</h2>
        <div class="table-wrap"><table><thead><tr><th>Statement</th><th class="num">Amount</th><th>QuickBooks</th><th>Result</th></tr></thead>
        <tbody>${r.payRows.map((x) => `<tr><td>${x.s ? `${esc(nice(x.s.date))} ${esc(x.s.description)}` : ""}</td><td class="num">${money(Math.abs(x.s ? x.s.amount : x.qb.amount))}</td><td>${x.qb ? `${esc(nice(x.qb.date))} · ${esc(x.qb.type)} ${esc(x.qb.num)}` : ""}</td><td>${badge(x.tone, x.status)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      <details class="card"><summary style="cursor:pointer;font-weight:600">Every invoice (${r.rows.length})</summary>
        <div class="table-wrap" style="margin-top:12px"><table>${head}<tbody>${r.rows.map(sRow).join("")}</tbody></table></div></details>`;
    $("#stDownload").onclick = () => downloadExcel().catch((e) => { console.warn(e); toast("Couldn't make the Excel file. " + e.message, true); });
  }

  // =====================================================================
  // Branded Excel download
  // =====================================================================
  async function logoB64() {
    const buf = await (await fetch("assets/logo.png")).arrayBuffer();
    let bin = "";
    new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }
  async function downloadExcel() {
    await loadScript("vendor/exceljs.min.js");
    const r = state.result, s = state.stmt, t = r.totals;
    const vendor = state.vendor || s.vendor || "Vendor";
    const wb = new window.ExcelJS.Workbook();
    wb.creator = "Harmony Horticulture";
    const logo = wb.addImage({ base64: await logoB64(), extension: "png" });
    const F = "Montserrat", BROWN = "FF5F351B", PINK = "FFF065A5", GREEN = "FF009344", PANEL = "FFF2F2F2";
    const sub = `${vendor}${s.statementNo ? ` · statement #${s.statementNo}` : ""}${s.statementDate ? ` dated ${nice(s.statementDate)}` : ""}`;
    function sheet(name, title, cols, rows) {
      const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
        pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        headerFooter: { oddFooter: '&L&"Montserrat"&8Harmony Horticulture&R&"Montserrat"&8Page &P of &N' } });
      ws.columns = cols.map((c) => ({ width: c.w }));
      ws.addImage(logo, { tl: { col: 0.15, row: 0.15 }, ext: { width: 131, height: 96 } });
      for (let i = 1; i <= 5; i++) ws.getRow(i).height = i === 5 ? 12 : 21;
      const tc = cols.length > 2 ? 3 : 2;
      Object.assign(ws.getCell(2, tc), { value: title.toUpperCase(), font: { name: F, size: 16, color: { argb: BROWN } } });
      Object.assign(ws.getCell(3, tc), { value: sub.toUpperCase(), font: { name: F, size: 9, bold: true, color: { argb: PINK } } });
      Object.assign(ws.getCell(4, tc), { value: `Prepared ${new Date().toLocaleDateString("en-US")}`, font: { name: F, size: 8, color: { argb: "FF595959" } } });
      const h = ws.getRow(6);
      cols.forEach((c, i) => Object.assign(h.getCell(i + 1), { value: c.h, font: { name: F, size: 10, bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: BROWN } }, alignment: { vertical: "middle", wrapText: true, horizontal: c.money ? "right" : "left" } }));
      h.height = 22;
      rows.forEach((row, ri) => {
        const xr = ws.getRow(7 + ri);
        cols.forEach((c, i) => {
          const cell = xr.getCell(i + 1);
          cell.value = row[i] === undefined || row[i] === "" ? null : row[i];
          cell.font = { name: F, size: 10, bold: !!row.bold, color: { argb: row.bold ? BROWN : "FF1A1A1A" } };
          cell.alignment = { vertical: "top", wrapText: !!c.wrap, horizontal: c.money ? "right" : "left" };
          if (c.money) cell.numFmt = '"$"#,##0.00;-"$"#,##0.00';
          if (c.date) cell.numFmt = "mm/dd/yyyy";
          if (ri % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PANEL } };
          if (row.bold) cell.border = { top: { style: "medium", color: { argb: GREEN } } };
        });
      });
      if (!rows.length) Object.assign(ws.getCell(7, 1), { value: "Nothing to list.", font: { name: F, size: 10, italic: true } });
      return ws;
    }
    const d = (iso) => (iso ? new Date(iso + "T12:00:00") : null);
    sheet("Summary", "Statement check", [{ h: "", w: 44 }, { h: "", w: 18, money: true }], [
      ["Vendor's statement: invoiced", t.stInvoiced], ["Vendor's statement: received", t.stReceived], ...(t.balanceFwd ? [["Balance forward", t.balanceFwd]] : []),
      ["Vendor says you owe", t.stOpen], ...(t.qbOpen != null ? [["QuickBooks shows open", t.qbOpen], Object.assign(["Difference", t.gap], { bold: true })] : []),
      ["Payments not applied to bills in QuickBooks", -t.unapplied], ["Invoices missing or not open in QuickBooks", t.missing], ["Extra copies of bills in QuickBooks", t.duplicates],
      ["QuickBooks bills not on the statement", t.notOnStatement], ["Things to check", String(t.issues)],
    ]);
    const invCols = [{ h: "Date", w: 12, date: true }, { h: "Invoice #", w: 12 }, { h: "Description", w: 34, wrap: true }, { h: "Statement", w: 13, money: true }, { h: "Vendor says open", w: 14, money: true },
      { h: "QuickBooks #", w: 16, wrap: true }, { h: "QuickBooks amount", w: 14, money: true }, { h: "QuickBooks open", w: 14, money: true }, { h: "Result", w: 30, wrap: true }, { h: "What to do", w: 50, wrap: true }];
    const invRow = (x) => [d(x.s ? x.s.date : x.qb[0].date), x.s ? x.s.ref : "", x.s ? x.s.description : x.qb[0].memo, x.s ? x.s.amount : null, x.stOpen,
      x.qb.map((y) => y.num || "no number").join(", "), x.qb.length ? x.qb.reduce((a, y) => a + y.amount, 0) : null, x.qb.some((y) => y.open != null) ? x.qb.reduce((a, y) => a + (y.open || 0), 0) : null, x.status, x.note];
    sheet("To check", "Things to check", invCols, r.rows.filter((x) => x.tone === "bad" || x.tone === "warn").map(invRow));
    if (r.unapplied.length) sheet("Unapplied payments", "Payments not applied", [{ h: "Date", w: 12, date: true }, { h: "Type", w: 24 }, { h: "Reference", w: 18 }, { h: "Payment", w: 14, money: true }, { h: "Not applied", w: 14, money: true }],
      r.unapplied.map((x) => [d(x.date), x.type, x.num, x.amount, -x.open]));
    if (r.payRows.length) sheet("Payments", "Payments", [{ h: "Statement date", w: 14, date: true }, { h: "Statement", w: 30, wrap: true }, { h: "Amount", w: 14, money: true }, { h: "QuickBooks date", w: 14, date: true }, { h: "QuickBooks", w: 30, wrap: true }, { h: "Result", w: 30 }],
      r.payRows.map((x) => [x.s ? d(x.s.date) : null, x.s ? x.s.description : "", Math.abs(x.s ? x.s.amount : x.qb.amount), x.qb ? d(x.qb.date) : null, x.qb ? `${x.qb.type} ${x.qb.num}` : "", x.status]));
    sheet("Every invoice", "Every invoice", invCols, r.rows.map(invRow));
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `${vendor.replace(/[\\/:*?"<>|]+/g, "")} Statement${s.statementNo ? " " + s.statementNo : ""} Check.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  start();
})();
