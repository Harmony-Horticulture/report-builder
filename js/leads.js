// =====================================================================
// Harmony Horticulture Leads: every new lead in one place.
// Phone calls, texts and emails are added here by hand; the website
// form and the intake form arrive on their own (supabase/functions/
// leads-inbox). Slack gets a message for each one.
// Uses the same login and database as the Report Builder and Time Tracker.
// =====================================================================
(function () {
  const cfg = window.HH_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const LIVE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) && !params.has("demo");
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const appUrl = () => location.origin + location.pathname.replace(/[^/]*$/, "");

  const STAGES = [
    ["new", "New"], ["contacted", "Contacted"], ["intake_sent", "Waiting on intake form"],
    ["intake_received", "Intake received"], ["scheduled", "Site visit scheduled"],
    ["proposal_sent", "Proposal sent"], ["won", "Won"], ["lost", "Lost"],
  ];
  const STAGE = Object.fromEntries(STAGES);
  const CHANNELS = [
    ["phone", "Phone call"], ["text", "Text"], ["email", "Email"], ["website", "Website form"],
    ["intake_form", "Intake form"], ["referral", "Referral"], ["other", "Other"],
  ];
  const CHANNEL = Object.fromEntries(CHANNELS);
  const OPEN = ["new", "contacted", "intake_sent", "intake_received", "scheduled", "proposal_sent"];

  // -------------------------------------------------------------------
  // Data: Supabase when connected, otherwise a demo copy in this browser
  // -------------------------------------------------------------------
  function liveStore() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const ok = (res) => { if (res.error) throw new Error(friendly(res.error)); return res.data; };
    let meCache = null;
    return {
      mode: "live",
      async me() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return null;
        const p = ok(await sb.from("profiles").select("id, email, full_name, role, active").eq("id", data.session.user.id).single());
        meCache = p;
        return p;
      },
      async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
      async signOut() { await sb.auth.signOut(); },
      async leads() {
        return ok(await sb.from("leads").select("*").order("lead_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }));
      },
      async lead(id) { return ok(await sb.from("leads").select("*").eq("id", id).single()); },
      async intakes(id) { return ok(await sb.from("lead_intakes").select("*").eq("lead_id", id).order("submitted_at", { ascending: false })); },
      async notes(id) { return ok(await sb.from("lead_notes").select("*").eq("lead_id", id).order("created_at", { ascending: false })); },
      async people() { try { return ok(await sb.rpc("lead_people")); } catch (e) { return []; } },
      async update(id, patch) { return ok(await sb.from("leads").update(patch).eq("id", id).select("*").single()); },
      async add(row) { return ok(await sb.from("leads").insert({ ...row, created_by: meCache && meCache.id }).select("*").single()); },
      async remove(id) { ok(await sb.from("leads").delete().eq("id", id)); },
      async addNote(lead_id, body) {
        return ok(await sb.from("lead_notes").insert({ lead_id, body, author_id: meCache.id, author_name: meCache.full_name || meCache.email }).select("*").single());
      },
      async notify(lead_id) {
        const { data, error } = await sb.functions.invoke("leads-inbox", { body: { notify_lead_id: lead_id, app_url: appUrl() } });
        if (error) {
          let msg = error.message;
          try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* keep the generic message */ }
          throw new Error(msg);
        }
        return data;
      },
    };
  }

  function demoStore() {
    const KEY = "hh-leads-demo-v1";
    const now = Date.now();
    const day = 864e5;
    const d = (n) => isoDate(new Date(now - n * day));
    const seed = () => {
      const L = (id, n, o) => ({
        id, lead_date: d(n), created_at: new Date(now - n * day).toISOString(), updated_at: new Date(now - n * day).toISOString(),
        project_name: "", contact_name: "", company: "", email: "", phone: "", address: "", property_type: "", service: "",
        request: "", goals: "", budget: "", newsletter: null, channel: "phone", heard_about: "", stage: "new", next_steps: "",
        zone_quote: null, site_notes: "", assigned_to: null, in_quickbooks: false, closed_reason: "", ...o,
      });
      return {
        leads: [
          L("d1", 0, { project_name: "Marigold Residence", contact_name: "Jamie Marigold", email: "jamie@example.com", phone: "480-555-0101", address: "100 E Example Rd, Scottsdale, AZ 85260", channel: "website", heard_about: "Internet Search", property_type: "Estate / Large Residential", service: "Ongoing consulting", request: "Citrus grove looks stressed after the summer. Lemons doing well, limes dropping leaves.", goals: "A care plan our landscaper can follow.", budget: "Wants to learn scope and fees first", newsletter: true }),
          L("d2", 1, { project_name: "Saguaro Heights HOA", contact_name: "Pat Rivera", company: "Saguaro Heights HOA", email: "pat@example.org", phone: "602-555-0144", address: "200 N Sample Way, Phoenix, AZ 85018", channel: "intake_form", stage: "intake_received", service: "Oversight", request: "Common area plants failing near the entrance. Board wants a landscape plan.", zone_quote: 350, next_steps: "Robbie to schedule site visit" }),
          L("d3", 2, { project_name: "Ocotillo Residence", contact_name: "Chris Ocotillo", phone: "480-555-0177", channel: "phone", stage: "intake_sent", request: "Voicemail: two palms dying in the back yard, wants someone to take a look.", zone_quote: 400, next_steps: "Sent intake form link, waiting" }),
          L("d4", 5, { project_name: "Agave Residence", contact_name: "Sam Agave", email: "sam@example.net", phone: "602-555-0122", channel: "text", stage: "proposal_sent", request: "Roses keep dying, wants a diagnosis and a planting plan.", zone_quote: 350, next_steps: "Proposal sent 11/15, follow up 11/22" }),
          L("d5", 9, { project_name: "Palo Verde Residence", contact_name: "Alex Verde", email: "alex@example.com", phone: "480-555-0199", channel: "referral", heard_about: "Megan Bert", stage: "won", won_at: new Date(now - day).toISOString(), request: "Monthly oversight of the estate grounds.", in_quickbooks: true }),
          L("d6", 15, { project_name: "Mesquite Residence", contact_name: "Robin Mesquite", phone: "602-555-0133", channel: "phone", stage: "lost", closed_reason: "Found someone else", request: "Lemon tree dying." }),
        ],
        intakes: [
          { id: "i1", lead_id: "d2", source: "intake_form", submitted_at: new Date(now - day).toISOString(), answers: [
            { q: "Name", a: "Pat Rivera" }, { q: "Email", a: "pat@example.org" }, { q: "Phone", a: "602-555-0144" },
            { q: "Property Name", a: "Saguaro Heights HOA" }, { q: "Address", a: "200 N Sample Way, Phoenix, AZ 85018" },
            { q: "Frequency", a: "Oversight" }, { q: "What is the issue?", a: "Common area plants failing near the entrance. Board wants a landscape plan." },
            { q: "Photos", a: "https://drive.google.com/open?id=example" } ] },
          { id: "i2", lead_id: "d1", source: "website", submitted_at: new Date(now).toISOString(), answers: [
            { q: "Property type", a: "Estate / Large Residential" }, { q: "Project scope", a: "Ongoing consulting" },
            { q: "Issue / project", a: "Citrus grove looks stressed after the summer. Lemons doing well, limes dropping leaves." },
            { q: "Goals", a: "A care plan our landscaper can follow." }, { q: "How did you hear about us", a: "Internet Search" } ] },
        ],
        notes: [
          { id: 1, lead_id: "d2", created_at: new Date(now - day).toISOString(), author_name: "Automatic", automatic: true, body: "Intake form received" },
          { id: 2, lead_id: "d3", created_at: new Date(now - 2 * day).toISOString(), author_name: "Kasey", automatic: false, body: "Called back, left a message and texted the intake form link." },
        ],
      };
    };
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch (e) { return seed(); } };
    let db = load();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* private mode */ } };
    const me = { id: "demo-admin", email: "demo@harmonyhorticulture.com", full_name: "Demo Admin", role: "admin", active: true };
    return {
      mode: "demo",
      async me() { return me; },
      async signIn() {}, async signOut() { localStorage.removeItem(KEY); db = seed(); },
      async leads() {
        return db.leads.slice().sort((a, b) => (b.lead_date || "").localeCompare(a.lead_date || "") || b.created_at.localeCompare(a.created_at));
      },
      async lead(id) { const l = db.leads.find((x) => x.id === id); if (!l) throw new Error("Lead not found."); return { ...l }; },
      async intakes(id) { return db.intakes.filter((x) => x.lead_id === id); },
      async notes(id) { return db.notes.filter((x) => x.lead_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
      async people() { return [{ id: "demo-admin", full_name: "Demo Admin" }, { id: "p2", full_name: "Robbie Stephens" }, { id: "p3", full_name: "Kasey Harman" }]; },
      async update(id, patch) {
        const l = db.leads.find((x) => x.id === id);
        if (patch.stage && patch.stage !== l.stage) db.notes.push({ id: Date.now(), lead_id: id, created_at: new Date().toISOString(), author_name: me.full_name, automatic: true, body: "Stage changed to " + STAGE[patch.stage] });
        if (patch.stage && patch.stage !== l.stage) l.won_at = patch.stage === "won" ? new Date().toISOString() : null;
        Object.assign(l, patch, { updated_at: new Date().toISOString() });
        save();
        return { ...l };
      },
      async add(row) {
        const l = { id: "d" + Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), lead_date: isoDate(new Date()),
          project_name: "", contact_name: "", company: "", email: "", phone: "", address: "", property_type: "", service: "", request: "", goals: "",
          budget: "", newsletter: null, channel: "phone", heard_about: "", stage: "new", next_steps: "", zone_quote: null, site_notes: "",
          assigned_to: null, in_quickbooks: false, closed_reason: "", ...row };
        db.leads.push(l); save(); return l;
      },
      async remove(id) { db.leads = db.leads.filter((x) => x.id !== id); save(); },
      async addNote(lead_id, body) { const n = { id: Date.now(), lead_id, body, created_at: new Date().toISOString(), author_name: me.full_name, automatic: false }; db.notes.push(n); save(); return n; },
      async notify() { return { ok: true, slack: "demo" }; },
    };
  }

  function friendly(err) {
    const msg = (err && (err.message || String(err))) || "Something went wrong.";
    if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
    if (/Invalid login credentials/i.test(msg)) return "That email and password don't match.";
    if (/relation .*leads.* does not exist|Could not find the table/i.test(msg)) return "The leads tables aren't set up in Supabase yet. Run supabase/02_leads.sql (see docs/LEADS.md).";
    if (/Failed to fetch|NetworkError/i.test(msg)) return "Can't reach the server. Check your connection and try again.";
    return msg;
  }

  const S = LIVE ? liveStore() : demoStore();
  const DEFAULT_FILTERS = { q: "", stage: "all", channel: "", person: "", sort: "stage", dir: "asc" };
  // Columns you can sort by. Each gives a value to compare; ties fall back to newest first.
  const SORTS = {
    stage: { label: "Stage", val: (l) => STAGES.findIndex(([k]) => k === l.stage) },
    date: { label: "Date", val: (l) => String(l.lead_date || "") + String(l.created_at || "") },
    lead: { label: "Lead name", val: (l) => displayName(l).toLowerCase() },
    contact: { label: "Contact", val: (l) => String(l.contact_name || "").toLowerCase() },
    channel: { label: "Came in by", val: (l) => String(CHANNEL[l.channel] || l.channel).toLowerCase() },
    next: { label: "Next steps", val: (l) => String(l.next_steps || "").toLowerCase() },
    qb: { label: "In QuickBooks", val: (l) => (l.in_quickbooks ? 1 : 0) },
  };
  // Direction a column starts in when first clicked
  const FIRST_DIR = { stage: "asc", date: "desc", lead: "asc", contact: "asc", channel: "asc", next: "asc", qb: "desc" };
  const state = { me: null, leads: [], people: [], f: { ...DEFAULT_FILTERS }, highlight: null };
  try { Object.assign(state.f, JSON.parse(sessionStorage.getItem("hh-leads-filters-v3") || "{}")); } catch (e) { /* ignore */ }
  const isAdmin = () => state.me && state.me.role === "admin";

  // --- small UI helpers ------------------------------------------------
  let toastTimer;
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), isError ? 6000 : 2600);
  }
  const fail = (e) => { console.error(e); toast(friendly(e), true); };
  function modal(html, wide) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-back"><div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div></div>`;
    const m = $(".modal", root);
    const close = () => { root.innerHTML = ""; };
    $(".modal-back", root).addEventListener("click", (e) => { if (e.target.classList.contains("modal-back")) close(); });
    return { m, close };
  }
  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e2) { /* nothing else to try */ }
      ta.remove();
    }
    if (btn) { const old = btn.textContent; btn.textContent = "Copied"; btn.classList.add("done"); setTimeout(() => { btn.textContent = old; btn.classList.remove("done"); }, 1400); }
    else toast("Copied");
  }
  const niceDate = (iso) => {
    if (!iso) return "";
    const [y, m, dd] = String(iso).slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: y === new Date().getFullYear() ? undefined : "numeric" });
  };
  const niceTime = (ts) => new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const stageBadge = (s) => `<span class="stage ${esc(s)}">${esc(STAGE[s] || s)}</span>`;
  const telHref = (p) => String(p || "").replace(/[^\d+]/g, "");
  const linkify = (t) => esc(t).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.includes("drive.google.com") ? "Open file in Google Drive" : u}</a>`);
  const personName = (id) => (state.people.find((p) => p.id === id) || {}).full_name || "";
  const displayName = (l) => l.project_name || l.contact_name || l.company || l.email || l.phone || "No name";

  // =====================================================================
  // Sign in and the shell
  // =====================================================================
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
      <p class="small muted" style="text-align:center;margin-top:14px">Same email and password as the Reports app and the Time Tracker. Forgot it? Reset it from the <a href="index.html">Reports app</a>.</p>`;
    $("#signInForm").onsubmit = async (e) => {
      e.preventDefault();
      try { await S.signIn($("#em").value.trim(), $("#pw").value); await start(); } catch (err) { showAuth(friendly(err)); }
    };
  }

  function renderShell() {
    $("#loading").classList.add("hidden");
    $("#authView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    $("#whoName").textContent = state.me.full_name || state.me.email;
    $("#whoRole").textContent = { admin: "Admin", technician: "Technician" }[state.me.role] || "Consultant";
    $("#demoBanner").classList.toggle("hidden", S.mode !== "demo");
    const tt = esc(cfg.TIME_TRACKER_URL || "https://harmony-horticulture.github.io/time-tracker/");
    $("#sideNav").innerHTML = `<button type="button" class="active" data-home>Leads</button>
      <button type="button" data-add>+ Add a lead</button>
      <div class="nav-label">Apps</div>
      <a class="nav-link" href="index.html">Reports</a>
      <a class="nav-link" href="${tt}">Time tracker ↗</a>`;
    $("#bottomNav").innerHTML = `<button type="button" class="active" data-home>Leads</button><button type="button" data-add>+ Add</button><a class="nav-link" href="index.html">Reports</a><a class="nav-link" href="${tt}">Time</a>`;
    $$("[data-home]").forEach((b) => (b.onclick = () => { location.hash = ""; }));
    $$("[data-add]").forEach((b) => (b.onclick = () => openAdd()));
    const out = async () => { await S.signOut(); location.reload(); };
    $("#signOutBtn").onclick = out;
    $("#signOutBtnMobile").onclick = out;
  }

  async function start() {
    try {
      state.me = await S.me();
      if (!state.me) return showAuth();
      if (!state.me.active) return showAuth("Your account is switched off. Ask an admin.");
      renderShell();
      state.people = await S.people();
      await route();
    } catch (e) {
      $("#loading").classList.add("hidden");
      showAuth(friendly(e));
    }
  }

  async function route() {
    const m = location.hash.match(/lead=([\w-]+)/);
    window.scrollTo(0, 0);
    try {
      if (m) return await renderLead(m[1]);
      return await renderList();
    } catch (e) { fail(e); }
  }
  window.addEventListener("hashchange", route);

  // =====================================================================
  // The list
  // =====================================================================
  function matches(l) {
    const f = state.f;
    if (f.stage === "open" && !OPEN.includes(l.stage)) return false;
    if (f.stage && f.stage !== "open" && f.stage !== "all" && l.stage !== f.stage) return false;
    if (f.channel && l.channel !== f.channel) return false;
    if (f.person === "none" && l.assigned_to) return false;
    if (f.person && f.person !== "none" && l.assigned_to !== f.person) return false;
    if (f.q) {
      const hay = [l.project_name, l.contact_name, l.company, l.email, l.phone, l.address, l.request, l.next_steps, l.heard_about].join(" ").toLowerCase();
      const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
      const qDigits = f.q.replace(/\D/g, "");
      if (!words.every((w) => hay.includes(w)) && !(qDigits.length >= 4 && String(l.phone).replace(/\D/g, "").includes(qDigits))) return false;
    }
    return true;
  }

  async function renderList() {
    state.leads = await S.leads();
    const L = state.leads;
    const monthStart = isoDate(new Date()).slice(0, 7);
    const count = (fn) => L.filter(fn).length;
    const stats = [
      ["new", "New", "Need a first call", count((l) => l.stage === "new"), "pink"],
      ["intake_sent", "Waiting on intake", "Form sent, not back", count((l) => l.stage === "intake_sent"), ""],
      ["intake_received", "Ready to schedule", "Intake in, no visit yet", count((l) => l.stage === "intake_received"), "green"],
      ["proposal_sent", "Proposal sent", "Waiting on a yes", count((l) => l.stage === "proposal_sent"), "brown"],
      ["won", "Won this month", "", count((l) => l.stage === "won" && l.won_at && isoDate(new Date(l.won_at)).slice(0, 7) === monthStart), "green"],
    ];
    const f = state.f;
    $("#view").innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">Every call, text, email and form</p><h1>Leads</h1></div>
        <div class="btn-row">
          <button type="button" class="secondary" id="exportBtn">Export to Excel</button>
          <button type="button" id="addBtn">+ Add a lead</button>
        </div>
      </div>
      <div class="stat-row">${stats.map(([k, label, sub, n, color]) => `
        <button type="button" class="stat clickable ${color} ${f.stage === k ? "on" : ""}" data-stat="${k}">
          <div class="label">${label}</div><div class="num">${n}</div>${sub ? `<div class="sub">${sub}</div>` : ""}
        </button>`).join("")}
      </div>
      <div class="card" style="padding-bottom:12px">
        <div class="lead-filters">
          <div class="wide"><label for="fq">Search leads</label><input id="fq" type="search" placeholder="Search by name, phone, email, address or notes" value="${esc(f.q)}"></div>
          <div><label for="fs">Stage</label><select id="fs">
            <option value="all" ${f.stage === "all" ? "selected" : ""}>All leads</option>
            <option value="open" ${f.stage === "open" ? "selected" : ""}>Open leads only</option>
            ${STAGES.map(([k, v]) => `<option value="${k}" ${f.stage === k ? "selected" : ""}>${v}</option>`).join("")}
          </select></div>
          <div><label for="fc">Came in by</label><select id="fc"><option value="">Any</option>
            ${CHANNELS.map(([k, v]) => `<option value="${k}" ${f.channel === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div><label for="fp">Assigned to</label><select id="fp"><option value="">Anyone</option><option value="none" ${f.person === "none" ? "selected" : ""}>Not assigned</option>
            ${state.people.map((p) => `<option value="${esc(p.id)}" ${f.person === p.id ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select></div>
          <div><label for="fo">Sort by</label><select id="fo">
            ${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${f.sort === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></div>
        </div>
      </div>
      <div id="listOut"></div>`;
    const draw = () => {
      sessionStorage.setItem("hh-leads-filters-v3", JSON.stringify(state.f));
      // Sorted by the chosen column; ties go newest first. Blank values always go last.
      const srt = SORTS[state.f.sort] || SORTS.stage;
      const sign = state.f.dir === "desc" ? -1 : 1;
      const newest = (a, b) => String(b.lead_date || "").localeCompare(String(a.lead_date || "")) || String(b.created_at).localeCompare(String(a.created_at));
      const rows = L.filter(matches).sort((a, b) => {
        const va = srt.val(a), vb = srt.val(b);
        const ea = va === "" || va == null, eb = vb === "" || vb == null;
        if (ea !== eb) return ea ? 1 : -1;
        const c = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
        return c * sign || newest(a, b);
      });
      const th = (k, label, extra = "") => {
        const on = state.f.sort === k;
        return `<th ${extra}><button type="button" class="sort-btn ${on ? "on" : ""}" data-sort="${k}" title="Sort by ${esc(label)}">${label}<span class="arrow">${on ? (state.f.dir === "desc" ? "▼" : "▲") : "↕"}</span></button></th>`;
      };
      $$("[data-stat]").forEach((b) => b.classList.toggle("on", state.f.stage === b.dataset.stat));
      if (!rows.length) {
        $("#listOut").innerHTML = `<div class="card empty">${L.length ? "No leads match these filters." : "No leads yet. Add one, or they'll appear here when the website or intake form is filled in."}</div>`;
        return;
      }
      $("#listOut").innerHTML = `
        <p class="small muted" style="margin:0 0 8px">${rows.length} lead${rows.length === 1 ? "" : "s"}</p>
        <div class="card table-wrap leads-table" style="padding:6px 8px">
          <table class="leads"><thead><tr>${th("date", "Date")}${th("lead", "Lead")}${th("contact", "Contact")}${th("channel", "Came in by")}${th("stage", "Stage")}${th("next", "Next steps")}${th("qb", "QB", 'title="Added to QuickBooks"')}</tr></thead>
          <tbody>${rows.map((l) => `<tr data-id="${esc(l.id)}">
            <td>${esc(niceDate(l.lead_date))}</td>
            <td><div class="who">${esc(displayName(l))}</div><div class="sub">${esc(l.contact_name && l.contact_name !== displayName(l) ? l.contact_name : "")}${l.address ? `${l.contact_name && l.contact_name !== displayName(l) ? " · " : ""}${esc(l.address.slice(0, 48))}` : ""}</div></td>
            <td><div>${esc(l.phone)}</div><div class="sub">${esc(l.email)}</div></td>
            <td>${esc(CHANNEL[l.channel] || l.channel)}${l.heard_about ? `<div class="sub">${esc(l.heard_about)}</div>` : ""}</td>
            <td>${stageBadge(l.stage)}${l.assigned_to ? `<div class="sub">${esc(personName(l.assigned_to))}</div>` : ""}</td>
            <td class="next">${esc(l.next_steps)}</td>
            <td class="qb">${l.in_quickbooks ? "✓" : ""}</td></tr>`).join("")}</tbody></table>
        </div>
        <div class="lead-cards">${rows.map((l) => `<div class="lead-card" data-id="${esc(l.id)}">
          <div class="top"><div><div class="who">${esc(displayName(l))}</div>
            <div class="sub">${esc([l.contact_name !== displayName(l) ? l.contact_name : "", l.phone].filter(Boolean).join(" · "))}</div>
            <div class="sub">${esc(niceDate(l.lead_date))} · ${esc(CHANNEL[l.channel] || l.channel)}</div></div>${stageBadge(l.stage)}</div>
          ${l.next_steps ? `<div class="next">${esc(l.next_steps)}</div>` : ""}</div>`).join("")}</div>`;
      $$("[data-id]", $("#listOut")).forEach((el) => (el.onclick = () => { location.hash = "lead=" + el.dataset.id; }));
      $$("[data-sort]", $("#listOut")).forEach((b) => (b.onclick = () => {
        const k = b.dataset.sort;
        if (state.f.sort === k) state.f.dir = state.f.dir === "asc" ? "desc" : "asc";
        else { state.f.sort = k; state.f.dir = FIRST_DIR[k] || "asc"; }
        $("#fo").value = state.f.sort;
        draw();
      }));
      if (state.highlight) {
        $$(`[data-id="${state.highlight}"]`, $("#listOut")).forEach((el) => el.classList.add("just-added"));
        state.highlight = null;
      }
    };
    draw();
    $("#fq").oninput = (e) => { state.f.q = e.target.value; draw(); };
    $("#fs").onchange = (e) => { state.f.stage = e.target.value; draw(); };
    $("#fc").onchange = (e) => { state.f.channel = e.target.value; draw(); };
    $("#fp").onchange = (e) => { state.f.person = e.target.value; draw(); };
    $("#fo").onchange = (e) => { state.f.sort = e.target.value; state.f.dir = FIRST_DIR[e.target.value] || "asc"; draw(); };
    $$("[data-stat]").forEach((b) => (b.onclick = () => {
      state.f.stage = state.f.stage === b.dataset.stat ? "all" : b.dataset.stat;
      $("#fs").value = state.f.stage;
      draw();
    }));
    $("#addBtn").onclick = () => openAdd();
    $("#exportBtn").onclick = () => exportExcel(L.filter(matches)).catch(fail);
  }

  // =====================================================================
  // One lead
  // =====================================================================
  function copyField(id, label, value, opts = {}) {
    const tag = opts.area
      ? `<textarea id="${id}" rows="${opts.rows || 4}" data-f="${id}">${esc(value)}</textarea>`
      : `<input id="${id}" data-f="${id}" type="${opts.type || "text"}" value="${esc(value)}" ${opts.inputmode ? `inputmode="${opts.inputmode}"` : ""}>`;
    return `<div class="field"><label for="${id}">${label}</label><div class="copy-field">${tag}<button type="button" class="copy-btn" data-copy="${id}">Copy</button></div></div>`;
  }
  function qbText(l) {
    return [
      ["Customer display name", l.project_name || l.contact_name],
      ["Name", l.contact_name], ["Company", l.company], ["Email", l.email], ["Phone", l.phone], ["Address", l.address],
    ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
  }
  function allText(l, intakes) {
    const lines = [
      displayName(l), "",
      ...[["Contact", l.contact_name], ["Company", l.company], ["Phone", l.phone], ["Email", l.email], ["Address", l.address],
        ["Came in by", CHANNEL[l.channel]], ["Heard about us", l.heard_about], ["Date", niceDate(l.lead_date)], ["Stage", STAGE[l.stage]],
        ["Property type", l.property_type], ["Service", l.service], ["Zone quote", l.zone_quote ? "$" + l.zone_quote : ""],
        ["Request", l.request], ["Goals", l.goals], ["Budget", l.budget], ["Next steps", l.next_steps], ["Site notes", l.site_notes]]
        .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    ];
    (intakes || []).forEach((it) => {
      lines.push("", `${it.source === "website" ? "Website form" : "Intake form"} (${niceTime(it.submitted_at)})`);
      (it.answers || []).forEach((x) => lines.push(`${x.q}: ${x.a}`));
    });
    return lines.join("\n");
  }

  async function renderLead(id) {
    const [l, intakes, notes] = await Promise.all([S.lead(id), S.intakes(id), S.notes(id)]);
    let lead = l;
    const sms = /iPhone|iPad|Mac/.test(navigator.userAgent) ? "sms:" : "sms:";
    $("#view").innerHTML = `
      <p style="margin:0 0 10px"><a href="#" id="backLink">← All leads</a></p>
      <div class="lead-head">
        <div><p class="eyebrow">${esc(CHANNEL[lead.channel] || lead.channel)}${lead.lead_date ? " · " + esc(niceDate(lead.lead_date)) : ""}</p>
          <h1 id="leadTitle">${esc(displayName(lead))}</h1>
          <div>${stageBadge(lead.stage)} <span class="saved-note" id="savedNote"></span></div></div>
      </div>
      <div class="quick">
        ${lead.phone ? `<a class="btn" href="tel:${esc(telHref(lead.phone))}">Call</a><a class="btn secondary" href="${sms}${esc(telHref(lead.phone))}">Text</a>` : ""}
        ${lead.email ? `<a class="btn secondary" href="mailto:${esc(lead.email)}">Email</a>` : ""}
        <button type="button" class="secondary" id="copyContact">Copy contact</button>
        <button type="button" class="secondary" id="copyQB">Copy for QuickBooks</button>
        <button type="button" class="secondary" id="copyAll">Copy everything</button>
      </div>
      <div class="lead-grid">
        <div>
          <div class="card"><h2>Where it stands</h2>
            <div class="grid2">
              <div class="field"><label for="stage">Stage</label><select id="stage" data-f="stage">${STAGES.map(([k, v]) => `<option value="${k}" ${lead.stage === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
              <div class="field"><label for="assigned_to">Assigned to</label><select id="assigned_to" data-f="assigned_to" ${isAdmin() ? "" : "disabled"}><option value="">Not assigned</option>${state.people.map((p) => `<option value="${esc(p.id)}" ${lead.assigned_to === p.id ? "selected" : ""}>${esc(p.full_name)}</option>`).join("")}</select></div>
            </div>
            <div class="field"><label for="next_steps">Next steps</label><textarea id="next_steps" data-f="next_steps" rows="2">${esc(lead.next_steps)}</textarea></div>
            <div class="grid2">
              <div class="field"><label for="zone_quote">Zone quote ($)</label><input id="zone_quote" data-f="zone_quote" type="number" inputmode="decimal" step="any" value="${lead.zone_quote == null ? "" : esc(lead.zone_quote)}"></div>
              <div class="field"><label for="lead_date">Date it came in</label><input id="lead_date" data-f="lead_date" type="date" value="${esc(lead.lead_date || "")}"></div>
            </div>
            <label class="check"><input type="checkbox" id="in_quickbooks" data-f="in_quickbooks" ${lead.in_quickbooks ? "checked" : ""}> Added to QuickBooks</label>
            <div class="field ${lead.stage === "lost" ? "" : "hidden"}" id="lostWrap" style="margin-top:12px"><label for="closed_reason">Why we lost it</label><input id="closed_reason" data-f="closed_reason" value="${esc(lead.closed_reason)}"></div>
          </div>
          <div class="card"><h2>Contact</h2>
            ${copyField("contact_name", "Name", lead.contact_name)}
            ${copyField("project_name", "Project or property name", lead.project_name)}
            ${copyField("company", "Company", lead.company)}
            <div class="grid2">${copyField("phone", "Phone", lead.phone, { type: "tel" })}${copyField("email", "Email", lead.email, { type: "email" })}</div>
            ${copyField("address", "Address", lead.address, { area: true, rows: 2 })}
            <div class="grid2">
              <div class="field"><label for="channel">Came in by</label><select id="channel" data-f="channel">${CHANNELS.map(([k, v]) => `<option value="${k}" ${lead.channel === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
              <div class="field"><label for="heard_about">Heard about us / referred by</label><input id="heard_about" data-f="heard_about" value="${esc(lead.heard_about)}"></div>
            </div>
          </div>
          <div class="card"><h2>What they need</h2>
            <div class="grid2">
              <div class="field"><label for="property_type">Property type</label><input id="property_type" data-f="property_type" value="${esc(lead.property_type)}"></div>
              <div class="field"><label for="service">Service</label><input id="service" data-f="service" value="${esc(lead.service)}" placeholder="Diagnostic, Oversight, Ongoing consulting"></div>
            </div>
            ${copyField("request", "Request", lead.request, { area: true, rows: 5 })}
            <div class="field"><label for="goals">Goals</label><textarea id="goals" data-f="goals" rows="2">${esc(lead.goals)}</textarea></div>
            <div class="field"><label for="budget">Budget</label><input id="budget" data-f="budget" value="${esc(lead.budget)}"></div>
            <div class="field"><label for="site_notes">Call and site visit notes</label><textarea id="site_notes" data-f="site_notes" rows="3">${esc(lead.site_notes)}</textarea></div>
          </div>
        </div>
        <div>
          <div class="card"><h2>Intake answers</h2>
            ${intakes.length ? intakes.map((it) => `
              <div class="intake-meta">${it.source === "website" ? "Website form" : it.source === "manual" ? "Typed in" : "Intake form"} · ${esc(niceTime(it.submitted_at))}</div>
              ${(it.answers || []).filter((x) => String(x.a || "").trim()).map((x) => `<div class="qa"><div class="q">${esc(x.q)}</div><div class="a">${linkify(x.a)}</div></div>`).join("")}`).join("")
              : `<p class="muted small">No intake form yet. When they fill in the intake form with this email or phone number, their answers show up here and the stage moves to Intake received.</p>`}
          </div>
          <div class="card"><h2>Notes and history</h2>
            <div class="field"><textarea id="newNote" rows="2" placeholder="Add a note: left a message, sent intake form, booked for Tuesday…"></textarea></div>
            <button type="button" id="addNoteBtn" class="small">Add note</button>
            <div id="notesOut" style="margin-top:10px">${notesHtml(notes)}</div>
          </div>
          ${isAdmin() ? `<p style="text-align:right"><button type="button" class="danger small" id="delBtn">Delete this lead</button></p>` : ""}
        </div>
      </div>`;

    $("#backLink").onclick = (e) => { e.preventDefault(); location.hash = ""; };
    $$("[data-copy]").forEach((b) => (b.onclick = () => copy($("#" + b.dataset.copy).value, b)));
    $("#copyContact").onclick = (e) => copy([lead.contact_name, lead.company, lead.phone, lead.email, lead.address].filter(Boolean).join("\n"), e.target);
    $("#copyQB").onclick = (e) => copy(qbText(lead), e.target);
    $("#copyAll").onclick = (e) => copy(allText(lead, intakes), e.target);

    // Save each field as soon as it changes
    let pending = Promise.resolve();
    $$("[data-f]").forEach((el) => {
      const ev = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "date" ? "change" : "change";
      el.addEventListener(ev, () => {
        const k = el.dataset.f;
        let v = el.type === "checkbox" ? el.checked : el.value;
        if (k === "zone_quote") v = v === "" ? null : Number(v);
        if (k === "assigned_to" || k === "lead_date") v = v || null;
        if (k === "email") v = String(v).trim().toLowerCase();
        $("#savedNote").textContent = "Saving…";
        pending = pending.then(async () => {
          lead = await S.update(lead.id, { [k]: v });
          $("#savedNote").textContent = "Saved";
          if (k === "stage") {
            $(".lead-head .stage").outerHTML = stageBadge(lead.stage);
            $("#lostWrap").classList.toggle("hidden", lead.stage !== "lost");
            $("#notesOut").innerHTML = notesHtml(await S.notes(lead.id));
          }
          if (k === "project_name" || k === "contact_name") $("#leadTitle").textContent = displayName(lead);
        }).catch((e) => { $("#savedNote").textContent = ""; fail(e); });
      });
    });
    $("#addNoteBtn").onclick = async () => {
      const body = $("#newNote").value.trim();
      if (!body) return;
      try {
        await S.addNote(lead.id, body);
        $("#newNote").value = "";
        $("#notesOut").innerHTML = notesHtml(await S.notes(lead.id));
      } catch (e) { fail(e); }
    };
    if ($("#delBtn")) $("#delBtn").onclick = () => {
      const { m, close } = modal(`<h2>Delete this lead?</h2><p>${esc(displayName(lead))} and its intake answers and notes will be removed. This can't be undone. To keep it on record, set the stage to Lost instead.</p>
        <div class="btn-row" style="justify-content:flex-end"><button class="secondary" data-no>Cancel</button><button class="danger" data-yes>Delete</button></div>`);
      $("[data-no]", m).onclick = close;
      $("[data-yes]", m).onclick = async () => { try { await S.remove(lead.id); close(); toast("Lead deleted"); location.hash = ""; } catch (e) { fail(e); } };
    };
  }
  function notesHtml(notes) {
    if (!notes.length) return `<p class="muted small">No notes yet.</p>`;
    return notes.map((n) => `<div class="note ${n.automatic ? "auto" : ""}"><div class="meta">${esc(n.author_name || "")} · ${esc(niceTime(n.created_at))}</div><div class="body">${esc(n.body)}</div></div>`).join("");
  }

  // =====================================================================
  // Add a lead (calls, texts, emails, referrals)
  // =====================================================================
  function openAdd() {
    let channel = "phone";
    const { m, close } = modal(`
      <h2>Add a lead</h2>
      <div class="field"><label>How did it come in?</label><div class="channel-pick">${CHANNELS.filter(([k]) => k !== "intake_form").map(([k, v]) => `<button type="button" data-ch="${k}" class="${k === channel ? "on" : ""}">${v}</button>`).join("")}</div></div>
      <div class="grid2">
        <div class="field"><label for="a_name">Name <span class="req">*</span></label><input id="a_name" autocomplete="off"></div>
        <div class="field"><label for="a_phone">Phone</label><input id="a_phone" type="tel" autocomplete="off"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="a_email">Email</label><input id="a_email" type="email" autocomplete="off"></div>
        <div class="field"><label for="a_company">Company (if any)</label><input id="a_company" autocomplete="off"></div>
      </div>
      <div class="field"><label for="a_address">Property address</label><input id="a_address" autocomplete="off"></div>
      <div class="field"><label for="a_request">What do they need?</label><textarea id="a_request" rows="4" placeholder="Paste the voicemail, text or email, or type a summary"></textarea></div>
      <div class="grid2">
        <div class="field"><label for="a_heard">Heard about us / referred by</label><input id="a_heard" autocomplete="off"></div>
        <div class="field"><label for="a_next">Next steps</label><input id="a_next" autocomplete="off" placeholder="e.g. Send intake form"></div>
      </div>
      <p class="error-text hidden" id="a_err"></p>
      <label class="check" style="margin-bottom:14px"><input type="checkbox" id="a_slack" checked> Let the team know in Slack</label>
      <div class="btn-row" style="justify-content:flex-end"><button class="secondary" type="button" data-no>Cancel</button><button type="button" data-save>Save lead</button></div>`);
    $$("[data-ch]", m).forEach((b) => (b.onclick = () => { channel = b.dataset.ch; $$("[data-ch]", m).forEach((x) => x.classList.toggle("on", x === b)); }));
    $("[data-no]", m).onclick = close;
    setTimeout(() => $("#a_name").focus(), 50);
    $("[data-save]", m).onclick = async (e) => {
      const name = $("#a_name").value.trim();
      const phone = $("#a_phone").value.trim();
      const email = $("#a_email").value.trim().toLowerCase();
      const err = $("#a_err");
      if (!name && !phone && !email) { err.textContent = "Add at least a name, phone or email."; err.classList.remove("hidden"); return; }
      // Already have them? Offer to open the existing lead instead.
      const digits = (s) => String(s || "").replace(/\D/g, "").slice(-10);
      const dupe = state.leads.find((l) => (email && l.email && l.email.toLowerCase() === email) || (digits(phone).length === 10 && digits(l.phone) === digits(phone)));
      if (dupe && !e.target.dataset.confirmed) {
        err.innerHTML = `${esc(displayName(dupe))} already has this ${email && dupe.email && dupe.email.toLowerCase() === email ? "email" : "phone number"}. <a href="#lead=${esc(dupe.id)}" id="openDupe">Open that lead</a>, or click Save lead again to add a new one anyway.`;
        err.classList.remove("hidden");
        $("#openDupe").onclick = () => close();
        e.target.dataset.confirmed = "1";
        return;
      }
      e.target.disabled = true;
      const company = $("#a_company").value.trim();
      const last = name.split(/\s+/).pop();
      try {
        const lead = await S.add({
          channel, contact_name: name, phone, email, company, address: $("#a_address").value.trim(),
          request: $("#a_request").value.trim(), heard_about: $("#a_heard").value.trim(), next_steps: $("#a_next").value.trim(),
          project_name: company || (last ? `${last} Residence` : ""),
          lead_date: isoDate(new Date()),
        });
        if ($("#a_slack").checked) {
          S.notify(lead.id).then((r) => { if (r && r.slack && r.slack !== "sent" && r.slack !== "demo") toast(r.slack, true); }).catch((er) => toast("Lead saved, but Slack couldn't be reached: " + friendly(er), true));
        }
        close();
        toast("Lead added");
        // Back to the full list, newest first, with the new lead highlighted
        state.f = { ...DEFAULT_FILTERS };
        state.highlight = lead.id;
        if (location.hash && location.hash !== "#") location.hash = ""; else route();
      } catch (ex) { e.target.disabled = false; fail(ex); }
    };
  }

  // =====================================================================
  // Export to Excel (branded header, one row per lead)
  // =====================================================================
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the Excel tool.")); document.head.appendChild(s); });
  }
  async function exportExcel(rows) {
    if (!window.ExcelJS) await loadScript("vendor/exceljs.min.js");
    const wb = new window.ExcelJS.Workbook();
    wb.creator = "Harmony Horticulture";
    const ws = wb.addWorksheet("Leads", { views: [{ state: "frozen", ySplit: 3 }] });
    const cols = [
      ["Date", 12, (l) => l.lead_date ? new Date(l.lead_date + "T12:00:00") : ""], ["Project", 26, (l) => l.project_name], ["Contact", 22, (l) => l.contact_name],
      ["Company", 20, (l) => l.company], ["Phone", 16, (l) => l.phone], ["Email", 30, (l) => l.email], ["Address", 36, (l) => l.address],
      ["Came in by", 14, (l) => CHANNEL[l.channel] || l.channel], ["Heard about us", 18, (l) => l.heard_about], ["Stage", 20, (l) => STAGE[l.stage] || l.stage],
      ["Assigned to", 18, (l) => personName(l.assigned_to)], ["Zone quote", 12, (l) => l.zone_quote == null ? "" : Number(l.zone_quote)],
      ["Next steps", 34, (l) => l.next_steps], ["Service", 18, (l) => l.service], ["Request", 60, (l) => l.request],
      ["In QuickBooks", 13, (l) => (l.in_quickbooks ? "Yes" : "")],
    ];
    ws.columns = cols.map(([, w]) => ({ width: w }));
    ws.mergeCells(1, 1, 1, cols.length);
    const t = ws.getCell(1, 1);
    t.value = "HARMONY HORTICULTURE LEADS";
    t.font = { name: "Montserrat", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5F351B" } };
    t.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(1).height = 30;
    ws.mergeCells(2, 1, 2, cols.length);
    const sub = ws.getCell(2, 1);
    sub.value = `Exported ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · ${rows.length} leads`;
    sub.font = { name: "Montserrat", size: 9, color: { argb: "FF595959" } };
    const head = ws.getRow(3);
    cols.forEach(([h], i) => {
      const c = head.getCell(i + 1);
      c.value = h.toUpperCase();
      c.font = { name: "Montserrat", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF009344" } };
      c.alignment = { vertical: "middle", wrapText: true };
    });
    head.height = 22;
    rows.forEach((l, r) => {
      const row = ws.addRow(cols.map(([, , fn]) => fn(l)));
      row.eachCell({ includeEmpty: true }, (c, i) => {
        c.font = { name: "Montserrat", size: 9 };
        c.alignment = { vertical: "top", wrapText: [7, 13, 15].includes(i) };
        if (r % 2) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
        c.border = { bottom: { style: "thin", color: { argb: "FFE2E2E2" } } };
      });
      row.getCell(1).numFmt = "mm/dd/yyyy";
      row.getCell(12).numFmt = '"$"#,##0';
    });
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: cols.length } };
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `Harmony Horticulture Leads ${isoDate(new Date())}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // Refresh the list when coming back to the tab
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.me && !location.hash.includes("lead=")) route(); });

  start();
})();
