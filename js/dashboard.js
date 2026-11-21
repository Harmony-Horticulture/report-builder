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
        const [leads, notes, intakes, reports, sends, entries, services, clients, people] = await Promise.all([
          soft(sb.from("leads").select("id, lead_date, created_at, updated_at, project_name, contact_name, company, email, phone, channel, stage, in_quickbooks, won_at, details")),
          soft(sb.from("lead_notes").select("lead_id, created_at, author_name, body, automatic").order("created_at", { ascending: false }).limit(60)),
          soft(sb.from("lead_intakes").select("lead_id, source, submitted_at").order("submitted_at", { ascending: false }).limit(30)),
          soft(sb.from("reports").select("id, client_name, property, status, consultant, type_name, created_at, updated_at, sent_at, user_id")),
          soft(sb.from("report_sends").select("report_id, sent_by, sent_to, sent_at").order("sent_at", { ascending: false }).limit(30)),
          soft(sb.from("time_entries").select("id, user_id, client_id, property, entry_date, hours, service_type_id, site_minimum_amount, status, qb_exported_at, created_at, entry_materials(quantity, unit_price)").gte("entry_date", since)),
          soft(sb.from("service_types").select("id, name, rate, billable")),
          soft(sb.from("clients").select("id, name")),
          soft(sb.from("profiles").select("id, full_name, email")),
        ]);
        return { leads, notes, intakes, reports, sends, entries, services, clients, people };
      },
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
    return { async me() { return me; }, async signIn() {}, async signOut() {}, async load() { return { leads, notes, intakes, reports, sends, entries, services, clients, people }; } };
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

    $("#view").innerHTML = `
      <div class="dash-head">
        <div><p class="eyebrow">${esc(new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))}</p>
          <h1>${hello}${first ? ", " + esc(first) : ""}</h1></div>
        <div class="dash-quick">
          <a class="btn" href="leads.html${Q}#add">+ Add a lead</a>
          <a class="btn secondary" href="index.html#/new">New report</a>
          <a class="btn secondary" href="${esc(TT)}">Approve time ↗</a>
          <a class="btn secondary" href="${esc(TT)}">Export to QuickBooks ↗</a>
        </div>
      </div>

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

    $$("[data-att]").forEach((b) => (b.onclick = () => {
      const a = ATT.find((x) => x.k === b.dataset.att);
      openList(a);
    }));
  }

  function openList(a) {
    const root = $("#modalRoot");
    const rows = a.list.slice(0, 60).map(a.row);
    root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">
      <div class="lc-head"><div><p class="eyebrow">Needs attention</p><h2 class="lc-title">${esc(a.label)}</h2><p class="small muted" style="margin:2px 0 0">${esc(a.sub)}</p></div>
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
    $("#sideNav").innerHTML = `<a class="nav-link active" href="dashboard.html${q}">Dashboard</a>
      <a class="nav-link" href="leads.html${q}">Leads</a>
      <a class="nav-link" href="index.html${q}">Reports</a>
      <a class="nav-link" href="${esc(TT)}">Time tracker ↗</a>`;
    $("#bottomNav").innerHTML = `<a class="nav-link active" href="dashboard.html${q}">Home</a><a class="nav-link" href="leads.html${q}">Leads</a><a class="nav-link" href="index.html${q}">Reports</a><a class="nav-link" href="${esc(TT)}">Time</a>`;
    const out = async () => { await S.signOut(); location.reload(); };
    $("#signOutBtn").onclick = out;
    $("#signOutBtnMobile").onclick = out;
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
      await draw();
      // Keep it current while it's open
      if (!DEMO) setInterval(() => { if (document.visibilityState === "visible" && !$("#modalRoot").innerHTML) draw().catch(console.error); }, 5 * 60 * 1000);
    } catch (e) {
      console.error(e);
      showAuth(e.message || "Something went wrong.");
    }
  }
  start();
})();
