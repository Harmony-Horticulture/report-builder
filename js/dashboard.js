// =====================================================================
// Harmony Horticulture Dashboard: the admins' home page.
// One look at leads, reports and time tracking, which all live in the
// same database. Read-only: each item links to the app where it's done.
//   dashboard.html         live (admins only)
//   dashboard.html?demo    sample data, nothing real
// =====================================================================
(function () {
  const cfg = window.HH_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const DEMO = params.has("demo") || !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const TT = cfg.TIME_TRACKER_URL || "https://harmony-horticulture.github.io/time-tracker/";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const DAY = 864e5;

  const STAGES = [
    ["new", "New"], ["contacted", "Contacted"], ["intake_sent", "Waiting on intake form"],
    ["intake_received", "Intake received"], ["scheduled", "Site visit scheduled"],
    ["proposal_sent", "Proposal sent"], ["won", "Won"], ["lost", "Lost"],
  ];
  const STAGE = Object.fromEntries(STAGES);
  const OPEN = ["new", "contacted", "intake_sent", "intake_received", "scheduled", "proposal_sent"];
  const CHANNEL = { phone: "Phone call", text: "Text", email: "Email", website: "Website form", intake_form: "Intake form", referral: "Referral", other: "Other" };
  // Consultants paid by bill (their bills show up in A/P)
  const CONSULTANT_VENDORS = /Robbie Stephens|Kristen Battafarano|Sample Consulting/i;
  const ASSIGNEE = { kasey: "Kasey", krista: "Krista", robert: "Robbie", stephanie: "Stephanie" };

  const money = (n) => "$" + Math.round(n || 0).toLocaleString("en-US");
  const hrs = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString("en-US") + " hrs";
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  // reports.consultant is a saved copy of the author's profile ({ name, email, ... })
  const consultantName = (r) => (r.consultant && typeof r.consultant === "object" ? r.consultant.name : r.consultant) || "";
  const leadName = (l) => l.project_name || l.contact_name || l.company || l.email || l.phone || "No name";
  const niceDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: y === new Date().getFullYear() ? undefined : "numeric" });
  };
  const ago = (ts) => {
    const s = (Date.now() - new Date(ts).getTime()) / 1000;
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " hr ago";
    if (s < 7 * 86400) return Math.round(s / 86400) + (Math.round(s / 86400) === 1 ? " day ago" : " days ago");
    return niceDate(new Date(ts).toISOString());
  };
  // In the sample, links go to the sample Leads and Reports pages (the made-up items aren't in them)
  const Q = DEMO ? "?demo" : "";
  const leadLink = (id) => DEMO ? "leads.html?demo" : `leads.html#lead=${encodeURIComponent(id)}`;
  const reportLink = (r) => DEMO ? "index.html" : `index.html#/${r.status === "review" ? "review" : "report"}/${encodeURIComponent(r.id)}`;

  // Weeks run Monday to Sunday, in this computer's time (Arizona)
  function periods() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    return { today, week: isoDate(monday), weekTs: monday.getTime(), month: isoDate(monthStart), monthTs: monthStart.getTime() };
  }

  // =====================================================================
  // Data
  // =====================================================================
  function liveStore() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const ok = (res) => { if (res.error) throw new Error(res.error.message); return res.data || []; };
    const soft = async (q) => { try { return ok(await q); } catch (e) { console.warn(e); return []; } };
    return {
      async me() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return null;
        return ok(await sb.from("profiles").select("id, email, full_name, role, active").eq("id", data.session.user.id).single());
      },
      async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
      async signOut() { await sb.auth.signOut(); },
      async load() {
        const since = isoDate(new Date(Date.now() - 180 * DAY));
        const [leads, notes, intakes, reports, sends, entries, services, clients, people, snaps, actions] = await Promise.all([
          soft(sb.from("leads").select("id, lead_date, created_at, updated_at, project_name, contact_name, company, email, phone, channel, stage, in_quickbooks, won_at, details")),
          soft(sb.from("lead_notes").select("lead_id, created_at, author_name, body, automatic").order("created_at", { ascending: false }).limit(60)),
          soft(sb.from("lead_intakes").select("lead_id, source, submitted_at").order("submitted_at", { ascending: false }).limit(30)),
          soft(sb.from("reports").select("id, client_name, property, status, consultant, type_name, created_at, updated_at, sent_at, user_id")),
          soft(sb.from("report_sends").select("report_id, sent_by, sent_to, sent_at").order("sent_at", { ascending: false }).limit(30)),
          soft(sb.from("time_entries").select("id, user_id, client_id, property, entry_date, hours, service_type_id, site_minimum_amount, status, qb_exported_at, created_at, entry_materials(quantity, unit_price)").gte("entry_date", since)),
          soft(sb.from("service_types").select("id, name, rate, billable")),
          soft(sb.from("clients").select("id, name")),
          soft(sb.from("profiles").select("id, full_name, email")),
          soft(sb.from("finance_snapshots").select("kind, as_of, data").order("as_of", { ascending: false }).limit(40)),
          soft(sb.from("cash_todo_actions").select("id, todo_key, action, title, detail, amount, acted_by_name, acted_at").order("acted_at", { ascending: false }).limit(500)),
        ]);
        return { leads, notes, intakes, reports, sends, entries, services, clients, people, finance: latestByKind(snaps), actions };
      },
      // Mark a cash to-do done or dismissed, or undo that
      async act(row) { ok(await sb.from("cash_todo_actions").upsert(row, { onConflict: "todo_key" })); },
      async undo(key) { ok(await sb.from("cash_todo_actions").delete().eq("todo_key", key)); },
    };
  }

  // Made-up data for the sample dashboard
  function demoStore() {
    const now = Date.now();
    const at = (daysAgo, hour = 10) => { const d = new Date(now - daysAgo * DAY); d.setHours(hour, 15, 0, 0); return d.toISOString(); };
    const day = (daysAgo) => isoDate(new Date(now - daysAgo * DAY));
    const people = [{ id: "u1", full_name: "Kasey Harman" }, { id: "u2", full_name: "Robbie Stephens" }, { id: "u3", full_name: "Stephanie Lara" }, { id: "u4", full_name: "Krista O'Malley" }];
    const services = [{ id: "s1", name: "Horticultural Consulting", rate: 200, billable: true }, { id: "s2", name: "Site Inspection", rate: 350, billable: true },
      { id: "s3", name: "Horticultural Technician", rate: 85, billable: true }, { id: "s4", name: "Admin", rate: null, billable: false }];
    const clients = [["c1", "Marigold Residence"], ["c2", "Saguaro Heights HOA"], ["c3", "Ocotillo Residence"], ["c4", "Agave Residence"], ["c5", "Palo Verde Estate"], ["c6", "Desert Bloom Residence"]].map(([id, name]) => ({ id, name }));
    const L = (id, name, contact, stage, channel, d, o = {}) => ({ id, project_name: name, contact_name: contact, stage, channel, lead_date: day(d), created_at: at(d), updated_at: at(o.upd != null ? o.upd : d), in_quickbooks: !!o.qb, won_at: stage === "won" ? at(o.wonAgo != null ? o.wonAgo : d) : null, details: o.who ? { assignee: o.who } : {} });
    const leads = [
      L("l1", "Juniper Residence", "Avery Juniper", "new", "website", 0),
      L("l2", "Mesa Verde HOA", "Jordan Placeholder", "new", "phone", 1),
      L("l3", "Cholla Residence", "Sam Cholla", "new", "intake_form", 2),
      L("l4", "Ironwood Residence", "Riley Ironwood", "contacted", "referral", 4, { who: "robert" }),
      L("l5", "Sage Residence", "Morgan Sage", "intake_sent", "phone", 12, { upd: 10, who: "kasey" }),
      L("l6", "Saguaro Heights HOA", "Pat Rivera", "intake_received", "intake_form", 6, { who: "stephanie" }),
      L("l7", "Ocotillo Residence", "Chris Ocotillo", "scheduled", "phone", 9, { who: "robert" }),
      L("l8", "Agave Residence", "Sam Agave", "proposal_sent", "text", 15, { upd: 9, who: "kasey" }),
      L("l9", "Palo Verde Estate", "Alex Verde", "won", "referral", 20, { wonAgo: 2, who: "kasey" }),
      L("l10", "Desert Bloom Residence", "Morgan Example", "won", "website", 25, { wonAgo: 1, qb: true, who: "krista" }),
      L("l11", "Mesquite Residence", "Robin Mesquite", "lost", "phone", 30),
      L("l12", "Marigold Residence", "Jamie Marigold", "won", "website", 40, { wonAgo: 12, qb: true, who: "robert" }),
      L("l13", "Brittlebush Residence", "Taylor Brittle", "contacted", "email", 3, { who: "stephanie" }),
    ];
    const notes = [
      { lead_id: "l9", created_at: at(2, 14), author_name: "Kasey Harman", body: "Stage changed to Won", automatic: true },
      { lead_id: "l6", created_at: at(1, 9), author_name: "Krista O'Malley", body: "Assigned to Stephanie. Lead report sent in Slack.", automatic: false },
      { lead_id: "l4", created_at: at(0, 9), author_name: "Robbie Stephens", body: "Called back, site visit next Tuesday.", automatic: false },
      { lead_id: "l10", created_at: at(1, 16), author_name: "Krista O'Malley", body: "Stage changed to Won", automatic: true },
    ];
    const intakes = [{ lead_id: "l3", source: "intake_form", submitted_at: at(2, 11) }, { lead_id: "l1", source: "website", submitted_at: at(0, 8) }];
    const reports = [
      { id: "r1", client_name: "Marigold Residence", property: "Main house", status: "sent", consultant: "Kasey Harman", type_name: "Site visit", created_at: at(5), updated_at: at(1), sent_at: at(1, 15), user_id: "u1" },
      { id: "r2", client_name: "Saguaro Heights HOA", property: "Entry", status: "draft", consultant: "Robbie Stephens", type_name: "Site visit", created_at: at(3), updated_at: at(3), user_id: "u2" },
      { id: "r3", client_name: "Agave Residence", property: "", status: "review", consultant: "Stephanie Lara", type_name: "Diagnostic", created_at: at(2), updated_at: at(0, 8), user_id: "u3" },
      { id: "r4", client_name: "Palo Verde Estate", property: "", status: "sent", consultant: "Kasey Harman", type_name: "Monthly oversight", created_at: at(9), updated_at: at(8), sent_at: at(8, 11), user_id: "u1" },
    ];
    const sends = [{ report_id: "r1", sent_by: "u1", sent_to: "jamie@example.com", sent_at: at(1, 15) }];
    let n = 0;
    const E = (user, client, d, hours, svc, status, o = {}) => ({ id: "e" + ++n, user_id: user, client_id: client, property: "", entry_date: day(d), hours, service_type_id: svc, site_minimum_amount: o.min || null, status, qb_exported_at: o.qb ? at(d - 1) : null, created_at: at(d, 17), entry_materials: o.mat || [] });
    const entries = [
      E("u1", "c1", 0, 2, "s1", "pending"), E("u2", "c2", 0, 3, "s2", "pending"), E("u3", "c3", 1, 4, "s3", "pending", { mat: [{ quantity: 2, unit_price: 18 }] }),
      E("u1", "c5", 1, 1.5, "s1", "approved"), E("u2", "c4", 2, 2.5, "s1", "approved"), E("u3", "c6", 2, 3, "s3", "approved", { min: 150 }),
      E("u1", "c2", 3, 2, "s2", "approved", { qb: true }), E("u2", "c1", 4, 1, "s4", "approved", { qb: true }),
      E("u1", "c4", 9, 3, "s1", "approved", { qb: true }), E("u3", "c5", 10, 5, "s3", "approved", { qb: true }), E("u2", "c6", 12, 2, "s2", "approved", { qb: true }),
    ];
    const me = { id: "u4", email: "demo@harmonyhorticulture.com", full_name: "Krista O'Malley", role: "admin", active: true };
    const finance = demoFinance(day);
    const AKEY = "hh-dash-demo-actions";
    const readA = () => { try { return JSON.parse(localStorage.getItem(AKEY)) || []; } catch (e) { return []; } };
    const writeA = (a) => { try { localStorage.setItem(AKEY, JSON.stringify(a)); } catch (e) { /* private mode */ } };
    return {
      async me() { return me; }, async signIn() {}, async signOut() {},
      async load() { return { leads, notes, intakes, reports, sends, entries, services, clients, people, finance, actions: readA() }; },
      async act(row) { writeA([{ ...row, id: "a" + Date.now(), acted_at: new Date().toISOString() }, ...readA().filter((a) => a.todo_key !== row.todo_key)]); },
      async undo(key) { writeA(readA().filter((a) => a.todo_key !== key)); },
    };
  }


  // Newest QuickBooks snapshot of each kind
  function latestByKind(rows) {
    const out = {};
    (rows || []).forEach((r) => { if (!out[r.kind]) out[r.kind] = { as_of: r.as_of, ...r.data }; });
    return out;
  }

  // Made-up QuickBooks numbers for the sample dashboard
  function demoFinance(day) {
    const inv = (name, num, dueAgo, open, amount) => ({ type: "Invoice", name, num, due: day(dueAgo), date: day(dueAgo + 30), open, amount: amount || open });
    const pay = (name, ago, open) => ({ type: "Payment", name, num: "", due: day(ago), date: day(ago), open, amount: open });
    const bill = (name, num, dueAgo, open) => ({ type: "Bill", name, num, due: day(dueAgo), date: day(dueAgo + 30), open, amount: open });
    const ar = [inv("Marigold Residence", "INV-1042", 48, 12400, 16800), inv("Saguaro Heights HOA", "INV-1051", 95, 1650), inv("Palo Verde Estate", "INV-1060", 21, 3800),
      inv("Agave Residence", "INV-1063", 20, 2450), inv("Ocotillo Residence", "INV-1066", 20, 595), inv("Desert Bloom Residence", "INV-1070", -10, 3975),
      inv("Juniper Residence", "INV-1071", -10, 900), pay("Cholla Residence", 70, -650), pay("Mesquite Residence", 120, -520)];
    const ap = [bill("Example Tree Care", "7731", 23, 9100), bill("Sample Consulting Co.", "", 20, 6200), bill("Desert Nursery Supply", "554", 10, 1325),
      bill("Example Tree Care", "7790", -5, 2722), bill("Irrigation Parts Co.", "88", -15, 467), { type: "Bill Payment (Check)", name: "Example Tree Care", num: "Zelle", due: day(150), date: day(150), open: -1275, amount: -2550 }];
    const months = [], inc = [], cogs = [], exp = [], fees = [], cons = [];
    const now = new Date();
    for (let i = 12; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(i ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : `${d.toLocaleDateString("en-US", { month: "short" })} 1-${now.getDate()} ${d.getFullYear()}`);
      const base = [38, 52, 41, 47, 60, 72, 39, 44, 51, 58, 49, 66, 34][12 - i] * 1000;
      inc.push(base); cogs.push(Math.round(base * (0.42 + (i % 3) * 0.06))); exp.push(Math.round(17000 + (i % 4) * 3500)); fees.push(Math.round(base * 0.013)); cons.push(i < 2 ? 0 : Math.round(base * 0.25));
    }
    const sum = (a) => a.reduce((t, x) => t + x, 0);
    const net = inc.map((x, i) => x - cogs[i] - exp[i]);
    [inc, cogs, exp, fees, cons, net].forEach((a) => a.push(sum(a))); months.push("Total");
    return {
      ar_detail: { as_of: day(0), items: ar, total: sum(ar.map((x) => x.open)) },
      ap_detail: { as_of: day(0), items: ap, total: sum(ap.map((x) => x.open)) },
      pnl_monthly: { as_of: day(0), basis: "cash", months, lines: { "Total Income": inc, "Total Cost of Goods Sold (all)": cogs, "Total Expenses": exp, "Net Income": net, "QuickBooks Payments Fees": fees, "Total for Billable Consultants Fees": cons } },
      balance_sheet: { as_of: day(0), total_bank: 18450, bank: { "Operating (1234)": 15200, "Savings (5678)": 3250 } },
    };
  }

  // =====================================================================
  // Cash flow: QuickBooks snapshots plus the Time Tracker, turned into
  // a few plain suggestions for today
  // =====================================================================
  const QBO = "https://qbo.intuit.com/app/";
  // Short, stable fingerprint of a string
  const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  function computeCash(f, c, actions) {
    if (!f || (!f.ar_detail && !f.ap_detail && !f.pnl_monthly)) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayTs = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
    const late = (x) => Math.round((today.getTime() - dayTs(x.due)) / DAY);
    const sum = (list) => list.reduce((t, x) => t + Number(x.open || 0), 0);
    const ar = (f.ar_detail && f.ar_detail.items) || [];
    const ap = (f.ap_detail && f.ap_detail.items) || [];

    const invoices = ar.filter((x) => x.open > 0);
    const credits = ar.filter((x) => x.open < 0);
    const lateInv = invoices.filter((x) => late(x) > 0).sort((a, b) => b.open - a.open);
    const soonInv = invoices.filter((x) => late(x) <= 0 && late(x) >= -14);
    const bills = ap.filter((x) => x.open > 0);
    const billCredits = ap.filter((x) => x.open < 0);
    const lateBills = bills.filter((x) => late(x) > 0).sort((a, b) => b.open - a.open);
    const soonBills = bills.filter((x) => late(x) <= 0 && late(x) >= -14);

    // Monthly history (cash basis): money in, money out, what was left
    let hist = [];
    const pl = f.pnl_monthly;
    if (pl && pl.months) {
      const L = pl.lines || {};
      const get = (k, i) => Number((L[k] || [])[i] || 0);
      hist = pl.months.map((m, i) => ({ m, inc: get("Total Income", i), out: get("Total Cost of Goods Sold (all)", i) + get("Total Expenses", i), net: get("Net Income", i),
        fees: get("QuickBooks Payments Fees", i), cons: get("Total for Billable Consultants Fees", i),
        pest: get("Vendor Pest Treatment-Expense", i), plant: get("Plant Material", i), payroll: get("Total for Payroll Expense", i) })).filter((x) => x.m !== "Total");
    }
    const full = hist.filter((x) => !/\d-\d/.test(x.m));        // whole months only
    const last12 = full.slice(-12);
    const last3 = full.slice(-3);
    const avg = (list, k) => (list.length ? list.reduce((t, x) => t + x[k], 0) / list.length : 0);

    const tips = [];
    // 1. Chase the biggest late invoices
    lateInv.slice(0, 3).forEach((x) => tips.push({ k: "call", tone: "pink", amount: x.open,
      title: `Call ${x.name}`, text: `${money(x.open)} on ${x.num || "an invoice"} is ${plural(late(x), "day")} late.`,
      list: [x], row: (y) => [`${y.name}: ${money(y.open)}`, `${y.num || "Invoice"} · due ${niceDate(y.due)} · ${plural(late(y), "day")} late`, QBO + "invoices"] }));
    const rest = lateInv.slice(3);
    if (rest.length) tips.push({ k: "late", tone: "pink", amount: sum(rest), title: `${plural(rest.length, "more late invoice")}`,
      text: `${money(sum(rest))} in smaller late invoices. A friendly reminder email from QuickBooks clears most of these.`,
      list: rest, row: (y) => [`${y.name}: ${money(y.open)}`, `${y.num || "Invoice"} · ${plural(late(y), "day")} late`, QBO + "invoices"] });
    // 2. Approved hours not invoiced yet
    const unbilled = c.att.toExport.reduce((t, e) => t + c.amount(e), 0);
    if (unbilled > 0) tips.push({ k: "bill", tone: "green", amount: unbilled, title: "Invoice approved hours",
      text: `${money(unbilled)} of approved time isn't in QuickBooks yet. Money can't come in until it's billed.`,
      list: c.att.toExport, row: (e) => [`${c.client[e.client_id] || e.property || "Client"}: ${money(c.amount(e))}`, `${c.person[e.user_id] || ""} · ${hrs(e.hours)} · ${niceDate(e.entry_date)}`, TT], all: TT, allLabel: "Export in Time Tracker ↗" });
    // 3. Credits sitting on customer accounts
    if (credits.length) tips.push({ k: "credit", tone: "brown", amount: -sum(credits), title: "Clean up customer credits",
      text: `${money(-sum(credits))} of payments aren't matched to invoices (${credits.slice(0, 3).map((x) => x.name).join(", ")}${credits.length > 3 ? "…" : ""}). Apply or refund them so "owed to you" is right.`,
      list: credits, row: (y) => [`${y.name}: ${money(-y.open)} unapplied`, `${y.type} on ${niceDate(y.date)}`, QBO + "customers"], allLabel: "Open QuickBooks ↗", all: QBO + "customers" });
    // 4. Bill payments not matched to bills
    if (billCredits.length) {
      const who = [...new Set(billCredits.map((x) => x.name))];
      tips.push({ k: "match", tone: "brown", amount: -sum(billCredits), title: `Match payments to ${who.length === 1 ? who[0] : "vendors"}`,
        text: `${money(-sum(billCredits))} of bill payments aren't matched to bills, so some "unpaid" bills may already be paid. Check before paying again.`,
        list: billCredits, row: (y) => [`${y.name}: ${money(-y.open)}`, `${y.num || y.type} on ${niceDate(y.date)}`, QBO + "bills"], all: QBO + "bills", allLabel: "Open bills ↗" });
    }
    // 5. Bills: late and coming due
    if (lateBills.length) tips.push({ k: "bills", tone: "brown", amount: sum(lateBills), title: "Bills past due",
      text: `${money(sum(lateBills))} across ${plural(lateBills.length, "bill")}. Biggest: ${lateBills[0].name}, ${money(lateBills[0].open)}. Call anyone you can't pay this week and agree a date.`,
      list: lateBills, row: (y) => [`${y.name}: ${money(y.open)}`, `due ${niceDate(y.due)} · ${plural(late(y), "day")} late`, QBO + "bills"], all: QBO + "bills", allLabel: "Open bills ↗" });
    // 6. Consultants not paid yet makes recent months look better than they are
    const consBills = bills.filter((x) => CONSULTANT_VENDORS.test(x.name));
    if (consBills.length && last3.length && last3.slice(-2).every((x) => !x.cons)) tips.push({ k: "cons", tone: "brown", amount: sum(consBills), title: "Recent months look better than they are",
      text: `${consBills.map((x) => x.name.split(" ")[0]).join(" and ")}'s bills (${money(sum(consBills))}) aren't paid yet, so they're missing from the last two months' costs. Set that money aside.`,
      list: consBills, row: (y) => [`${y.name}: ${money(y.open)}`, `due ${niceDate(y.due)}`, QBO + "bills"], all: QBO + "bills", allLabel: "Open bills ↗" });
    // 7. Coming due soon: send reminders before they're late
    if (soonInv.length) tips.push({ k: "soon", tone: "green", amount: sum(soonInv), title: "Send reminders before they're late",
      text: `${money(sum(soonInv))} comes due in the next two weeks. A reminder a few days before the due date gets paid faster.`,
      list: soonInv, row: (y) => [`${y.name}: ${money(y.open)}`, `${y.num || "Invoice"} · due ${niceDate(y.due)}`, QBO + "invoices"] });
    // 8. Card fees
    const fees3 = last3.reduce((t, x) => t + x.fees, 0);
    if (fees3 > 300) tips.push({ k: "fees", tone: "green", amount: fees3, title: "Ask big clients to pay by bank transfer",
      text: `Card and payment fees were ${money(fees3)} over the last 3 months. Bank transfer (ACH) costs far less on invoices over $2,000.` });
    // 9. From the Balance Sheet: money received but not deposited, and card balances
    const bs = f.balance_sheet;
    if (bs && bs.undeposited > 500) tips.push({ k: "deposit", tone: "green", amount: bs.undeposited, title: "Deposit what's waiting",
      text: `${money(bs.undeposited)} is sitting in Undeposited Funds: payments received but not recorded as deposited. Take any checks to the bank, then record the deposit in QuickBooks.` });
    if (bs && bs.total_cards > 1000) tips.push({ k: "cards", tone: "brown", amount: bs.total_cards, title: "Credit cards to pay down",
      text: `${money(bs.total_cards)} is on company credit cards (${Object.entries(bs.cards || {}).filter(([, v]) => v > 0).map(([n, v]) => `${n.replace(/\s*-?\s*CC.*$/i, "").replace(/\s*\(\d+\)/, "")} ${money(v)}`).join(", ")}). Pay these in full before interest is charged.` });
    // Estimates: upcoming work. Accepted ones become invoices when the job is
    // scheduled or done; pending ones are waiting on the client.
    const estItems = (f.estimates && f.estimates.items) || [];
    const estAccepted = estItems.filter((x) => /accepted/i.test(x.status) && !x.invoice).sort((a, b) => b.amount - a.amount);
    const estPending = estItems.filter((x) => /pending/i.test(x.status)).sort((a, b) => b.amount - a.amount);
    const estSum = (l) => l.reduce((t, x) => t + Number(x.amount || 0), 0);
    const estRow = (x) => [`${x.customer}: ${money(x.amount)}`, `Estimate ${x.num} · ${x.accepted_on ? `accepted ${niceDate(x.accepted_on)}` : `sent ${niceDate(x.date)}`}`, QBO + "estimates"];
    if (estAccepted.length) tips.push({ k: "est", tone: "green", amount: estSum(estAccepted), title: "Turn accepted work into invoices",
      text: `${money(estSum(estAccepted))} of accepted estimates isn't invoiced yet (${estAccepted.slice(0, 2).map((x) => x.customer).join(", ")}${estAccepted.length > 2 ? "…" : ""}). As each job is scheduled or done, convert it so the money can come in.`,
      list: estAccepted, row: estRow, all: QBO + "estimates", allLabel: "Open estimates ↗" });

    // 13-week cash forecast. Starts from the bank (plus money waiting to be
    // deposited). Money in: the usual week, from the last 6 full months. Money
    // out: the first 4 weeks use the real bills in QuickBooks (late ones in
    // week 1) plus the usual non-bill spending; after that, the usual week.
    const fc = (() => {
      if (!bs || full.length < 3) return null;
      const base = full.slice(-6), n = base.length, WPM = 52 / 12;
      const mIn = avg(base, "inc"), mOut = avg(base, "out");
      const mBilled = base.reduce((t, x) => t + x.cons + x.pest + x.plant, 0) / n;
      const mOther = Math.max(0, mOut - mBilled);
      const inW = mIn / WPM, outW = mOut / WPM, otherW = mOther / WPM, billedW = mBilled / WPM;
      const start = dayTs(bs.as_of), KNOWN = 4;
      const weeks = Array.from({ length: 13 }, (_, i) => ({ i, from: start + i * 7 * DAY, inc: inW, bills: 0, other: i < KNOWN ? otherW : outW, cards: 0, billList: [] }));
      const counted = [];
      bills.forEach((x) => {
        const w = Math.max(0, Math.floor((dayTs(x.due) - start) / (7 * DAY)));
        if (w < KNOWN) { weeks[w].bills += x.open; weeks[w].billList.push(x); counted.push(x); }
      });
      if (bs.total_cards > 0) weeks[1].cards = bs.total_cards;
      const startBal = bs.total_bank + (bs.undeposited || 0);
      let bal = startBal;
      weeks.forEach((w) => { w.out = w.bills + w.other + w.cards; bal += w.inc - w.out; w.end = bal; });
      const low = weeks.reduce((a, b) => (b.end < a.end ? b : a));
      return { estAccepted, estPending, estAcc: estSum(estAccepted), estPend: estSum(estPending), estAsOf: f.estimates && f.estimates.as_of, weeks, low, end: bal, startBal, cushion: mOut, mIn, mOut, mBilled, mOther, inW, outW, otherW, billedW, counted, known: KNOWN,
        base: `${base[0].m} to ${base[n - 1].m}`, n, asOf: bs.as_of, lateIn: sum(lateInv), payrollRecent: base.slice(-2).map((x) => x.payroll), payrollBefore: avg(base.slice(0, -2), "payroll") };
    })();
    const wkLabel = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (fc && fc.low.end < fc.cushion) tips.unshift({ k: "forecast", tone: "pink", amount: fc.low.end,
      title: fc.low.end < 0 ? `Cash could run out the week of ${wkLabel(fc.low.from)}` : `Cash gets tight the week of ${wkLabel(fc.low.from)}`,
      text: `The forecast drops to ${fc.low.end < 0 ? "−" : ""}${money(Math.abs(fc.low.end))}, less than a normal month of spending (${money(fc.cushion)}). Collect late invoices now and hold anything that can wait. See Cash forecast.` });

    // 10. Lumpy months: keep a cushion
    const neg = last12.filter((x) => x.net < 0);
    if (neg.length >= 3) tips.push({ k: "cushion", tone: "brown", amount: -avg(neg, "net"), title: "Keep a cushion",
      text: `${neg.length} of the last ${last12.length} months spent more than came in, by ${money(-avg(neg, "net"))} on average. Try to keep at least that in the bank.` });

    // A to-do keeps its key while the same items are behind it. New items
    // (a new late invoice, a new bill) make a new to-do, so it comes back.
    const asOf = (f.ar_detail || f.ap_detail || f.pnl_monthly).as_of;
    const idOf = (x) => x.id || x.num || `${x.name}|${x.date}`;
    tips.forEach((t) => { t.key = t.k + ":" + (t.list && t.list.length ? hash(t.list.map(idOf).sort().join(",")) : String(asOf).slice(0, 7)); });
    const handled = new Set((actions || []).map((a) => a.todo_key));
    const open = tips.filter((t) => !handled.has(t.key));

    // What's behind each number, for the "How this is worked out" panels
    const rowInv = (x) => [`${x.name}`, x.open, `${x.num || x.type} · due ${niceDate(x.due)}${late(x) > 0 ? ` · ${plural(late(x), "day")} late` : late(x) === 0 ? " · due today" : ` · in ${plural(-late(x), "day")}`}`];
    const byDue = (a, b) => dayTs(a.due) - dayTs(b.due);
    const arAsOf = f.ar_detail && f.ar_detail.as_of, apAsOf = f.ap_detail && f.ap_detail.as_of;
    const explain = {
      owed: {
        title: "Owed to you", total: sum(invoices), source: `QuickBooks A/R Aging Detail, as of ${niceDate(arAsOf)}`,
        how: [
          `Every invoice in the A/R Aging Detail that still has a balance, added up: ${money(sum(invoices))} across ${plural(invoices.length, "invoice")}.`,
          `"Past due" is the invoices whose due date has passed: ${money(sum(lateInv))}.`,
          credits.length ? `QuickBooks' own total is ${money(f.ar_detail.total)}. That's lower because it subtracts ${money(-sum(credits))} of customer payments that aren't matched to an invoice yet (listed at the bottom). Those are money you already have, so they're not counted as owed.` : "",
        ],
        sections: [
          { h: "Past due", rows: lateInv.slice().sort(byDue).map(rowInv) },
          { h: "Not due yet", rows: invoices.filter((x) => late(x) <= 0).sort(byDue).map(rowInv) },
          credits.length ? { h: "Payments not matched to an invoice", rows: credits.map((x) => [x.name, x.open, `${x.type} on ${niceDate(x.date)}`]) } : null,
        ],
        link: QBO + "invoices", linkLabel: "Open invoices in QuickBooks ↗",
      },
      owe: {
        title: "Bills you owe", total: sum(bills), source: `QuickBooks A/P Aging Detail, as of ${niceDate(apAsOf)}`,
        how: [
          `Every bill in the A/P Aging Detail that still has a balance, added up: ${money(sum(bills))} across ${plural(bills.length, "bill")}.`,
          `"Past due" is the bills whose due date has passed: ${money(sum(lateBills))}.`,
          billCredits.length ? `QuickBooks' own total is ${money(f.ap_detail.total)}. That's lower because it subtracts ${money(-sum(billCredits))} of bill payments that aren't matched to a bill (listed at the bottom). Some bills above may already be paid by those.` : "",
        ],
        sections: [
          { h: "Past due", rows: lateBills.slice().sort(byDue).map(rowInv) },
          { h: "Not due yet", rows: bills.filter((x) => late(x) <= 0).sort(byDue).map(rowInv) },
          billCredits.length ? { h: "Payments not matched to a bill", rows: billCredits.map((x) => [x.name, x.open, `${x.num || x.type} on ${niceDate(x.date)}`]) } : null,
        ],
        link: QBO + "bills", linkLabel: "Open bills in QuickBooks ↗",
      },
      soon: {
        title: "Next 2 weeks", total: sum(soonInv) - sum(soonBills), source: `QuickBooks A/R and A/P Aging Detail, as of ${niceDate(arAsOf || apAsOf)}`,
        how: [
          `Invoices coming due in the next 14 days (${money(sum(soonInv))}) minus bills coming due in the next 14 days (${money(sum(soonBills))}) = ${money(sum(soonInv) - sum(soonBills))}.`,
          `Anything already late is left out, because there's no telling when it will be paid. Late invoices total ${money(sum(lateInv))} and late bills ${money(sum(lateBills))}; they're in the other two boxes.`,
          "This is a rough guide to the next two weeks, not a promise: it assumes clients pay on time and doesn't include payroll or card payments.",
        ],
        sections: [
          { h: "Coming in", rows: soonInv.slice().sort(byDue).map(rowInv) },
          { h: "Going out", rows: soonBills.slice().sort(byDue).map(rowInv) },
        ],
        link: QBO + "invoices", linkLabel: "Open invoices in QuickBooks ↗",
      },
      bank: bs ? {
        title: "In the bank", total: bs.total_bank, source: `QuickBooks Balance Sheet, as of ${niceDate(bs.as_of)}`,
        how: [
          `The "Total Bank Accounts" line of the Balance Sheet: ${money(bs.total_bank)}. This is what QuickBooks shows, so it's only as current as the last bank feed and reconciliation.`,
          bs.undeposited ? `Undeposited Funds (${money(bs.undeposited)}) is money received but not yet recorded as deposited. It isn't in the bank total until it's deposited.` : "",
          bs.total_cards ? `Credit cards (${money(bs.total_cards)}) are money owed, not money on hand, so they're listed separately.` : "",
        ],
        sections: [
          { h: "Bank accounts", rows: Object.entries(bs.bank || {}).map(([n, v]) => [n, v, ""]) },
          bs.undeposited ? { h: "Waiting to be deposited", rows: [["Undeposited Funds", bs.undeposited, ""]] } : null,
          bs.total_cards ? { h: "Credit cards (owed)", rows: Object.entries(bs.cards || {}).map(([n, v]) => [n, v, ""]) } : null,
        ],
        link: QBO + "homepage", linkLabel: "Open QuickBooks ↗",
      } : null,
      forecast: fc ? {
        title: "Cash forecast", total: fc.end, source: `QuickBooks Balance Sheet, A/P Aging Detail and Profit and Loss (cash basis), as of ${niceDate(fc.asOf)}`,
        how: [
          `Starts with what's in the bank (${money(bs.total_bank)}) plus Undeposited Funds (${money(bs.undeposited || 0)}): ${money(fc.startBal)}.`,
          `Money in each week is your usual week: ${money(fc.inW)}. That's the average monthly income from ${fc.base} (${money(fc.mIn)} a month) spread over the weeks. It assumes clients keep paying at their usual pace, late payers included. The ${money(fc.lateIn)} of late invoices is part of what's expected, not extra.`,
          `Money out in the first ${fc.known} weeks is the real bills in QuickBooks on their due dates (anything already late counts in week 1), plus your usual spending that doesn't come through bills, like payroll, rent and card purchases: ${money(fc.otherW)} a week. After that, it's your usual week: ${money(fc.outW)}.`,
          bs.total_cards ? `The credit card balances (${money(bs.total_cards)}) are counted as paid in full in week 2.` : "",
          `"Getting tight" means the balance drops below one normal month of spending (${money(fc.cushion)}).`,
          fc.payrollRecent.every((v) => v < fc.payrollBefore / 4) && fc.payrollBefore > 1000 ? `Heads up: payroll in the Profit and Loss dropped from about ${money(fc.payrollBefore)} a month to ${fc.payrollRecent.map(money).join(" and ")} in the last two months. If payroll is now paid from somewhere QuickBooks doesn't show, the forecast is too high by about that much.` : "",
          fc.estAccepted.length || fc.estPending.length ? `Estimates are shown on the page but not added to money in, because your usual week already includes new work like this. Accepted, not invoiced: ${money(fc.estAcc)}. Waiting on the client: ${money(fc.estPend)}.` : "",
          "This is a guide, not a promise. It's redone every weekday morning when the new QuickBooks numbers arrive.",
        ],
        sections: [
          { h: "Week by week (bank at the end of the week)", rows: fc.weeks.map((w) => [`Week of ${wkLabel(w.from)}`, w.end, `in ${money(w.inc)} · out ${money(w.out)}${w.bills ? ` (bills ${money(w.bills)})` : ""}${w.cards ? ` (credit cards ${money(w.cards)})` : ""}`]) },
          { h: `Bills counted in the first ${fc.known} weeks`, rows: fc.counted.slice().sort(byDue).map(rowInv) },
          { h: `Your usual month (average of ${fc.base})`, rows: [
            ["Came in", fc.mIn, "Total Income"],
            ["Went out", fc.mOut, "Cost of Goods Sold plus Expenses"],
            ["  Of that, through vendor bills", fc.mBilled, "Consultants, pest treatment and plant material"],
            ["  Of that, everything else", fc.mOther, "Payroll, rent, card purchases and the rest"],
          ] },
          fc.estAccepted.length ? { h: "Accepted estimates, not invoiced yet (not added in)", rows: fc.estAccepted.map((x) => [x.customer, x.amount, `Estimate ${x.num} · accepted ${niceDate(x.accepted_on)}`]) } : null,
          fc.estPending.length ? { h: "Estimates waiting on the client (not added in)", rows: fc.estPending.map((x) => [x.customer, x.amount, `Estimate ${x.num} · sent ${niceDate(x.date)}`]) } : null,
          { h: "Starting point", rows: [...Object.entries(bs.bank || {}).map(([nm, v]) => [nm, v, "Bank account"]), ["Undeposited Funds", bs.undeposited || 0, "Received, not deposited yet"]] },
        ],
        link: QBO + "reportv2?token=PANDL", linkLabel: "Open the Profit and Loss in QuickBooks ↗",
      } : null,
      chart: pl ? {
        title: "Money in and out by month", source: `QuickBooks Profit and Loss, ${pl.basis === "cash" ? "cash basis" : "accrual basis"}, by month, as of ${niceDate(pl.as_of)}`,
        how: [
          `"Came in" is Total Income for the month. "Went out" is Total Cost of Goods Sold plus Total Expenses. What's left is Net Income.`,
          pl.basis === "cash" ? "It's cash basis, so each month shows money actually received and paid that month, not what was invoiced or billed." : "",
          "A bill that hasn't been paid yet doesn't show up until it's paid, so a month can look better than it really was.",
        ],
        sections: [{ h: "By month", rows: hist.slice(-13).reverse().map((x) => [x.m, x.net, `in ${money(x.inc)} · out ${money(x.out)}`]) }],
        link: QBO + "reportv2?token=PANDL", linkLabel: "Open the Profit and Loss in QuickBooks ↗",
      } : null,
    };

    return {
      explain,
      fc,
      asOf,
      owed: sum(invoices), owedLate: sum(lateInv), credits: -sum(credits),
      owe: sum(bills), oweLate: sum(lateBills), billCredits: -sum(billCredits),
      soonIn: sum(soonInv), soonOut: sum(soonBills),
      bank: bs ? bs.total_bank : null, bankAsOf: bs && bs.as_of, cards: bs ? bs.total_cards || 0 : 0, undeposited: bs ? bs.undeposited || 0 : 0,
      hist: hist.slice(-13), avgIn: avg(last3, "inc"), avgOut: avg(last3, "out"), tips: open, history: actions || [], lateInv, lateBills, hasPl: !!pl, hasAr: !!f.ar_detail, hasAp: !!f.ap_detail,
    };
  }

  const S = DEMO ? demoStore() : liveStore();

  // =====================================================================
  // Working out the numbers
  // =====================================================================
  function compute(d) {
    const p = periods();
    const svc = Object.fromEntries(d.services.map((s) => [s.id, s]));
    const client = Object.fromEntries(d.clients.map((c) => [c.id, c.name]));
    const person = Object.fromEntries(d.people.map((x) => [x.id, x.full_name || x.email || "Someone"]));
    const leadById = Object.fromEntries(d.leads.map((l) => [l.id, l]));
    // What an entry bills at list rates: hours x rate (or the site minimum
    // if that's higher), plus materials
    const amount = (e) => {
      const s = svc[e.service_type_id];
      const labor = s && s.billable !== false && s.rate ? Number(e.hours || 0) * Number(s.rate) : 0;
      const mats = (e.entry_materials || []).reduce((t, m) => t + Number(m.quantity || 0) * Number(m.unit_price || 0), 0);
      return Math.max(labor, Number(e.site_minimum_amount || 0)) + mats;
    };
    const ts = (x) => new Date(x).getTime();
    const sevenAgo = Date.now() - 7 * DAY;

    const att = {
      fresh: d.leads.filter((l) => l.stage === "new").sort((a, b) => ts(b.created_at) - ts(a.created_at)),
      stale: d.leads.filter((l) => OPEN.includes(l.stage) && l.stage !== "new" && ts(l.updated_at || l.created_at) < sevenAgo).sort((a, b) => ts(a.updated_at) - ts(b.updated_at)),
      noQb: d.leads.filter((l) => l.stage === "won" && !l.in_quickbooks),
      pending: d.entries.filter((e) => e.status === "pending" || e.status === "submitted"),
      toExport: d.entries.filter((e) => e.status === "approved" && !e.qb_exported_at),
      drafts: d.reports.filter((r) => r.status === "draft" || r.status === "review"),
    };

    const wk = (x) => x && ts(x) >= p.weekTs;
    const mo = (x) => x && ts(x) >= p.monthTs;
    const newThisWeek = d.leads.filter((l) => (l.lead_date ? l.lead_date >= p.week : wk(l.created_at)));
    const sources = {};
    newThisWeek.forEach((l) => { const k = CHANNEL[l.channel] || "Other"; sources[k] = (sources[k] || 0) + 1; });
    const weekEntries = d.entries.filter((e) => e.entry_date >= p.week);
    const monthEntries = d.entries.filter((e) => e.entry_date >= p.month);
    const byPerson = {};
    weekEntries.forEach((e) => { const k = person[e.user_id] || "Someone"; byPerson[k] = byPerson[k] || { hours: 0, amount: 0 }; byPerson[k].hours += Number(e.hours || 0); byPerson[k].amount += amount(e); });
    const sentThisWeek = d.reports.filter((r) => wk(r.sent_at));

    const week = {
      newLeads: newThisWeek.length, sources,
      wonWeek: d.leads.filter((l) => l.stage === "won" && wk(l.won_at)).length,
      wonMonth: d.leads.filter((l) => l.stage === "won" && mo(l.won_at)).length,
      hours: weekEntries.reduce((t, e) => t + Number(e.hours || 0), 0),
      billed: weekEntries.reduce((t, e) => t + amount(e), 0),
      monthHours: monthEntries.reduce((t, e) => t + Number(e.hours || 0), 0),
      monthBilled: monthEntries.reduce((t, e) => t + amount(e), 0),
      byPerson, reportsSent: sentThisWeek.length,
    };

    const pipe = STAGES.map(([k, label]) => ({ k, label, n: d.leads.filter((l) => l.stage === k).length }));
    const assigned = {};
    d.leads.filter((l) => OPEN.includes(l.stage)).forEach((l) => { const k = ASSIGNEE[(l.details || {}).assignee] || "Not assigned"; assigned[k] = (assigned[k] || 0) + 1; });

    // One running feed across the apps
    const feed = [];
    d.notes.forEach((nt) => {
      const l = leadById[nt.lead_id]; if (!l) return;
      if (/^Added from the #form-submissions/.test(nt.body)) return;
      feed.push({ at: nt.created_at, kind: "lead", who: nt.automatic && nt.author_name === "Automatic" ? "" : (nt.author_name || ""), text: `${nt.body.replace(/\.$/, "")}: ${leadName(l)}`, href: leadLink(l.id) });
    });
    d.intakes.forEach((it) => {
      const l = leadById[it.lead_id]; if (!l || !wk(it.submitted_at) && Date.now() - ts(it.submitted_at) > 14 * DAY) return;
      feed.push({ at: it.submitted_at, kind: "form", who: "", text: `New ${it.source === "website" ? "website request" : "intake form"}: ${leadName(l)}`, href: leadLink(l.id) });
    });
    d.reports.forEach((r) => {
      const name = r.client_name || "a client";
      if (r.sent_at) feed.push({ at: r.sent_at, kind: "report", who: consultantName(r) || person[r.user_id] || "", text: `sent the ${name} report`, href: reportLink(r) });
      feed.push({ at: r.created_at, kind: "report", who: consultantName(r) || person[r.user_id] || "", text: `started a ${r.type_name ? r.type_name.toLowerCase() + " " : ""}report for ${name}`, href: reportLink(r) });
    });
    d.entries.forEach((e) => {
      feed.push({ at: e.created_at, kind: "time", who: person[e.user_id] || "", text: `logged ${hrs(e.hours)} at ${client[e.client_id] || e.property || "a client"}`, href: TT });
    });
    feed.sort((a, b) => ts(b.at) - ts(a.at));

    return { p, att, week, pipe, assigned, feed: feed.slice(0, 25), amount, client, person };
  }

  // =====================================================================
  // The page
  // =====================================================================
  function render(d, me) {
    const c = compute(d);
    const cash = computeCash(d.finance, c, d.actions);
    const sum = (list) => list.reduce((t, e) => t + c.amount(e), 0);
    const first = (me.full_name || "").split(" ")[0];
    const hour = new Date().getHours();
    const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const weekLabel = `Week of ${new Date(c.p.weekTs).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

    const ATT = [
      { k: "fresh", label: "New leads to call", sub: "Nobody has reached out yet", color: "pink", list: c.att.fresh,
        row: (l) => [leadName(l), `${CHANNEL[l.channel] || ""} · ${niceDate(l.lead_date || l.created_at)}`, leadLink(l.id)], all: "leads.html" + Q },
      { k: "stale", label: "Gone quiet", sub: "Open leads with no update in 7+ days", color: "brown", list: c.att.stale,
        row: (l) => [leadName(l), `${STAGE[l.stage]} · last touched ${ago(l.updated_at)}`, leadLink(l.id)], all: "leads.html" + Q },
      { k: "noQb", label: "Won, not in QB", sub: "Tick Entered in QB once added", color: "green", list: c.att.noQb,
        row: (l) => [leadName(l), `Won ${l.won_at ? ago(l.won_at) : ""}`, leadLink(l.id)], all: "leads.html" + Q },
      { k: "pending", label: "Hours to approve", sub: c.att.pending.length ? `${hrs(c.att.pending.reduce((t, e) => t + Number(e.hours || 0), 0))} · ${money(sum(c.att.pending))}` : "All caught up", color: "brown", list: c.att.pending,
        row: (e) => [`${c.person[e.user_id] || "Someone"}: ${hrs(e.hours)}`, `${c.client[e.client_id] || e.property || ""} · ${niceDate(e.entry_date)}`, TT], all: TT, allLabel: "Approve in Time Tracker ↗" },
      { k: "toExport", label: "Ready for QuickBooks", sub: c.att.toExport.length ? `Approved, not exported · ${money(sum(c.att.toExport))}` : "Nothing waiting", color: "green", list: c.att.toExport,
        row: (e) => [`${c.client[e.client_id] || e.property || "Client"}: ${money(c.amount(e))}`, `${c.person[e.user_id] || ""} · ${hrs(e.hours)} · ${niceDate(e.entry_date)}`, TT], all: TT, allLabel: "Export in Time Tracker ↗" },
      { k: "drafts", label: "Reports not sent", sub: "Drafts and reports in review", color: "pink", list: c.att.drafts,
        row: (r) => [r.client_name || "Untitled report", `${r.status === "review" ? "In review" : "Draft"} · ${consultantName(r) || c.person[r.user_id] || ""} · ${ago(r.updated_at)}`, reportLink(r)], all: "index.html", allLabel: "Open Reports" },
    ];

    const maxPipe = Math.max(1, ...c.pipe.filter((x) => OPEN.includes(x.k)).map((x) => x.n));
    const srcs = Object.entries(c.week.sources).sort((a, b) => b[1] - a[1]);
    const ppl = Object.entries(c.week.byPerson).sort((a, b) => b[1].hours - a[1].hours);
    const asg = Object.entries(c.assigned).sort((a, b) => (a[0] === "Not assigned") - (b[0] === "Not assigned") || b[1] - a[1]);
    const ICON = { lead: "●", form: "✎", report: "▤", time: "◷" };

    $("#view").innerHTML = location.hash === "#forecast" ? forecastPage(cash) : `
      <div class="dash-head">
        <div><p class="eyebrow">${esc(new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))}</p>
          <h1>${hello}${first ? ", " + esc(first) : ""}</h1></div>
        <div class="dash-quick">
          <a class="btn" href="leads.html${Q}#add">+ Add a lead</a>
          <a class="btn secondary" href="index.html#/new">New report</a>
          <a class="btn secondary" href="${esc(TT)}">Go to time ↗</a>
          <a class="btn secondary" href="${esc(TT)}">Export to QuickBooks ↗</a>
        </div>
      </div>

      ${cashSection(cash)}

      <h2 class="dash-h">Needs attention</h2>
      <div class="att-grid">${ATT.map((a) => `
        <button type="button" class="att ${a.color} ${a.list.length ? "" : "clear"}" data-att="${a.k}">
          <span class="att-n">${a.list.length}</span>
          <span class="att-label">${esc(a.label)}</span>
          <span class="att-sub">${esc(a.sub)}</span>
        </button>`).join("")}
      </div>

      <h2 class="dash-h">${esc(weekLabel)} <span class="muted small">Monday to Sunday</span></h2>
      <div class="week-grid">
        <div class="card wk"><div class="wk-label">New leads</div><div class="wk-num">${c.week.newLeads}</div>
          <div class="bars">${srcs.length ? srcs.map(([k, n]) => `<div class="bar-row"><span>${esc(k)}</span><i style="--w:${(n / srcs[0][1]) * 100}%"></i><b>${n}</b></div>`).join("") : `<p class="muted small">None yet this week</p>`}</div></div>
        <div class="card wk"><div class="wk-label">Won</div><div class="wk-num">${c.week.wonWeek}</div>
          <p class="wk-sub">${plural(c.week.wonMonth, "lead")} won this month</p></div>
        <div class="card wk"><div class="wk-label">Hours logged</div><div class="wk-num">${hrs(c.week.hours).replace(" hrs", "")}<small> hrs</small></div>
          <div class="bars">${ppl.length ? ppl.map(([k, v]) => `<div class="bar-row"><span>${esc(k.split(" ")[0])}</span><i style="--w:${(v.hours / Math.max(ppl[0][1].hours, 0.01)) * 100}%"></i><b>${hrs(v.hours).replace(" hrs", "")}</b></div>`).join("") : `<p class="muted small">No hours yet this week</p>`}</div></div>
        <div class="card wk money"><div class="wk-label">Billable</div><div class="wk-num">${money(c.week.billed)}</div>
          <p class="wk-sub">${money(c.week.monthBilled)} this month · ${hrs(c.week.monthHours)}</p>
          <p class="wk-note">At list rates, before QuickBooks</p></div>
        <div class="card wk"><div class="wk-label">Reports sent</div><div class="wk-num">${c.week.reportsSent}</div>
          <p class="wk-sub">${plural(c.att.drafts.length, "draft")} waiting</p></div>
      </div>

      <div class="dash-two">
        <div class="card">
          <h2 class="dash-h" style="margin-top:0">Leads pipeline</h2>
          <div class="pipe">${c.pipe.filter((x) => OPEN.includes(x.k)).map((x) => `
            <a class="pipe-row" href="leads.html${Q}"><span class="pipe-label">${esc(x.label)}</span>
              <span class="pipe-bar"><i class="stage ${x.k}" style="--w:${(x.n / maxPipe) * 100}%"></i></span><b>${x.n}</b></a>`).join("")}
          </div>
          <p class="small muted pipe-foot">${c.pipe.find((x) => x.k === "won").n} won · ${c.pipe.find((x) => x.k === "lost").n} lost all-time</p>
          <h3 class="dash-h3">Open leads by person</h3>
          <div class="who-chips">${asg.map(([k, n]) => `<span class="who-chip ${k === "Not assigned" ? "none" : ""}">${esc(k)} <b>${n}</b></span>`).join("") || `<span class="muted small">No open leads</span>`}</div>
        </div>
        <div class="card">
          <h2 class="dash-h" style="margin-top:0">Recent activity</h2>
          <ul class="feed">${c.feed.map((f) => `
            <li class="feed-${f.kind}"><span class="feed-ic" aria-hidden="true">${ICON[f.kind]}</span>
              <a href="${esc(f.href)}">${f.who ? `<strong>${esc(f.who.split(" ")[0])}</strong> ` : ""}${esc(f.text)}</a>
              <span class="feed-at">${esc(ago(f.at))}</span></li>`).join("") || `<li class="muted">Nothing yet.</li>`}
          </ul>
        </div>
      </div>`;

    $$("[data-tip]").forEach((b) => (b.onclick = () => {
      const t = cash.tips[Number(b.dataset.tip)];
      openList({ label: t.title, sub: t.text, list: t.list || [], row: t.row, all: t.all || QBO + "invoices", allLabel: t.allLabel || "Open invoices ↗", eyebrow: "Cash to-do" });
    }));
    $$("[data-act]").forEach((b) => (b.onclick = async () => {
      const t = cash.tips[Number(b.dataset.i)];
      b.disabled = true;
      try {
        await S.act({ todo_key: t.key, action: b.dataset.act, title: t.title, detail: t.text, amount: Math.round(t.amount || 0), acted_by_name: me.full_name || me.email });
        toast(b.dataset.act === "done" ? "Marked done. It's in History." : "Dismissed. It's in History.");
        await redraw();
      } catch (e) { b.disabled = false; toast("Couldn't save that: " + e.message); }
    }));
    $$("[data-history]").forEach((b) => (b.onclick = () => openHistory(cash.history)));
    $$("[data-fcdl]").forEach((b) => (b.onclick = () => runDownload(b.dataset.fcdl, [cash.explain.forecast], "Harmony Horticulture Cash forecast", b)));
    $$("[data-explain]").forEach((b) => {
      const go = () => { const x = cash.explain[b.dataset.explain]; if (x) openExplain(x); };
      b.onclick = go;
      b.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    });
    $$("[data-att]").forEach((b) => (b.onclick = () => {
      const a = ATT.find((x) => x.k === b.dataset.att);
      openList(a);
    }));
  }

  const tipLi = (t, i) => `<li class="tip ${t.tone}"><button type="button" class="tip-btn" data-tip="${i}" ${t.list && t.list.length ? "" : "disabled"}>
    <span class="tip-title">${esc(t.title)}</span><span class="tip-text">${esc(t.text)}</span></button>
    <span class="tip-acts"><button type="button" class="tip-act done" data-act="done" data-i="${i}" title="Mark done" aria-label="Mark done: ${esc(t.title)}">✓ Done</button><button type="button" class="tip-act" data-act="dismissed" data-i="${i}" title="Dismiss" aria-label="Dismiss: ${esc(t.title)}">Dismiss</button></span></li>`;
  const fcWeek = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const kShort = (v) => `${v < 0 ? "−" : ""}$${Math.round(Math.abs(v) / 1000)}k`;
  const signed = (v) => `${v < 0 ? "−" : ""}${money(Math.abs(v))}`;

  function forecastPage(k) {
    const head = `<div class="dash-head"><div><p class="eyebrow">Next 13 weeks</p><h1>Cash forecast</h1></div>
      <div class="dash-quick"><a class="btn secondary" href="#">← Dashboard</a></div></div>`;
    if (!k || !k.fc) return head + `<div class="card cash-empty"><p class="muted" style="margin:0">The forecast needs the Balance Sheet, the A/P Aging Detail and the monthly Profit and Loss from QuickBooks. It shows here once those emails have arrived.</p></div>`;
    const f = k.fc, tight = f.low.end < f.cushion;
    const max = Math.max(1, f.startBal, f.cushion, ...f.weeks.map((w) => w.end));
    return head + `
      <p class="small muted" style="margin:-6px 0 14px">From QuickBooks, as of ${esc(niceDate(f.asOf))}. Updated every weekday morning.</p>
      <div class="cash-grid">
        <div class="card wk cash-tile" data-explain="forecast" role="button" tabindex="0" aria-label="How this is worked out"><div class="wk-label">Today</div><div class="wk-num">${money(f.startBal)}</div><p class="wk-sub">Bank plus money waiting to be deposited</p><span class="tile-how">How this is worked out ›</span></div>
        <div class="card wk cash-tile" data-explain="forecast" role="button" tabindex="0" aria-label="How this is worked out"><div class="wk-label">Lowest point</div><div class="wk-num ${tight ? "neg" : ""}">${signed(f.low.end)}</div><p class="wk-sub">Week of ${esc(fcWeek(f.low.from))}${tight ? ` · <b class="neg">less than a month of spending</b>` : ""}</p><span class="tile-how">How this is worked out ›</span></div>
        <div class="card wk cash-tile" data-explain="forecast" role="button" tabindex="0" aria-label="How this is worked out"><div class="wk-label">In 13 weeks</div><div class="wk-num ${f.end < 0 ? "neg" : ""}">${signed(f.end)}</div><p class="wk-sub">${f.end >= f.startBal ? "Up" : "Down"} ${money(Math.abs(f.end - f.startBal))} from today</p><span class="tile-how">How this is worked out ›</span></div>
        <div class="card wk cash-tile" data-explain="forecast" role="button" tabindex="0" aria-label="How this is worked out"><div class="wk-label">Usual week</div><div class="wk-num brown">${signed(f.inW - f.outW)}</div><p class="wk-sub">${money(f.inW)} in · ${money(f.outW)} out</p><p class="wk-note">Average of ${esc(f.base)}</p><span class="tile-how">How this is worked out ›</span></div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="tips-head"><h3 class="dash-h3" style="margin:0">Bank at the end of each week</h3>
          <button type="button" class="link-btn" data-explain="forecast">How this is worked out</button></div>
        <div class="fchart" role="img" aria-label="Forecast bank balance by week">
          <i class="fc-line" style="--y:${f.cushion / max}"><span>One month of spending ${esc(kShort(f.cushion))}</span></i>
          ${f.weeks.map((w) => `<div class="mcol" title="Week of ${esc(fcWeek(w.from))}: ${esc(signed(w.end))}">
            <div class="mbars"><i class="${w.end < f.cushion ? "low" : "ok"}" style="--h:${(Math.max(0, w.end) / max) * 100}%"></i></div>
            <span class="mnet ${w.end < f.cushion ? "neg" : ""}">${esc(kShort(w.end))}</span><span class="mlabel">${esc(fcWeek(w.from))}</span></div>`).join("")}
        </div>
        <p class="small muted mlegend">The first ${f.known} weeks use the real bills in QuickBooks. After that it's your usual week. Bars turn pink below one month of spending.</p>
      </div>
      ${f.estAccepted.length || f.estPending.length ? `<div class="card" style="margin-top:16px">
        <div class="tips-head"><h3 class="dash-h3" style="margin:0">Upcoming work from estimates</h3><a class="link-btn" href="${QBO}estimates" target="_blank" rel="noopener">Open estimates ↗</a></div>
        <p class="small muted" style="margin:0 0 12px">Not added to the forecast: your usual week already includes new work like this. Accepted work turns into money once it's invoiced.</p>
        <div class="est-grid">
          <div><div class="wk-label">Accepted, not invoiced</div><div class="wk-num">${money(f.estAcc)}</div>
            <ul class="est-list">${f.estAccepted.map((x) => `<li><span>${esc(x.customer)}<small>Estimate ${esc(x.num)} · accepted ${esc(niceDate(x.accepted_on))}</small></span><b>${money(x.amount)}</b></li>`).join("") || `<li class="muted">None</li>`}</ul></div>
          <div><div class="wk-label">Waiting on the client</div><div class="wk-num brown">${money(f.estPend)}</div>
            <ul class="est-list">${f.estPending.map((x) => `<li><span>${esc(x.customer)}<small>Estimate ${esc(x.num)} · sent ${esc(niceDate(x.date))}</small></span><b>${money(x.amount)}</b></li>`).join("") || `<li class="muted">None</li>`}</ul></div>
        </div>
      </div>` : ""}
      <div class="card" style="margin-top:16px">
        <h3 class="dash-h3" style="margin-top:0">Week by week</h3>
        <div class="fc-scroll"><table class="fc-table"><thead><tr><th>Week of</th><th class="num">Coming in</th><th class="num">Bills</th><th class="num">Other spending</th><th class="num">Bank at end</th></tr></thead>
          <tbody>${f.weeks.map((w) => `<tr class="${w === f.low ? "is-low" : ""}"><td>${esc(fcWeek(w.from))}${w.i < f.known ? "" : ` <span class="muted small">usual</span>`}</td>
            <td class="num">${money(w.inc)}</td><td class="num">${w.i < f.known ? money(w.bills + w.cards) : "–"}${w.cards ? `<span class="muted small"> incl. cards</span>` : ""}</td>
            <td class="num">${money(w.other)}</td><td class="num ${w.end < f.cushion ? "neg" : ""}"><b>${esc(signed(w.end))}</b></td></tr>`).join("")}</tbody></table></div>
        <div class="btn-row" style="justify-content:flex-end;margin-top:14px">
          <button type="button" class="secondary" data-fcdl="xlsx">Download Excel</button>
          <button type="button" class="secondary" data-fcdl="pdf">Download PDF</button>
        </div>
      </div>`;
  }

  function cashSection(k) {
    if (!k) return `<h2 class="dash-h">Cash flow</h2>
      <div class="card cash-empty"><p class="muted" style="margin:0">QuickBooks numbers show here once the morning report emails start arriving.</p></div>`;
    const stale = k.asOf && Date.now() - new Date(k.asOf + "T12:00:00").getTime() > 3 * DAY;
    const max = Math.max(1, ...k.hist.map((x) => Math.max(x.inc, x.out)));
    const short = (m) => m.replace(/ 1-\d+/, "").replace(/ \d{4}$/, "");
    return `
      <h2 class="dash-h">Cash flow <span class="muted small">From QuickBooks, as of ${esc(niceDate(k.asOf))}</span></h2>
      ${stale ? `<p class="cash-stale">These QuickBooks numbers are more than 3 days old. Check that the morning report emails are still being sent.</p>` : ""}
      <div class="cash-grid">
        <div class="card wk cash-tile" data-explain="owed" role="button" tabindex="0" aria-label="How this is worked out"><div class="wk-label">Owed to you</div><div class="wk-num">${k.hasAr ? money(k.owed) : "–"}</div>
          <p class="wk-sub">${k.hasAr ? `<b class="neg">${money(k.owedLate)} past due</b>${k.credits ? ` · ${money(k.credits)} in credits to apply` : ""}` : "Needs the A/R Aging Detail"}</p><span class="tile-how">How this is worked out ›</span></div>
        <div class="card wk cash-tile" data-explain="owe" role="button" tabindex="0" aria-label="How this is worked out"><div class="wk-label">Bills you owe</div><div class="wk-num brown">${k.hasAp ? money(k.owe) : "–"}</div>
          <p class="wk-sub">${k.hasAp ? `<b class="neg">${money(k.oweLate)} past due</b>${k.billCredits ? ` · ${money(k.billCredits)} paid but not matched` : ""}` : "Needs the A/P Aging Detail"}</p><span class="tile-how">How this is worked out ›</span></div>
        <div class="card wk cash-tile" data-explain="soon" role="button" tabindex="0" aria-label="How this is worked out"><div class="wk-label">Next 2 weeks</div><div class="wk-num ${k.soonIn - k.soonOut < 0 ? "neg" : ""}">${k.soonIn - k.soonOut < 0 ? "−" : ""}${money(Math.abs(k.soonIn - k.soonOut))}</div>
          <p class="wk-sub">${money(k.soonIn)} coming due in · ${money(k.soonOut)} bills due out</p><p class="wk-note">Not counting anything already late</p><span class="tile-how">How this is worked out ›</span></div>
        <div class="card wk cash-tile" data-explain="bank" role="button" tabindex="0" aria-label="How this is worked out"><div class="wk-label">In the bank</div><div class="wk-num">${k.bank != null ? money(k.bank) : "–"}</div>
          <p class="wk-sub">${k.bank != null ? `${k.undeposited ? `${money(k.undeposited)} waiting to be deposited · ` : ""}${k.cards ? `${money(k.cards)} on credit cards` : `As of ${esc(niceDate(k.bankAsOf))}`}` : "Shows once the Balance Sheet email arrives"}</p><span class="tile-how">How this is worked out ›</span></div>
      </div>
      ${k.fc ? `<a class="fc-strip ${k.fc.low.end < k.fc.cushion ? "tight" : ""}" href="#forecast">
        <span><b>Next 13 weeks:</b> lowest point ${k.fc.low.end < 0 ? "−" : ""}${money(Math.abs(k.fc.low.end))} the week of ${esc(fcWeek(k.fc.low.from))}${k.fc.low.end < k.fc.cushion ? ", less than a month of spending" : ""}.</span>
        <span class="fc-go">Cash forecast ›</span></a>` : ""}
      <div class="dash-two cash-two">
        <div class="card">
          <div class="tips-head"><h3 class="dash-h3" style="margin:0">Today's cash to-dos</h3>
            <button type="button" class="link-btn" data-history>History${k.history.length ? ` (${k.history.length})` : ""}</button></div>
          ${k.tips.length ? `<ol class="tips">${k.tips.slice(0, 6).map(tipLi).join("")}</ol>
            ${k.tips.length > 6 ? `<details class="tips-more"><summary>${plural(k.tips.length - 6, "more suggestion")}</summary><ol class="tips">${k.tips.slice(6).map((t, i) => tipLi(t, i + 6)).join("")}</ol></details>` : ""}`
            : `<p class="muted">Nothing pressing. Nice.</p>`}
        </div>
        <div class="card">
          <h3 class="dash-h3" style="margin-top:0">Money in and out by month</h3>
          ${k.hist.length ? `<div class="mchart" role="img" aria-label="Money in and out by month">${k.hist.map((x) => `
            <div class="mcol" title="${esc(x.m)}: in ${money(x.inc)}, out ${money(x.out)}, left ${money(x.net)}">
              <div class="mbars"><i class="in" style="--h:${(Math.max(0, x.inc) / max) * 100}%"></i><i class="out" style="--h:${(Math.max(0, x.out) / max) * 100}%"></i></div>
              <span class="mnet ${x.net < 0 ? "neg" : ""}">${Math.round(x.net / 1000) < 0 ? "−" : ""}${Math.abs(Math.round(x.net / 1000))}k</span>
              <span class="mlabel">${esc(short(x.m))}</span></div>`).join("")}</div>
            <p class="small muted mlegend"><i class="in"></i> Came in <i class="out"></i> Went out. The number under each month is what was left (cash basis). The last 3 months averaged ${money(k.avgIn)} in and ${money(k.avgOut)} out. <button type="button" class="link-btn" data-explain="chart">How this is worked out</button></p>`
            : `<p class="muted small">Shows once the monthly Profit and Loss arrives.</p>`}
        </div>
      </div>`;
  }

  // =====================================================================
  // Download the explanations: Excel (one sheet per number) or PDF
  // =====================================================================
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the download tool.")); document.head.appendChild(s); });
  }
  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const cleanSecs = (x) => x.sections.filter((s) => s && s.rows.length);
  const fileStamp = () => isoDate(new Date());

  async function downloadExcel(list, name) {
    if (!window.ExcelJS) await loadScript("vendor/exceljs.min.js");
    const wb = new window.ExcelJS.Workbook();
    wb.creator = "Harmony Horticulture";
    const F = (o = {}) => ({ name: "Montserrat", size: 10, ...o });
    const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
    list.forEach((x) => {
      const ws = wb.addWorksheet(x.title.replace(/[\\/?*[\]:]/g, "").slice(0, 31));
      ws.columns = [{ width: 46 }, { width: 52 }, { width: 16 }];
      ws.mergeCells(1, 1, 1, 3);
      const t = ws.getCell(1, 1);
      t.value = x.title.toUpperCase() + (x.total != null ? `  ·  ${money(x.total)}` : "");
      t.font = F({ size: 15, bold: true, color: { argb: "FFFFFFFF" } }); t.fill = fill("FF5F351B"); t.alignment = { vertical: "middle", indent: 1 };
      ws.getRow(1).height = 30;
      ws.mergeCells(2, 1, 2, 3);
      ws.getCell(2, 1).value = `From ${x.source} · downloaded ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
      ws.getCell(2, 1).font = F({ size: 9, color: { argb: "FF595959" } });
      let r = 4;
      ws.getCell(r, 1).value = "HOW THIS IS WORKED OUT"; ws.getCell(r, 1).font = F({ size: 9, bold: true, color: { argb: "FFF065A5" } }); r++;
      x.how.filter(Boolean).forEach((p) => {
        ws.mergeCells(r, 1, r, 3);
        const c = ws.getCell(r, 1); c.value = p; c.font = F(); c.alignment = { wrapText: true, vertical: "top" };
        ws.getRow(r).height = Math.max(16, Math.ceil(p.length / 110) * 15); r++;
      });
      cleanSecs(x).forEach((sec) => {
        r++;
        const head = ws.getRow(r);
        [sec.h.toUpperCase(), "DETAIL", "AMOUNT"].forEach((h, i) => {
          const c = head.getCell(i + 1); c.value = h; c.font = F({ size: 9, bold: true, color: { argb: "FFFFFFFF" } }); c.fill = fill("FF009344");
          if (i === 2) c.alignment = { horizontal: "right" };
        });
        r++;
        const first = r;
        sec.rows.forEach(([a, v, sub], i) => {
          const row = ws.getRow(r);
          row.getCell(1).value = a; row.getCell(2).value = sub || ""; row.getCell(3).value = Number(v || 0);
          row.eachCell({ includeEmpty: true }, (c) => { c.font = F({ size: 9 }); c.border = { bottom: { style: "thin", color: { argb: "FFE2E2E2" } } }; if (i % 2) c.fill = fill("FFF2F2F2"); });
          row.getCell(3).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
          r++;
        });
        const tot = ws.getRow(r);
        tot.getCell(1).value = "Total"; tot.getCell(3).value = { formula: `SUM(C${first}:C${r - 1})` };
        tot.getCell(1).font = F({ size: 9, bold: true }); tot.getCell(3).font = F({ size: 9, bold: true });
        tot.getCell(3).numFmt = '"$"#,##0.00;[Red]-"$"#,##0.00';
        tot.getCell(3).border = { top: { style: "thin", color: { argb: "FF5F351B" } } };
        r++;
      });
    });
    const buf = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${name} ${fileStamp()}.xlsx`);
  }

  async function downloadPdf(list, name) {
    if (!window.jspdf) await loadScript("vendor/jspdf.umd.min.js");
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48;
    const BROWN = [95, 53, 27], PINK = [240, 101, 165], GREEN = [0, 147, 68], GRAY = [89, 89, 89], RED = [179, 38, 30];
    const amt = (v) => `${v < 0 ? "-" : ""}${money(Math.abs(v))}`;
    // jsPDF's built-in font has no "−" or "·" in some viewers; keep to plain characters
    const plain = (t) => String(t).replace(/[−–]/g, "-").replace(/·/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/›|↗/g, "");
    let y;
    const footer = () => {
      doc.setFillColor(...GREEN); doc.rect(0, H - 10, W, 10, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
      doc.text(plain(`Harmony Horticulture · cash flow · downloaded ${new Date().toLocaleDateString("en-US")}`), M, H - 20);
      doc.text(`Page ${doc.getNumberOfPages()}`, W - M, H - 20, { align: "right" });
    };
    const room = (h) => { if (y + h > H - 40) { footer(); doc.addPage(); y = M; } };
    list.forEach((x, n) => {
      if (n) { footer(); doc.addPage(); }
      doc.setFillColor(...BROWN); doc.rect(0, 0, W, 64, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(255, 255, 255);
      doc.text(plain(x.title.toUpperCase() + (x.total != null ? `  -  ${amt(x.total)}` : "")), M, 40);
      y = 86;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...GRAY);
      doc.text(plain(`From ${x.source}`), M, y); y += 22;
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...PINK);
      doc.text("HOW THIS IS WORKED OUT", M, y); y += 14;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(30, 30, 30);
      x.how.filter(Boolean).forEach((p) => {
        const lines = doc.splitTextToSize(plain(p), W - 2 * M);
        room(lines.length * 13 + 6); doc.text(lines, M, y); y += lines.length * 13 + 6;
      });
      cleanSecs(x).forEach((sec) => {
        const total = sec.rows.reduce((t, r) => t + Number(r[1] || 0), 0);
        room(40); y += 10;
        doc.setFillColor(...GREEN); doc.rect(M, y - 11, W - 2 * M, 16, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
        doc.text(plain(sec.h.toUpperCase()), M + 6, y); doc.text(plain(`${sec.rows.length} lines - ${amt(total)}`), W - M - 6, y, { align: "right" });
        y += 18;
        sec.rows.forEach(([a, v, sub]) => {
          const subLines = sub ? doc.splitTextToSize(plain(sub), W - 2 * M - 110) : [];
          room(14 + subLines.length * 11 + 6);
          doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30);
          doc.text(doc.splitTextToSize(plain(a), W - 2 * M - 110)[0], M + 6, y);
          doc.setTextColor(...(v < 0 ? RED : [30, 30, 30])); doc.text(plain(amt(v)), W - M - 6, y, { align: "right" });
          y += 12;
          if (subLines.length) { doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GRAY); doc.text(subLines, M + 6, y); y += subLines.length * 11; }
          doc.setDrawColor(226, 226, 226); doc.line(M, y - 4, W - M, y - 4); y += 8;
        });
      });
    });
    footer();
    saveBlob(doc.output("blob"), `${name} ${fileStamp()}.pdf`);
  }
  async function runDownload(kind, list, name, btn) {
    const was = btn && btn.textContent;
    if (btn) { btn.disabled = true; btn.textContent = "Preparing…"; }
    try { await (kind === "pdf" ? downloadPdf : downloadExcel)(list, name); }
    catch (e) { console.error(e); toast("Couldn't make the download: " + e.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = was; } }
  }

  function openExplain(x) {
    const root = $("#modalRoot");
    const amt = (v) => `${v < 0 ? "−" : ""}${money(Math.abs(v))}`;
    const secs = x.sections.filter((sec) => sec && sec.rows.length);
    root.innerHTML = `<div class="modal-back"><div class="modal wide" role="dialog" aria-modal="true">
      <div class="lc-head"><div><p class="eyebrow">How this is worked out</p><h2 class="lc-title">${esc(x.title)}${x.total != null ? ` · ${esc(amt(x.total))}` : ""}</h2>
        <p class="small muted" style="margin:2px 0 0">From: ${esc(x.source)}</p></div>
        <button type="button" class="lc-x secondary" data-close aria-label="Close">✕</button></div>
      <div class="how">${x.how.filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join("")}</div>
      ${secs.map((sec) => `<h3 class="dash-h3">${esc(sec.h)} <span class="muted small">${plural(sec.rows.length, "line")} · ${esc(amt(sec.rows.reduce((t, r) => t + Number(r[1] || 0), 0)))}</span></h3>
        <table class="how-table"><tbody>${sec.rows.map(([a, v, sub]) => `<tr><td><strong>${esc(a)}</strong>${sub ? `<span>${esc(sub)}</span>` : ""}</td><td class="num ${v < 0 ? "neg" : ""}">${esc(amt(v))}</td></tr>`).join("")}</tbody></table>`).join("")}
      <div class="btn-row" style="justify-content:flex-end;margin-top:16px">
        <button type="button" class="secondary" data-dl="xlsx">Download Excel</button>
        <button type="button" class="secondary" data-dl="pdf">Download PDF</button>
        <a class="btn secondary" href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.linkLabel)}</a></div>
    </div></div>`;
    $$("[data-dl]", root).forEach((b) => (b.onclick = () => runDownload(b.dataset.dl, [x], `Harmony Horticulture ${x.title}`, b)));
    const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    $("[data-close]", root).onclick = close;
    $(".modal-back", root).onclick = (e) => { if (e.target.classList.contains("modal-back")) close(); };
  }

  function openHistory(rows) {
    const root = $("#modalRoot");
    const when = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    root.innerHTML = `<div class="modal-back"><div class="modal wide" role="dialog" aria-modal="true">
      <div class="lc-head"><div><p class="eyebrow">Cash to-dos</p><h2 class="lc-title">History</h2><p class="small muted" style="margin:2px 0 0">Everything marked done or dismissed, newest first. Undo puts it back on the list.</p></div>
        <button type="button" class="lc-x secondary" data-close aria-label="Close">✕</button></div>
      ${rows.length ? `<ul class="hist-list">${rows.map((r) => `<li>
        <span class="hist-pill ${r.action}">${r.action === "done" ? "Done" : "Dismissed"}</span>
        <div class="hist-main"><strong>${esc(r.title)}</strong>${r.detail ? `<span>${esc(r.detail)}</span>` : ""}
          <span class="hist-meta">${esc(when(r.acted_at))}${r.acted_by_name ? ` · ${esc(r.acted_by_name.split(" ")[0])}` : ""}</span></div>
        <button type="button" class="link-btn" data-undo="${esc(r.todo_key)}">Undo</button></li>`).join("")}</ul>`
        : `<p class="muted">Nothing yet. When you mark a to-do done or dismiss it, it shows here with the date.</p>`}
    </div></div>`;
    const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    $("[data-close]", root).onclick = close;
    $(".modal-back", root).onclick = (e) => { if (e.target.classList.contains("modal-back")) close(); };
    $$("[data-undo]", root).forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await S.undo(b.dataset.undo); close(); toast("Back on the list."); await redraw(); } catch (e) { b.disabled = false; toast("Couldn't undo: " + e.message); }
    }));
  }

  function toast(msg) {
    let t = $("#dashToast");
    if (!t) { t = document.createElement("div"); t.id = "dashToast"; t.className = "toast dash-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600);
  }
  let redraw = async () => {};

  function openList(a) {
    const root = $("#modalRoot");
    const rows = a.list.slice(0, 60).map(a.row);
    root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">
      <div class="lc-head"><div><p class="eyebrow">${esc(a.eyebrow || "Needs attention")}</p><h2 class="lc-title">${esc(a.label)}</h2><p class="small muted" style="margin:2px 0 0">${esc(a.sub)}</p></div>
        <button type="button" class="lc-x secondary" data-close aria-label="Close">✕</button></div>
      ${rows.length ? `<ul class="att-list">${rows.map(([t, s, href]) => `<li><a href="${esc(href)}"><strong>${esc(t)}</strong><span>${esc(s)}</span></a></li>`).join("")}</ul>` : `<p class="muted">Nothing here. Nice.</p>`}
      ${a.list.length > rows.length ? `<p class="small muted">Showing ${rows.length} of ${a.list.length}.</p>` : ""}
      <div class="btn-row" style="justify-content:flex-end;margin-top:14px"><a class="btn secondary" href="${esc(a.all)}">${esc(a.allLabel || "Open Leads")}</a></div>
    </div></div>`;
    const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    $("[data-close]", root).onclick = close;
    $(".modal-back", root).onclick = (e) => { if (e.target.classList.contains("modal-back")) close(); };
  }

  // =====================================================================
  // Sign in and the shell
  // =====================================================================
  function showAuth(msg) {
    $("#loading").classList.add("hidden");
    $("#appView").classList.add("hidden");
    $("#authView").classList.remove("hidden");
    $("#authContent").innerHTML = `<h1>Sign in</h1>
      ${msg ? `<p class="error-text" style="text-align:center">${esc(msg)}</p>` : ""}
      <form id="signInForm">
        <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required></div>
        <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
        <button class="primary" type="submit">Sign in</button>
      </form>
      <p class="small muted" style="text-align:center;margin-top:14px">Same email and password as the Reports app and the Time Tracker.</p>`;
    $("#signInForm").onsubmit = async (e) => {
      e.preventDefault();
      try { await S.signIn($("#em").value.trim(), $("#pw").value); await start(); } catch (err) { showAuth(err.message); }
    };
  }

  function shell(me) {
    $("#loading").classList.add("hidden");
    $("#authView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    $("#whoName").textContent = me.full_name || me.email;
    $("#whoRole").textContent = "Admin";
    $("#demoBanner").classList.toggle("hidden", !DEMO);
    const q = DEMO ? "?demo" : "";
    $("#sideNav").innerHTML = `<a class="nav-link" data-page="" href="dashboard.html${q}#">Dashboard</a>
      <a class="nav-link nav-sub" data-page="forecast" href="dashboard.html${q}#forecast">Cash forecast</a>
      <a class="nav-link" href="leads.html${q}">Leads</a>
      <a class="nav-link" href="index.html${q}">Reports</a>
      <a class="nav-link" href="${esc(TT)}">Time tracker ↗</a>`;
    $("#bottomNav").innerHTML = `<a class="nav-link" data-page="" href="dashboard.html${q}#">Home</a><a class="nav-link" data-page="forecast" href="dashboard.html${q}#forecast">Forecast</a><a class="nav-link" href="leads.html${q}">Leads</a><a class="nav-link" href="index.html${q}">Reports</a><a class="nav-link" href="${esc(TT)}">Time</a>`;
    markNav();
    const out = async () => { await S.signOut(); location.reload(); };
    $("#signOutBtn").onclick = out;
    $("#signOutBtnMobile").onclick = out;
  }

  function markNav() {
    const page = location.hash.replace("#", "");
    $$("[data-page]").forEach((a) => a.classList.toggle("active", a.dataset.page === page));
  }

  async function start() {
    try {
      const me = await S.me();
      if (!me) return showAuth();
      if (!me.active) return showAuth("Your account is switched off. Ask an admin.");
      // The dashboard is for admins; everyone else goes to Reports
      if (me.role !== "admin") { location.replace("index.html"); return; }
      try { sessionStorage.setItem("hh-dash-seen", "1"); } catch (e) { /* private mode */ }
      shell(me);
      const draw = async () => render(await S.load(), me);
      redraw = draw;
      await draw();
      window.addEventListener("hashchange", () => { markNav(); window.scrollTo(0, 0); draw().catch(console.error); });
      // Keep it current while it's open
      if (!DEMO) setInterval(() => { if (document.visibilityState === "visible" && !$("#modalRoot").innerHTML) draw().catch(console.error); }, 5 * 60 * 1000);
    } catch (e) {
      console.error(e);
      showAuth(e.message || "Something went wrong.");
    }
  }
  start();
})();
