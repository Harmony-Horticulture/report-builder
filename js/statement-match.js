// =====================================================================
// Vendor statement checker: the matching logic (no screens).
//  - parseStatementLines: text lines of a vendor statement PDF -> lines
//  - parseStatementRows:  rows of a statement saved as Excel/CSV -> lines
//  - parseQuickBooks:     rows of a QuickBooks export -> transactions
//  - reconcile:           statement lines vs QuickBooks -> findings
// Works in the browser (window.StatementMatch) and in Node (for tests).
// =====================================================================
(function (root) {
  const clean = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
  const pad = (n) => String(n).padStart(2, "0");
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const mdy = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
  const usd = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MONEY_RE = /\(?-?\$?\d{1,3}(?:,\d{3})*\.\d{2}\)?|\(?-?\$?\d+\.\d{2}\)?/g;
  const DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;

  function money(v) {
    if (typeof v === "number") return v;
    const s = clean(v);
    if (!s) return null;
    const neg = /^\(.*\)$/.test(s) || /-/.test(s);
    const n = Number(s.replace(/[^0-9.]/g, ""));
    if (!/\d/.test(s) || isNaN(n)) return null;
    return neg ? -n : n;
  }
  function toISO(v) {
    if (v == null || v === "") return "";
    if (v instanceof Date && !isNaN(v)) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    if (typeof v === "number" && v > 20000 && v < 80000) return toISO(new Date(Date.UTC(1899, 11, 30) + v * 864e5));
    const s = clean(v);
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(DATE_RE);
    if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(m[1])}-${pad(m[2])}`;
    return "";
  }
  // "#06336", "INV-6336", "6336" -> "6336"
  const numKey = (v) => clean(v).replace(/^.*?#\s*/, "").replace(/[^0-9a-z]/gi, "").replace(/^0+/, "").toLowerCase();
  const days = (a, b) => (a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / 864e5 : 999);
  const oneDigitOff = (a, b) => {
    if (!a || !b || a.length !== b.length || a.length < 3) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d === 1;
  };

  // ---------------------------------------------------------------
  // Statement PDF text, one string per printed line
  // ---------------------------------------------------------------
  function parseStatementLines(textLines) {
    const out = [];
    let second = "received"; // what the second money column means
    let inPayments = false;
    let last = null;
    let vendor = "", statementDate = "", statementNo = "";
    textLines.forEach((raw, idx) => {
      const line = clean(raw);
      if (!line) return;
      if (!vendor && idx < 8 && !/statement|^date|:$/i.test(line) && /[a-z]{3}/i.test(line) && !DATE_RE.test(line)) vendor = line.replace(/^(please remit to|remit to|from):?\s*/i, "");
      const sn = line.match(/statement\s*(?:no\.?|#|number)\s*:?\s*(\w+)/i);
      if (sn) statementNo = sn[1];
      const lower = line.toLowerCase();
      // Header rows tell us what the columns mean
      if (!DATE_RE.test(line) || /^date\b/i.test(line)) {
        if (/received|paid/.test(lower) && /amount/.test(lower)) { second = "received"; inPayments = false; }
        else if (/balance/.test(lower) && /amount/.test(lower)) { second = "balance"; inPayments = false; }
        if (/^payment\b/.test(lower) || /payments? (date|received)/.test(lower)) { inPayments = true; second = "balance"; }
        const sd = line.match(/(?:statement )?date:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
        if (sd && !statementDate) statementDate = toISO(sd[1]);
        // A continuation line: more description, or the amount that wrapped
        if (/total|balance|page \d/i.test(lower)) { if (!(last && last.dangling)) last = null; }
        if (last) {
          const amts = line.match(MONEY_RE);
          if (last.dangling && amts) { last.amount = -Math.abs(money(amts[0])); last.dangling = false; }
          else if (!amts && line.length < 80) last.description = clean(last.description + " " + line);
        }
        return;
      }
      const dm = line.match(DATE_RE);
      if (line.indexOf(dm[0]) > 12) return; // a date in the middle of a sentence
      if (/balance forward|previous balance|beginning balance/i.test(line) || /^\s*balance\b/i.test(line.slice(line.indexOf(dm[0]) + dm[0].length))) {
        const a = line.match(MONEY_RE);
        out.push({ date: toISO(dm[0]), kind: "balance", ref: "", description: "Balance forward", amount: a ? money(a[0]) : 0, received: null });
        last = null;
        return;
      }
      let rest = line.slice(line.indexOf(dm[0]) + dm[0].length);
      const amts = (rest.match(MONEY_RE) || []).map(money);
      // "-" on its own: the amount wrapped onto the next line (seen on Controlled Rain)
      const dangling = /(^|\s)-(\s|$)/.test(rest.replace(MONEY_RE, " "));
      let ref = "";
      const inv = rest.match(/(?:invoice|inv|bill|payment|pmt|credit memo)\s*(?:no\.?|#)\s*:?\s*([\w-]+)/i) || rest.match(/#\s*([\w-]+)/);
      if (inv) ref = inv[1];
      else {
        const tok = rest.replace(MONEY_RE, " ").replace(new RegExp(DATE_RE.source, "g"), " ").match(/\b\d{4,}\b/);
        if (tok) ref = tok[0];
      }
      let description = clean(rest.replace(MONEY_RE, " ").replace(new RegExp(DATE_RE.source, "g"), " ").replace(/invoice\s*#\s*[\w-]+:?/i, "").replace(ref, "").replace(/\s-\s*$/, ""));
      const isPayment = inPayments || /\bpayment|\bpmt\b|\bcheck\b|credit ?card|zelle|\bach\b/i.test(rest) || (amts[0] != null && amts[0] < 0);
      const amount = dangling ? null : amts.length ? amts[0] : 0;
      const row = {
        date: toISO(dm[0]), kind: isPayment ? "payment" : (/credit/i.test(rest) ? "credit" : "invoice"), ref, description,
        amount: amount == null ? 0 : (isPayment ? -Math.abs(amount) : amount),
        received: second === "received" && amts.length > 1 ? amts[1] : null,
        voided: /void/i.test(rest), dangling: amount == null,
      };
      out.push(row);
      last = row;
    });
    out.forEach((r) => delete r.dangling);
    return { lines: out.filter((r) => r.kind !== "balance" || r.amount), vendor, statementDate, statementNo };
  }

  // ---------------------------------------------------------------
  // Statement saved as Excel/CSV: Date, Invoice/Ref, Description, Amount, Received/Paid/Open
  // ---------------------------------------------------------------
  function findHeader(rows, need) {
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const cells = rows[i].map((c) => clean(c).toLowerCase());
      if (need.every((re) => cells.some((c) => re.test(c)))) return { i, cells };
    }
    return null;
  }
  const col = (cells, re) => cells.findIndex((c) => re.test(c));

  function parseStatementRows(rows) {
    const h = findHeader(rows, [/date/, /amount|total|charges|debit/]);
    if (!h) return { lines: [], error: "Couldn't find a Date and an Amount column in that file." };
    const c = {
      date: col(h.cells, /date/), ref: col(h.cells, /invoice|^ref|num|no\.?$|number|#/), desc: col(h.cells, /desc|activity|memo|detail|customer|job/),
      amount: col(h.cells, /^amount|^total|charges|debit|original/), received: col(h.cells, /received|paid|payment|credit/), open: col(h.cells, /open|due|balance due|remaining/),
    };
    const lines = [];
    for (let i = h.i + 1; i < rows.length; i++) {
      const r = rows[i];
      const date = toISO(r[c.date]);
      if (!date) continue;
      const text = clean(r.join(" "));
      const amount = money(r[c.amount]);
      if (amount == null && c.received < 0) continue;
      const received = c.received >= 0 ? money(r[c.received]) : (c.open >= 0 && amount != null ? amount - (money(r[c.open]) || 0) : null);
      const isPayment = /payment|check|zelle|credit ?card|\bach\b/i.test(text) && !/invoice/i.test(text);
      lines.push({ date, kind: isPayment ? "payment" : "invoice", ref: c.ref >= 0 ? clean(r[c.ref]).replace(/^.*#\s*/, "") : "", description: c.desc >= 0 ? clean(r[c.desc]) : "",
        amount: isPayment ? -Math.abs(amount || received || 0) : amount || 0, received: isPayment ? null : received, voided: /void/i.test(text) });
    }
    return { lines };
  }

  // ---------------------------------------------------------------
  // QuickBooks exports: Transaction List by Vendor, Unpaid Bills, Vendor
  // Balance Detail, A/P Aging Detail, Bill Payment List, or the vendor's
  // transaction list (.csv). Vendor names come from a column or from the
  // group heading rows QuickBooks puts above each vendor.
  // ---------------------------------------------------------------
  function parseQuickBooks(rows) {
    const h = findHeader(rows, [/^date$|transaction date/, /^(num|no\.?|ref ?no\.?|document number|check ?#?)$/]) || findHeader(rows, [/^date$|transaction date/, /amount|total/]);
    if (!h) return { items: [], error: "Couldn't find the QuickBooks columns (Date and Num). Export the report from QuickBooks to Excel and try again." };
    const cells = h.cells;
    const c = {
      date: col(cells, /^date$|transaction date/), type: col(cells, /^(transaction )?type$/), num: col(cells, /^(num|no\.?|ref ?no\.?|document number|check ?#?)$/),
      vendor: col(cells, /vendor|^contact$|^payee$|^name$/), due: col(cells, /due date/), memo: col(cells, /memo|description/),
      amount: col(cells, /^(total )?amount$|^total$/), open: col(cells, /open balance|^balance$/), status: col(cells, /^status$/),
    };
    // "Balance" on Vendor Balance Detail is a running total, not this line's open amount
    if (c.open >= 0 && cells[c.open] === "balance" && cells.includes("open balance")) c.open = col(cells, /open balance/);
    if (c.open >= 0 && cells[c.open] === "balance" && !cells.some((x) => /total amount/.test(x))) c.open = -1;
    const items = [];
    let group = "";
    // The report's name, from the title rows QuickBooks puts above the headings
    const title = rows.slice(0, h.i).map((r) => r.map(clean).join(" ")).join(" ").toLowerCase();
    const openOnly = /unpaid bills|aging|balance detail/.test(title);
    const paymentsOnly = /bill payment list/.test(title);
    for (let i = h.i + 1; i < rows.length; i++) {
      const r = rows[i];
      const date = toISO(r[c.date]);
      const first = clean(r[0]);
      if (!date) {
        // A heading row like "American Tree & Plant Solutions" (not "Total for ...")
        const filled = r.filter((x) => clean(x) !== "");
        if (filled.length === 1 && first && !/^total|^\d+ - \d+|days past due|^current$|^grand/i.test(first)) group = first;
        continue;
      }
      const type = c.type >= 0 ? clean(r[c.type]) : "";
      const amount = money(r[c.amount]);
      if (amount == null) continue;
      const kind = paymentsOnly ? "payment" : /bill payment|payment|check|expense|credit card/i.test(type) && !/^bill$/i.test(type) ? (/credit$/i.test(type) && /vendor/i.test(type) ? "credit" : "payment")
        : /vendor credit/i.test(type) ? "credit" : /bill/i.test(type) || !type ? "bill" : "other";
      items.push({
        date, type: type || "Bill", kind, num: c.num >= 0 ? clean(r[c.num]) : "", vendor: c.vendor >= 0 ? clean(r[c.vendor]) || group : group,
        amount: round2(Math.abs(amount)), open: c.open >= 0 && money(r[c.open]) != null ? (kind === "bill" ? Math.abs(money(r[c.open])) : money(r[c.open])) : null, memo: c.memo >= 0 ? clean(r[c.memo]) : "",
        status: c.status >= 0 ? clean(r[c.status]) : "", row: i + 1,
      });
    }
    const vendors = Array.from(new Set(items.map((x) => x.vendor).filter(Boolean))).sort();
    return { items, vendors, hasOpen: c.open >= 0 || c.status >= 0, openOnly, report: openOnly ? "open bills" : paymentsOnly ? "payments" : "all" };
  }

  // Picks the QuickBooks vendor name that best matches the name on the statement
  function guessVendor(statementVendor, vendors) {
    const words = (s) => clean(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length > 2 && !/^(and|the|llc|inc|plant|solutions|company|services)$/.test(w));
    const sw = words(statementVendor);
    let best = null, score = 0;
    vendors.forEach((v) => {
      const s = words(v).filter((w) => sw.includes(w)).length;
      if (s > score) { score = s; best = v; }
    });
    return best || (vendors.length === 1 ? vendors[0] : "");
  }

  // ---------------------------------------------------------------
  // Statement vs QuickBooks
  // ---------------------------------------------------------------
  function reconcile(stmtLines, qbItems, opts = {}) {
    const invoices = stmtLines.filter((l) => l.kind === "invoice" || l.kind === "credit");
    const payments = stmtLines.filter((l) => l.kind === "payment");
    const bills = qbItems.filter((x) => x.kind === "bill" || x.kind === "credit");
    const qbPays = qbItems.filter((x) => x.kind === "payment");
    const used = new Set();
    const rows = [];
    const qbOpen = (b) => (b.open != null ? b.open : /paid/i.test(b.status) ? 0 : null);

    invoices.forEach((s) => {
      const key = numKey(s.ref);
      const amount = round2(s.amount);
      const stOpen = s.received == null ? null : round2(amount - s.received);
      const row = { s, qb: [], status: "", note: "", tone: "ok", amount, stOpen };
      if (s.voided || amount === 0) {
        const hits = bills.filter((b) => key && numKey(b.num) === key);
        hits.forEach((b) => used.add(b));
        row.qb = hits;
        if (hits.some((b) => b.amount > 0)) { row.status = "Voided or $0, but billed in QuickBooks"; row.tone = "bad"; row.note = "Check whether this bill should be voided in QuickBooks."; }
        else { row.status = "No charge"; row.tone = "muted"; }
        rows.push(row);
        return;
      }
      let hits = key ? bills.filter((b) => numKey(b.num) === key) : [];
      let via = "";
      if (!hits.length) {
        // Same amount within two weeks, with no number, or a number one digit off (a typo)
        const cand = bills.filter((b) => !used.has(b) && round2(b.amount) === amount && (!numKey(b.num) || oneDigitOff(numKey(b.num), key) || days(b.date, s.date) <= 14));
        cand.sort((a, b) => (oneDigitOff(numKey(b.num), key) - oneDigitOff(numKey(a.num), key)) || (!numKey(b.num) - !numKey(a.num)) || days(a.date, s.date) - days(b.date, s.date));
        if (cand.length && (oneDigitOff(numKey(cand[0].num), key) || !numKey(cand[0].num) || days(cand[0].date, s.date) <= 14)) {
          hits = [cand[0]];
          via = !numKey(cand[0].num) ? "nonum" : oneDigitOff(numKey(cand[0].num), key) ? "typo" : "amount";
        }
      }
      hits.forEach((b) => used.add(b));
      row.qb = hits;
      if (!hits.length && opts.openOnly) {
        // The QuickBooks file only lists unpaid bills, so a paid invoice won't be in it
        if (stOpen != null && stOpen <= 0.005) { row.status = "Paid"; row.tone = "ok"; row.note = "Paid per the vendor; not in the unpaid bills report, as expected."; }
        else { row.status = "Open per vendor, not open in QuickBooks"; row.tone = "bad"; row.note = "The vendor says this is unpaid, but QuickBooks doesn't list it as an unpaid bill. It's either missing from QuickBooks or marked paid there."; }
      }
      else if (!hits.length) { row.status = "Missing in QuickBooks"; row.tone = "bad"; row.note = "No bill in QuickBooks for this invoice."; }
      else if (hits.length > 1) {
        const extra = round2(hits.slice(1).reduce((t, b) => t + b.amount, 0));
        row.status = `In QuickBooks ${hits.length} times`; row.tone = "bad"; row.dupAmount = extra;
        row.note = `Entered ${hits.length} times (${hits.map((b) => `${b.num || "no number"} on ${mdy(b.date)}`).join(", ")}). The extra ${hits.length - 1 === 1 ? "copy is" : "copies are"} ${usd(extra)}.`;
      } else {
        const b = hits[0];
        const notes = [];
        if (round2(b.amount) !== amount) { row.status = "Amount differs"; row.tone = "bad"; notes.push(`QuickBooks has ${usd(b.amount)}, statement says ${usd(amount)}.`); }
        if (via === "typo") notes.push(`Entered in QuickBooks as #${b.num}.`);
        if (via === "nonum") notes.push("Entered in QuickBooks with no bill number.");
        if (via === "amount") notes.push(`Matched by amount; QuickBooks has it as #${b.num}.`);
        const o = qbOpen(b);
        if (!row.status && o != null && o < -0.005) { row.status = "Negative balance in QuickBooks"; row.tone = "bad"; notes.push(`QuickBooks shows -$${(-o).toFixed(2)} on this bill. A payment was probably applied to it twice or entered against the wrong bill.`); }
        if (!row.status && stOpen != null && o != null) {
          if (stOpen <= 0.005 && o > 0.005) { row.status = "Paid per vendor, open in QuickBooks"; row.tone = "warn"; notes.push(`QuickBooks still shows ${usd(o)} open. A payment probably isn't applied to this bill.`); }
          else if (stOpen > 0.005 && o <= 0.005) { row.status = "Open per vendor, paid in QuickBooks"; row.tone = "bad"; notes.push(`The vendor says ${usd(stOpen)} is still owed. Check the payment reached them.`); }
          else if (Math.abs(stOpen - o) > 0.005) { row.status = "Open amount differs"; row.tone = "warn"; notes.push(`Vendor says ${usd(stOpen)} open, QuickBooks ${usd(o)}.`); }
        }
        if (!row.status) { row.status = via ? "Matches (see note)" : "Matches"; row.tone = via ? "warn" : "ok"; }
        row.note = notes.join(" ");
      }
      rows.push(row);
    });

    // QuickBooks bills in the statement's dates that aren't on the statement
    const dates = invoices.map((s) => s.date).filter(Boolean).sort();
    const from = opts.from || dates[0], to = opts.to || dates[dates.length - 1];
    const extraBills = bills.filter((b) => !used.has(b) && b.amount > 0 && (opts.openOnly ? (b.open == null || b.open > 0.005) : true) && (!from || b.date >= from) && (!to || b.date <= addDays(to, 7)));
    extraBills.forEach((b) => {
      const twin = bills.find((x) => x !== b && round2(x.amount) === round2(b.amount) && numKey(x.num) && numKey(x.num) === numKey(b.num));
      rows.push({ s: null, qb: [b], amount: null, stOpen: null, tone: "bad", status: twin ? "Duplicate bill in QuickBooks" : "In QuickBooks, not on the statement",
        note: twin ? `Same number and amount as another bill.` : "The vendor doesn't list this bill. Check it isn't a duplicate or for another vendor." });
    });

    // Payments: statement payments vs QuickBooks payments, by amount and date
    const usedP = new Set();
    const payRows = payments.map((p) => {
      const amt = round2(Math.abs(p.amount));
      const cand = qbPays.filter((q) => !usedP.has(q) && round2(q.amount) === amt).sort((a, b) => days(a.date, p.date) - days(b.date, p.date))[0];
      if (cand && days(cand.date, p.date) <= 45) { usedP.add(cand); return { s: p, qb: cand, status: days(cand.date, p.date) > 5 ? "Matches, different date" : "Matches", tone: days(cand.date, p.date) > 5 ? "warn" : "ok" }; }
      return { s: p, qb: null, status: "Not in QuickBooks", tone: "bad" };
    });
    const pFrom = payments.length ? payments.map((p) => p.date).sort()[0] : from;
    qbPays.filter((q) => !usedP.has(q) && (!pFrom || q.date >= pFrom) && (!to || q.date <= addDays(opts.statementDate || to, 0)))
      .forEach((q) => payRows.push({ s: null, qb: q, status: payments.length ? "In QuickBooks, not on the statement" : "QuickBooks payment", tone: payments.length ? "warn" : "muted" }));

    // Payments QuickBooks hasn't applied to a bill (negative open balance)
    const unapplied = qbItems.filter((x) => x.open != null && x.open < -0.005);

    const sum = (list, f) => round2(list.reduce((t, x) => t + (f(x) || 0), 0));
    const stInvoiced = sum(invoices.filter((s) => !s.voided), (s) => s.amount);
    const stReceived = invoices.some((s) => s.received != null) ? sum(invoices, (s) => s.received) : sum(payments, (p) => -p.amount);
    const balanceFwd = sum(stmtLines.filter((l) => l.kind === "balance"), (l) => l.amount);
    const qbOpenTotal = qbItems.some((x) => x.open != null) ? sum(qbItems, (x) => x.open) : null;
    const totals = {
      stInvoiced, stReceived, balanceFwd, stOpen: round2(balanceFwd + stInvoiced - stReceived),
      qbBilled: sum(bills, (b) => (b.kind === "credit" ? -b.amount : b.amount)), qbOpen: qbOpenTotal, unapplied: sum(unapplied, (x) => x.open),
      missing: sum(rows.filter((r) => /^Missing|not open in QuickBooks/.test(r.status)), (r) => r.stOpen != null && /not open/.test(r.status) ? r.stOpen : r.amount),
      duplicates: sum(rows, (r) => r.dupAmount) + sum(rows.filter((r) => r.status === "Duplicate bill in QuickBooks"), (r) => r.qb[0].amount),
      notOnStatement: sum(rows.filter((r) => r.status === "In QuickBooks, not on the statement"), (r) => r.qb[0].amount),
      issues: rows.filter((r) => r.tone === "bad" || r.tone === "warn").length + payRows.filter((r) => r.tone === "bad" || r.tone === "warn").length,
    };
    if (totals.qbOpen != null) totals.gap = round2(totals.stOpen - totals.qbOpen);
    rows.sort((a, b) => ((a.s || {}).date || a.qb[0].date).localeCompare((b.s || {}).date || b.qb[0].date));
    return { rows, payRows, unapplied, totals, from, to };
  }
  function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  // A simple CSV reader (quoted fields, commas, new lines)
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", q = false;
    text = String(text).replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') q = false; else field += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => clean(c) !== ""));
  }

  const api = { money, toISO, numKey, parseStatementLines, parseStatementRows, parseQuickBooks, guessVendor, reconcile, parseCSV };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StatementMatch = api;
})(typeof window !== "undefined" ? window : globalThis);
