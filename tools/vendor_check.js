#!/usr/bin/env node
// =====================================================================
// Checks one vendor statement or invoice (from email) against QuickBooks,
// the same way the Statement check page does, and prints the result as
// JSON plus one SQL upsert for public.vendor_docs.
//
//   node tools/vendor_check.js --doc statement.pdf \
//     [--qb "HH Vendor Transactions.xlsx"] [--ap ap_detail.json] \
//     [--lines lines.json] [--vendor "Name from the email"] [--type invoice|statement] \
//     [--gmail-id ID] [--from sender@x.com] [--subject "..."] [--received 2026-11-25T14:00:00Z] [--url https://mail...]
//
// --qb:    a QuickBooks export (Transaction List by Vendor works best)
// --ap:    the latest A/P Aging Detail snapshot (finance_snapshots.data, kind ap_detail):
//          tells which bills are still open in QuickBooks
// --lines: the document's lines typed out, when the PDF can't be read:
//          [{ "kind": "invoice"|"payment"|"credit", "date": "2026-11-02", "ref": "6634", "amount": 120.5 }]
// Needs pdftotext (poppler) for PDFs.
// =====================================================================
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const M = require("../js/statement-match.js");

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { args[a.slice(2)] = process.argv[i + 1]; i++; }
}
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const usd = (n) => (n < 0 ? "-$" : "$") + Math.abs(r2(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function readRows(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".csv") return M.parseCSV(fs.readFileSync(file, "utf8"));
  // Excel: read with openpyxl (Python), dates as YYYY-MM-DD
  const py = "import sys,json,datetime,openpyxl\nws=openpyxl.load_workbook(sys.argv[1],data_only=True).active\n"
    + "f=lambda v: v.strftime('%Y-%m-%d') if isinstance(v,(datetime.date,datetime.datetime)) else v\n"
    + "print(json.dumps([[f(c) for c in r] for r in ws.iter_rows(values_only=True)],default=str))";
  return JSON.parse(execFileSync("python3", ["-I", "-c", py, file], { encoding: "utf8", maxBuffer: 100e6 }));
}

async function readDoc(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") {
    const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 50e6 });
    const lines = text.split("\n").map((s) => s.replace(/\s{2,}/g, "  ").trim()).filter(Boolean);
    return { ...M.parseStatementLines(lines), text };
  }
  return M.parseStatementRows(await readRows(file));
}

// A/P Aging Detail snapshot items -> QuickBooks items
function apItems(snap) {
  const items = (snap && (snap.items || (snap.data && snap.data.items))) || [];
  return items.map((x) => {
    const t = String(x.type || "Bill");
    const kind = /credit/i.test(t) ? "credit" : /payment|check/i.test(t) ? "payment" : "bill";
    return { date: x.date, type: t, kind, num: String(x.num || ""), vendor: x.name || "", amount: Math.abs(Number(x.amount) || 0),
      open: kind === "bill" ? Math.abs(Number(x.open) || 0) : Number(x.open) || 0, memo: "", status: "" };
  });
}

function sqlStr(v) { return v == null || v === "" ? "null" : "'" + String(v).replace(/'/g, "''") + "'"; }

(async () => {
  if (!args.doc && !args.lines) { console.error("Give --doc <file> or --lines <json>"); process.exit(2); }
  // 1. The document
  let doc = { lines: [], vendor: "", statementDate: "", statementNo: "" };
  if (args.doc) {
    try { doc = await readDoc(args.doc); } catch (e) { doc.error = String(e.message || e); }
  }
  if (args.lines) doc.lines = JSON.parse(fs.readFileSync(args.lines, "utf8")).map((l) => ({ kind: "invoice", ...l, amount: Number(l.amount) }));
  const invoices = doc.lines.filter((l) => l.kind === "invoice" || l.kind === "credit");
  const text = String(doc.text || "").toLowerCase();
  const type = args.type || (/statement/.test(text) || invoices.length > 1 || doc.lines.some((l) => l.kind === "payment" || l.kind === "balance") ? "statement" : "invoice");

  // 2. QuickBooks
  let qb = [], vendors = [], report = "";
  if (args.qb) { const q = M.parseQuickBooks(await readRows(args.qb)); qb = q.items || []; report = q.report; }
  const ap = args.ap ? apItems(JSON.parse(fs.readFileSync(args.ap, "utf8"))) : [];
  vendors = Array.from(new Set([...qb, ...ap].map((x) => x.vendor).filter(Boolean))).sort();
  const vendor = M.guessVendor(doc.vendor || args.vendor || "", vendors) || (args.vendor ? M.guessVendor(args.vendor, vendors) : "");
  const mine = (list) => list.filter((x) => x.vendor === vendor);
  let items = mine(qb), openOnly = false;
  const apMine = mine(ap);
  if (items.length && ap.length) {
    // The transaction list has every bill; the A/P report says which are still open
    const key = (x) => M.numKey(x.num) + "|" + r2(x.amount);
    const open = new Map(apMine.filter((x) => x.kind === "bill").map((x) => [key(x), x.open]));
    items = items.map((x) => (x.kind === "bill" ? { ...x, open: open.has(key(x)) ? open.get(key(x)) : 0 } : x));
    apMine.filter((x) => x.kind !== "bill" && x.open < -0.005).forEach((x) => items.push(x)); // unapplied payments
  } else if (!items.length && apMine.length) { items = apMine; openOnly = true; }
  else if (report === "open bills") openOnly = true;

  // 3. Compare
  const out = {
    doc_type: type, vendor: doc.vendor || args.vendor || "", qb_vendor: vendor, doc_no: doc.statementNo || (type === "invoice" && invoices[0] ? invoices[0].ref : ""),
    doc_date: doc.statementDate || (invoices[0] && invoices[0].date) || null, amount: null, status: "", issues: 0, summary: "", problems: [], lines: doc.lines.length,
    qb_source: [args.qb ? "transaction list" : "", args.ap ? "A/P aging" : ""].filter(Boolean).join(" + "),
  };
  if (!doc.lines.length) {
    out.status = "Couldn't read";
    out.summary = "Couldn't read the lines on this document. Open it on the Statement check page and check it by hand." + (doc.error ? ` (${doc.error})` : "");
  } else if (!vendors.length) {
    out.status = "Couldn't check";
    out.summary = "No QuickBooks report to check against (the A/P Aging Detail or HH Vendor Transactions email didn't come in).";
  } else if (!vendor) {
    out.status = "To check";
    out.summary = `Couldn't find ${out.vendor || "this vendor"} in QuickBooks. If it's a new vendor, add it and enter the bill.`;
    out.amount = r2(invoices.reduce((t, l) => t + (l.kind === "credit" ? -l.amount : l.amount), 0));
    out.issues = 1;
  } else {
    const res = M.reconcile(doc.lines, items, { openOnly, statementDate: doc.statementDate });
    const t = res.totals;
    let rows = res.rows;
    if (type === "invoice") rows = rows.filter((r) => r.s); // a single invoice: ignore the vendor's other bills
    const bad = rows.filter((r) => r.tone === "bad" || r.tone === "warn");
    const payBad = type === "statement" ? res.payRows.filter((r) => r.tone === "bad" || r.tone === "warn") : [];
    out.problems = [
      ...bad.map((r) => ({ status: r.status, ref: r.s ? r.s.ref : r.qb[0] && r.qb[0].num, date: r.s ? r.s.date : r.qb[0] && r.qb[0].date,
        amount: r.amount != null ? r.amount : r.qb[0] && r.qb[0].amount, qb: r.qb.map((b) => ({ num: b.num, date: b.date, amount: b.amount, open: b.open })), note: r.note || "" })),
      ...payBad.map((r) => ({ status: "Payment: " + r.status, ref: (r.s || r.qb || {}).ref || (r.qb || {}).num || "", date: (r.s || r.qb || {}).date, amount: Math.abs((r.s || r.qb || {}).amount || 0), note: r.note || "" })),
      ...(type === "statement" ? res.unapplied.map((x) => ({ status: "Payment not applied to a bill in QuickBooks", ref: x.num, date: x.date, amount: x.open, note: "" })) : []),
    ];
    out.issues = out.problems.length;
    out.status = out.issues ? "To check" : "Matches";
    if (type === "invoice") {
      const r = rows[0];
      out.amount = r ? r.amount : null;
      out.summary = !r ? "Nothing to compare." : r.tone === "ok" || r.tone === "muted" ? `Invoice ${r.s.ref} for ${usd(r.amount)} is in QuickBooks.`
        : /^Missing/.test(r.status) || /not open in QuickBooks/.test(r.status) ? `Invoice ${r.s.ref} for ${usd(r.amount)} isn't in QuickBooks yet. Enter the bill.`
        : `Invoice ${r.s.ref} for ${usd(r.amount)}: ${r.status}.${r.note ? " " + r.note : ""}`;
    } else {
      out.amount = t.stOpen;
      const parts = [`${vendor} says ${usd(t.stOpen)} is open` + (t.qbOpen != null ? `; QuickBooks shows ${usd(t.qbOpen)}` + (Math.abs(t.gap || 0) > 0.005 ? ` (${usd(t.gap)} apart)` : "") : "") + "."];
      if (t.missing) parts.push(`${usd(t.missing)} on the statement isn't open in QuickBooks.`);
      if (t.duplicates) parts.push(`${usd(t.duplicates)} looks entered twice.`);
      if (t.unapplied) parts.push(`${usd(Math.abs(t.unapplied))} of payments isn't applied to bills.`);
      parts.push(out.issues ? `${out.issues} line${out.issues === 1 ? "" : "s"} to check.` : "Everything matches.");
      out.summary = parts.join(" ");
      out.totals = t;
    }
  }

  const meta = { gmail_id: args["gmail-id"], from_email: args.from, subject: args.subject, received_at: args.received, email_url: args.url, file_name: args.doc ? path.basename(args.doc) : "typed lines" };
  out.sql = `insert into public.vendor_docs (gmail_id, file_name, received_at, from_email, subject, email_url, doc_type, vendor, qb_vendor, doc_no, doc_date, amount, status, issues, summary, result) values (`
    + [meta.gmail_id, meta.file_name, meta.received_at, meta.from_email, meta.subject, meta.email_url, out.doc_type, out.vendor, out.qb_vendor, out.doc_no, out.doc_date].map(sqlStr).join(", ")
    + `, ${out.amount == null ? "null" : out.amount}, ${sqlStr(out.status)}, ${out.issues}, ${sqlStr(out.summary)}, ${sqlStr(JSON.stringify({ problems: out.problems, totals: out.totals || null, qb_source: out.qb_source, lines: out.lines }))}::jsonb)`
    + ` on conflict (gmail_id, file_name) do update set doc_type = excluded.doc_type, vendor = excluded.vendor, qb_vendor = excluded.qb_vendor, doc_no = excluded.doc_no, doc_date = excluded.doc_date, amount = excluded.amount, status = excluded.status, issues = excluded.issues, summary = excluded.summary, result = excluded.result, checked_at = now();`;
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
