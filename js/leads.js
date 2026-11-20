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
  // Something@something.something, no spaces (catches "name@aol." or "name aol.com")
  const EMAIL_OK = (v) => !v || /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i.test(String(v).trim());
  const BAD_EMAIL = "That email doesn't look complete. It should look like name@aol.com.";
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
  // Who a lead can be assigned to. Slack tags them by these ids (see the
  // same list in supabase/functions/leads-inbox).
  const ASSIGNEES = [["kasey", "Kasey"], ["krista", "Krista"], ["robert", "Robert"], ["stephanie", "Stephanie"]];
  const ASSIGNEE = Object.fromEntries(ASSIGNEES);

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
      async uploadLeadPhoto(leadId, blob) {
        const path = `${leadId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        ok(await sb.storage.from("lead-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false }));
        return path;
      },
      async leadPhotoUrl(path) {
        const { data, error } = await sb.storage.from("lead-photos").download(path);
        return error ? "" : URL.createObjectURL(data);
      },
      async removeLeadPhotos(paths) { if (paths.length) await sb.storage.from("lead-photos").remove(paths); },
      async addNote(lead_id, body) {
        return ok(await sb.from("lead_notes").insert({ lead_id, body, author_id: meCache.id, author_name: meCache.full_name || meCache.email }).select("*").single());
      },
      async assign(lead_id) { return await this.callInbox({ assign_lead_id: lead_id, app_url: appUrl() }); },
      reportUrl(lead) { return `${appUrl()}lead-report.html?k=${lead.details.report_token}`; },
      async notify(lead_id) { return await this.callInbox({ notify_lead_id: lead_id, app_url: appUrl() }); },
      async callInbox(body) {
        const { data, error } = await sb.functions.invoke("leads-inbox", { body });
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
        zone_quote: null, site_notes: "", assigned_to: null, in_quickbooks: false, closed_reason: "", details: {}, ...o,
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
            { q: "Contact Name", a: "Pat Rivera" }, { q: "Property Name", a: "Saguaro Heights HOA" }, { q: "Phone", a: "602-555-0144" },
            { q: "Email", a: "pat@example.org" }, { q: "Property Manager", a: "Desert Sky Management" }, { q: "Property Manager Phone", a: "602-555-0190" },
            { q: "Property Manager Email", a: "", }, { q: "Address", a: "200 N Sample Way, Phoenix, AZ 85018" }, { q: "Service Frequency", a: "Oversight" },
            { q: "A/P Contact", a: "Lee Accounts" }, { q: "Email", a: "ap@example.org" }, { q: "Phone", a: "602-555-0191" },
            { q: "W9 Required?", a: "Yes" }, { q: "COI Required?", a: "Yes" }, { q: "Gate Code", a: "#4321" }, { q: "Guard Gate Access", a: "" },
            { q: "Controller Type", a: "Rain Bird ESP-LXME" }, { q: "Number of Controllers", a: "3" }, { q: "Number of Zones", a: "48" },
            { q: "Living Turfgrass", a: "No" }, { q: "Landscape Maintenance", a: "Valley Green Landscaping" },
            { q: "Goals", a: "Common area plants failing near the entrance. Board wants a landscape plan." },
            { q: "IMAGE(s) Upload", a: "https://drive.google.com/open?id=example" }, { q: "How did you hear about us?", a: "Referral from another HOA" },
            { q: "Consent", a: "Yes" } ] },
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
          assigned_to: null, in_quickbooks: false, closed_reason: "", details: {}, ...row };
        db.leads.push(l); save(); return l;
      },
      async remove(id) { db.leads = db.leads.filter((x) => x.id !== id); save(); },
      // Demo photos live in this browser as small data links
      async uploadLeadPhoto(leadId, blob) { return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); }); },
      async leadPhotoUrl(path) { return path; },
      async removeLeadPhotos() {},
      async addNote(lead_id, body) { const n = { id: Date.now(), lead_id, body, created_at: new Date().toISOString(), author_name: me.full_name, automatic: false }; db.notes.push(n); save(); return n; },
      async notify() { return { ok: true, slack: "demo" }; },
      async assign() { return { ok: true, slack: "demo" }; },
      reportUrl(lead) { return `${appUrl()}lead-report.html?demo=${lead.id}`; },
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
    qb: { label: "Entered in QB", val: (l) => (l.in_quickbooks ? 1 : 0) },
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
  function modal(html, wide, onClose) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-back"><div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div></div>`;
    const m = $(".modal", root);
    const close = () => { if ($(".modal", root) !== m) return; root.innerHTML = ""; if (onClose) onClose(); };
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
  const stagePick = (l) => `<select class="stage-pick stage ${esc(l.stage)}" data-of="${esc(l.id)}" aria-label="Stage for ${esc(displayName(l))}">${STAGES.map(([k, v]) => `<option value="${k}" ${l.stage === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
  const qbTick = (l) => `<button type="button" class="qb-tick ${l.in_quickbooks ? "on" : ""}" data-of="${esc(l.id)}" aria-pressed="${l.in_quickbooks ? "true" : "false"}" title="Entered in QuickBooks: click to change">${l.in_quickbooks ? "✓" : ""}</button>`;
  // Won and entered in QuickBooks: nothing left to do, so it sinks to the bottom
  const isDone = (l) => l.stage === "won" && !!l.in_quickbooks;
  const assignPick = (l) => { const cur = (l.details || {}).assignee || ""; return `<select class="assign-pick-sel ${cur ? "set" : ""}" data-of="${esc(l.id)}" aria-label="Assigned to for ${esc(displayName(l))}"><option value="" ${cur ? "" : "selected"}>${cur ? "Not assigned" : "Assign to…"}</option>${ASSIGNEES.map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${v}</option>`).join("")}</select>`; };
  const stageBadge = (s) => `<span class="stage ${esc(s)}">${esc(STAGE[s] || s)}</span>`;
  const telHref = (p) => String(p || "").replace(/[^\d+]/g, "");
  const linkify = (t) => esc(t).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.includes("drive.google.com") ? "Open file in Google Drive" : u}</a>`);
  const assigneeName = (l) => ASSIGNEE[(l.details || {}).assignee] || "";
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
      if (state.me.role !== "admin") return showAuth("Leads is only open to Krista and Kasey. If a lead has been assigned to you, they'll send you the details.");
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
    if (f.person === "none" && assigneeName(l)) return false;
    if (f.person && f.person !== "none" && (l.details || {}).assignee !== f.person) return false;
    if (f.q) {
      const hay = [l.project_name, l.contact_name, l.company, l.email, l.phone, l.address, l.request, l.next_steps, l.heard_about, ...Object.values(l.details || {}).filter((v) => typeof v === "string"), assigneeName(l)].join(" ").toLowerCase();
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
    const statList = () => [
      ["new", "New", "Need a first call", count((l) => l.stage === "new"), "pink"],
      ["intake_sent", "Waiting on intake", "Form sent, not back", count((l) => l.stage === "intake_sent"), ""],
      ["intake_received", "Ready to schedule", "Intake in, no visit yet", count((l) => l.stage === "intake_received"), "green"],
      ["proposal_sent", "Proposal sent", "Waiting on a yes", count((l) => l.stage === "proposal_sent"), "brown"],
      ["won", "Won this month", "", count((l) => l.stage === "won" && l.won_at && isoDate(new Date(l.won_at)).slice(0, 7) === monthStart), "green"],
    ];
    const statsHtml = () => statList().map(([k, label, sub, n, color]) => `
        <button type="button" class="stat clickable ${color} ${state.f.stage === k ? "on" : ""}" data-stat="${k}">
          <div class="label">${label}</div><div class="num">${n}</div>${sub ? `<div class="sub">${sub}</div>` : ""}
        </button>`).join("");
    const f = state.f;
    $("#view").innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">Every call, text, email and form</p><h1>Leads</h1></div>
        <div class="btn-row">
          <button type="button" class="secondary" id="exportBtn">Export to Excel</button>
          <button type="button" id="addBtn">+ Add a lead</button>
        </div>
      </div>
      <div class="stat-row" id="statRow">${statsHtml()}</div>
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
            ${ASSIGNEES.map(([k, v]) => `<option value="${k}" ${f.person === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
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
        if (isDone(a) !== isDone(b)) return isDone(a) ? 1 : -1;
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
          <table class="leads"><thead><tr>${th("date", "Date")}${th("lead", "Lead")}${th("contact", "Contact")}${th("channel", "Came in by")}${th("stage", "Stage")}${th("next", "Next steps")}${th("qb", "Entered in QB", 'title="Entered in QuickBooks"')}</tr></thead>
          <tbody>${rows.map((l) => `<tr data-id="${esc(l.id)}">
            <td>${esc(niceDate(l.lead_date))}</td>
            <td><div class="who">${esc(displayName(l))}</div><div class="sub">${esc(l.contact_name && l.contact_name !== displayName(l) ? l.contact_name : "")}${l.address ? `${l.contact_name && l.contact_name !== displayName(l) ? " · " : ""}${esc(l.address)}` : ""}</div></td>
            <td><div>${esc(l.phone)}</div><div class="sub">${esc(l.email)}</div></td>
            <td>${esc(CHANNEL[l.channel] || l.channel)}${l.heard_about ? `<div class="sub">${esc(l.heard_about)}</div>` : ""}</td>
            <td>${stagePick(l)}<div class="assign-cell">${assignPick(l)}</div></td>
            <td class="next">${esc(l.next_steps)}</td>
            <td class="qb">${qbTick(l)}</td></tr>`).join("")}</tbody></table>
        </div>
        <div class="lead-cards">${rows.map((l) => `<div class="lead-card" data-id="${esc(l.id)}">
          <div class="top"><div><div class="who">${esc(displayName(l))}</div>
            <div class="sub">${esc([l.contact_name !== displayName(l) ? l.contact_name : "", l.phone].filter(Boolean).join(" · "))}</div>
            <div class="sub">${esc(niceDate(l.lead_date))} · ${esc(CHANNEL[l.channel] || l.channel)}</div></div>${stagePick(l)}</div>
          ${l.next_steps ? `<div class="next">${esc(l.next_steps)}</div>` : ""}
          <div class="card-qb">${qbTick(l)} <span class="small muted">Entered in QB</span><span class="card-assign">${assignPick(l)}</span></div></div>`).join("")}</div>`;
      $$("[data-id]", $("#listOut")).forEach((el) => (el.onclick = (e) => {
        if (e.target.closest(".stage-pick, .qb-tick, .assign-pick-sel")) return; // quick edits don't open the card
        openCard(el.dataset.id).catch(fail);
      }));
      // Quick edits right in the list: stage and Entered in QB
      const quickSave = async (id, patch, el) => {
        const l = L.find((x) => x.id === id);
        try {
          const wasDone = isDone(l);
          const saved = await S.update(id, patch);
          Object.assign(l, saved);
          $("#statRow").innerHTML = statsHtml();
          bindStats();
          if (isDone(l) !== wasDone) { draw(); toast(isDone(l) ? "Won and in QB, moved to the bottom" : "Saved"); }
          else toast("Saved");
        } catch (e) { fail(e); draw(); }
      };
      $$(".stage-pick", $("#listOut")).forEach((sel) => {
        sel.onclick = (e) => e.stopPropagation();
        sel.onchange = () => {
          const v = sel.value;
          $$(`.stage-pick[data-of="${sel.dataset.of}"]`, $("#listOut")).forEach((x) => { x.value = v; x.className = "stage-pick stage " + v; });
          quickSave(sel.dataset.of, { stage: v });
        };
      });
      $$(".qb-tick", $("#listOut")).forEach((b) => (b.onclick = (e) => {
        e.stopPropagation();
        const on = b.getAttribute("aria-pressed") !== "true";
        $$(`.qb-tick[data-of="${b.dataset.of}"]`, $("#listOut")).forEach((x) => { x.setAttribute("aria-pressed", on); x.classList.toggle("on", on); x.textContent = on ? "✓" : ""; });
        quickSave(b.dataset.of, { in_quickbooks: on });
      }));
      $$(".assign-pick-sel", $("#listOut")).forEach((sel) => {
        sel.onclick = (e) => e.stopPropagation();
        sel.onchange = () => assignChange(sel.dataset.of, sel.value, () => draw());
      });
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
    function bindStats() {
      $$("[data-stat]").forEach((b) => (b.onclick = () => {
        state.f.stage = state.f.stage === b.dataset.stat ? "all" : b.dataset.stat;
        $("#fs").value = state.f.stage;
        draw();
      }));
    }
    bindStats();
    $("#addBtn").onclick = () => openAdd();
    $("#exportBtn").onclick = () => exportExcel(L.filter(matches)).catch(fail);
  }

  // =====================================================================
  // One lead
  // =====================================================================
  // Address suggestions while typing (OpenStreetMap search via Photon, free, no key).
  // Results lean toward the Phoenix area. Picking one fills the full street, city, state and ZIP.
  const STATE_ABBR = { Arizona: "AZ", California: "CA", Nevada: "NV", "New Mexico": "NM", Utah: "UT", Colorado: "CO", Texas: "TX" };
  function formatPlace(pr, typed) {
    let num = pr.housenumber || "";
    const street = pr.street || (pr.osm_key === "highway" ? pr.name : "");
    // OpenStreetMap often knows the street but not each house number, so keep the number that was typed
    const typedNum = (String(typed).trim().match(/^(\d+[A-Za-z]?)\s/) || [])[1];
    if (!num && typedNum && street) num = typedNum;
    const line1 = street ? [num, street].filter(Boolean).join(" ") : pr.name || "";
    const city = pr.city || pr.town || pr.village || pr.district || pr.county || "";
    const st = STATE_ABBR[pr.state] || pr.state || "";
    const tail = [st, pr.postcode].filter(Boolean).join(" ");
    return [line1, city, tail].filter(Boolean).join(", ");
  }
  function addressLookup(el) {
    if (!el) return;
    const box = document.createElement("div");
    box.className = "addr-menu hidden";
    box.setAttribute("role", "listbox");
    document.body.appendChild(box);
    let timer = null, seq = 0, items = [], active = -1;
    const hide = () => { box.classList.add("hidden"); active = -1; };
    const place = () => {
      const r = el.getBoundingClientRect();
      box.style.left = r.left + "px"; box.style.top = r.bottom + 4 + "px"; box.style.width = r.width + "px";
    };
    const paint = () => {
      if (!items.length) return hide();
      box.innerHTML = items.map((t, i) => `<button type="button" class="addr-opt ${i === active ? "on" : ""}" data-i="${i}">${esc(t)}</button>`).join("") +
        `<div class="addr-credit">Suggestions © OpenStreetMap</div>`;
      place(); box.classList.remove("hidden");
    };
    const pick = (i) => {
      if (items[i] == null) return;
      el.value = items[i]; hide();
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    box.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the field
    box.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) pick(Number(b.dataset.i)); });
    el.addEventListener("input", () => {
      clearTimeout(timer);
      const q = el.value.trim();
      if (q.length < 4) { items = []; return hide(); }
      timer = setTimeout(async () => {
        const my = ++seq;
        try {
          const url = "https://photon.komoot.io/api/?limit=8&lang=en&lat=33.5&lon=-111.95&q=" + encodeURIComponent(q);
          const res = await fetch(url);
          const data = await res.json();
          if (my !== seq || document.activeElement !== el) return;
          const seen = new Set();
          items = (data.features || []).map((f) => f.properties || {})
            .filter((pr) => pr.countrycode === "US" && (pr.street || pr.osm_key === "highway" || pr.housenumber))
            .map((pr) => formatPlace(pr, q))
            .filter((t) => t && !seen.has(t) && seen.add(t))
            .slice(0, 6);
          active = -1; paint();
        } catch (_) { items = []; hide(); }
      }, 250);
    });
    el.addEventListener("keydown", (e) => {
      if (box.classList.contains("hidden")) return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
      else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(active); }
      else if (e.key === "Escape") { e.stopPropagation(); hide(); }
    });
    el.addEventListener("blur", () => setTimeout(hide, 150));
    window.addEventListener("scroll", () => { if (!box.classList.contains("hidden")) place(); }, true);
    // Remove the menu when the field leaves the page
    const gone = setInterval(() => { if (!document.body.contains(el)) { box.remove(); clearInterval(gone); } }, 2000);
  }

  function copyField(id, label, value, opts = {}) {
    const tag = opts.area
      ? `<textarea id="${id}" rows="${opts.rows || 4}" data-f="${id}">${esc(value)}</textarea>`
      : `<input id="${id}" data-f="${id}" type="${opts.type || "text"}" value="${esc(value)}" ${opts.inputmode ? `inputmode="${opts.inputmode}"` : ""}>`;
    return `<div class="field"><label for="${id}">${label}</label><div class="copy-field">${tag}<button type="button" class="copy-btn" data-copy="${id}">Copy</button></div></div>`;
  }
  // =====================================================================
  // The intake form, question for question ("HHC - New Client Intake").
  // The same fields are used whether the client filled in the form or we
  // took the answers on a call. col: kept in its own leads column (so lists,
  // search and QuickBooks copy use it); otherwise kept in leads.details.
  // yn: a Yes/No question. re: how a form question is recognised.
  // =====================================================================
  const FORM = [
    { title: "Client information", fields: [
      { k: "contact_name", label: "Contact Name", col: true, copy: true, re: /^(contact |client |your |full )?name\b|first and last/ },
      { k: "project_name", label: "Property Name", col: true, copy: true, re: /^(property|project) name/ },
      { k: "phone", label: "Phone", col: true, copy: true, type: "tel", re: /^(phone|cell|mobile)/ },
      { k: "email", label: "Email", col: true, copy: true, type: "email", re: /^e-?mail/ },
      { k: "pm_name", label: "Property Manager", copy: true, re: /^property manager( name)?$/ },
      { k: "pm_phone", label: "Property Manager Phone", copy: true, type: "tel", re: /manager.*phone/ },
      { k: "pm_email", label: "Property Manager Email", copy: true, type: "email", re: /manager.*e-?mail/ },
      { k: "address", label: "Address", col: true, copy: true, area: true, rows: 1, re: /address|location/ },
    ] },
    { title: "Billing information", fields: [
      { k: "service", label: "Service Frequency", col: true, options: ["Oversight", "Diagnostic"], re: /frequency|^service|scope/ },
      { k: "ap_name", label: "A/P Contact", copy: true, re: /a\/?p contact|accounts payable/ },
      { k: "ap_email", label: "A/P Email", copy: true, type: "email", re: /^(a\/?p )?e-?mail/ },
      { k: "ap_phone", label: "A/P Phone", copy: true, type: "tel", re: /^(a\/?p )?phone/ },
      { k: "w9", label: "W9 Required?", yn: true, re: /w-?9/ },
      { k: "coi", label: "COI Required?", yn: true, re: /\bcoi\b|certificate of insurance/ },
    ] },
    { title: "Property details", fields: [
      { k: "gate_code", label: "Gate Code", re: /gate code/ },
      { k: "guard_gate", label: "Guard Gate Access", re: /guard gate/ },
      { k: "security", label: "Security Protocols", re: /security/ },
      { k: "photo_release", label: "Photo Release (Separate form)", yn: true, re: /photo release/ },
      { k: "pets", label: "Pets or other animals", re: /pets|animals/ },
      { k: "injector", label: "Fertilizer Injector", re: /injector/ },
      { k: "controller_type", label: "Controller Type", re: /controller type/ },
      { k: "controllers", label: "Number of Controllers", re: /controllers/ },
      { k: "zones", label: "Number of Zones", re: /zones/ },
      { k: "parking", label: "Parking Instructions", re: /parking/ },
      { k: "living_turf", label: "Living Turfgrass", yn: true, re: /living turf/ },
      { k: "synthetic_turf", label: "Synthetic Turfgrass", yn: true, re: /synthetic/ },
    ] },
    { title: "Current and past providers", fields: [
      { k: "landscape_architect", label: "Landscape Architect", re: /architect/ },
      { k: "install_co", label: "Property Landscape Installation Co", re: /installation co|install(ation)? company|installer/ },
      { k: "install_age", label: "Installation Age (Years)", re: /installation age|age \(years\)/ },
      { k: "maintenance", label: "Landscape Maintenance", re: /maintenance/ },
      { k: "tree_care", label: "Tree Care Provider", re: /tree care/ },
      { k: "spray", label: "Spray/Fertilizer Service", re: /spray|fertilizer service/ },
      { k: "irrigation_co", label: "Irrigation Company", re: /irrigation company/ },
      { k: "irrigation_system", label: "Irrigation System and Age", re: /irrigation system/ },
    ] },
    { title: "Additional information", fields: [
      { k: "goals", label: "Goals", col: true, area: true, re: /goal/ },
      { k: "images", label: "IMAGE(s) Upload", photos: true, re: /image|upload|photos?$/ },
      { k: "expectations", label: "Expectations", area: true, re: /expectation/ },
      { k: "upcoming_events", label: "Upcoming events", re: /upcoming event/ },
      { k: "annual_events", label: "Annual events", re: /annual event/ },
      { k: "enhancements", label: "Upcoming property enhancements", area: true, re: /enhancement/ },
      { k: "heard_about", label: "How did you hear about us?", col: true, heard: true, re: /hear about|find us|referred/ },
      { k: "newsletter_email", label: "Sign up for our Newsletter!", type: "email", re: /newsletter|sign up/ },
      { k: "consent", label: "Consent (emails and newsletters)", yn: true, re: /consent|i agree/ },
    ] },
  ];
  // Things we note on the call (and the website form asks) that aren't intake questions
  const CALL_FIELDS = [
    { k: "request", label: "What they need", col: true, copy: true, area: true, rows: 5, re: /issue|problem|describe|concern|help with|tell us|need|message|project$/ },
    { k: "company", label: "Company", col: true, copy: true, re: /company|business|organization/ },
    { k: "property_type", label: "Property type", col: true, re: /property type|type of property/ },
    { k: "budget", label: "Budget", col: true, re: /budget/ },
    { k: "site_notes", label: "Call and site visit notes", col: true, area: true, rows: 3 },
  ];
  const ALL_FIELDS = [...FORM.flatMap((s) => s.fields), ...CALL_FIELDS];
  const normQ = (q) => String(q || "").toLowerCase().replace(/\s+/g, " ").replace(/[\s?:!*.]+$/, "").trim();


  // "How did you hear about us?" choices. A person's referral asks for their name.
  const HEARD = ["Google search", "Instagram", "Facebook", "Nextdoor", "Yelp", "Our website", "Saw our truck or a job site", "Event or class", "Referral from a person", "Other"];
  function splitHeard(v) {
    v = String(v || "").trim();
    if (!v) return { pick: "", more: "" };
    const exact = HEARD.find((o) => o.toLowerCase() === v.toLowerCase());
    if (exact && exact !== "Referral from a person" && exact !== "Other") return { pick: exact, more: "" };
    const ref = v.match(/^(referral( from a person)?|referred( by)?)\s*[:\-–]?\s*(.*)$/i);
    if (ref) return { pick: "Referral from a person", more: (ref[4] || "").replace(/^(from|by)\s+/i, "") };
    if (/^google/i.test(v)) return { pick: "Google search", more: "" };
    const oth = v.match(/^other\s*[:\-–]?\s*(.*)$/i);
    return { pick: "Other", more: oth ? oth[1] : v };
  }
  const joinHeard = (pick, more) => pick === "Referral from a person" ? (more ? `Referral: ${more}` : "Referral") : pick === "Other" ? (more ? `Other: ${more}` : "Other") : pick;
  function wireHeard(root) {
    const pick = $("#heard_about_pick", root), more = $("#heard_about_more", root), out = $("#heard_about", root);
    if (!pick) return;
    const sync = (fire) => {
      const needs = pick.value === "Referral from a person" || pick.value === "Other";
      more.classList.toggle("hidden", !needs);
      more.placeholder = pick.value === "Other" ? "Where did they hear about us?" : "Who referred them? Their name";
      const v = joinHeard(pick.value, more.value.trim());
      if (fire && out.value !== v) { out.value = v; out.dispatchEvent(new Event("change", { bubbles: true })); }
    };
    pick.onchange = () => { sync(true); if (!more.classList.contains("hidden")) more.focus(); };
    more.onchange = () => sync(true);
    sync(false);
  }

  // Photos: shrink to a sensible size, then keep them with the lead
  async function shrinkPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error(`${file.name} isn't a photo this browser can open. iPhone (HEIC) photos: share them as JPEG first.`));
        i.src = url;
      });
      const MAX = 1600;
      const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      return await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.82));
    } finally { URL.revokeObjectURL(url); }
  }
  const MAX_PHOTOS = 10;
  async function thumbsHtml(photos, removable) {
    const urls = await Promise.all((photos || []).map((ph) => S.leadPhotoUrl(ph.path).catch(() => "")));
    return (photos || []).map((ph, i) => urls[i] ? `<div class="thumb"><a href="${esc(urls[i])}" target="_blank" rel="noopener"><img src="${esc(urls[i])}" alt="${esc(ph.name || "Photo")}"></a>${removable ? `<button type="button" class="thumb-x" data-rm="${i}" aria-label="Remove photo">✕</button>` : ""}</div>` : "").join("");
  }

  // Match form answers to the fields above, in order, so the second "Email" lands on A/P Email
  function matchAnswers(answers) {
    const values = {}, other = [], used = new Set();
    (answers || []).forEach((x) => {
      const a = String(x.a == null ? "" : x.a).trim();
      if (!a) return;
      const q = normQ(x.q);
      const f = ALL_FIELDS.find((f) => !used.has(f.k) && normQ(f.label) === q) ||
        ALL_FIELDS.find((f) => !used.has(f.k) && f.re && f.re.test(q));
      if (f) { used.add(f.k); values[f.k] = a; } else other.push({ q: x.q, a });
    });
    return { values, other };
  }
  // What the forms said, newest answer winning
  function formValues(intakes) {
    const values = {}, other = [];
    [...(intakes || [])].sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at))).forEach((it) => {
      const r = matchAnswers(it.answers);
      Object.assign(values, r.values);
      r.other.forEach((o) => other.push({ ...o, from: it }));
    });
    return { values, other };
  }
  // The value to show: what we saved, or else what the form said
  function fieldVal(lead, f, fromForm) {
    if (f.col) { const v = lead[f.k]; return v != null && String(v).trim() !== "" ? String(v) : fromForm[f.k] || ""; }
    const d = lead.details || {};
    return Object.prototype.hasOwnProperty.call(d, f.k) ? String(d[f.k] == null ? "" : d[f.k]) : fromForm[f.k] || "";
  }
  function srcLabel(it) { return it.source === "website" ? "Website form" : it.source === "manual" ? "Typed in" : "Intake form"; }

  function qbText(l) {
    return [
      ["Customer display name", l.project_name || l.contact_name],
      ["Name", l.contact_name], ["Company", l.company], ["Email", l.email], ["Phone", l.phone], ["Address", l.address],
    ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
  }
  function allText(l, intakes) {
    const fv = formValues(intakes);
    const lines = [displayName(l), "",
      ...[["Stage", STAGE[l.stage]], ["Came in by", CHANNEL[l.channel]], ["Date", niceDate(l.lead_date)], ["Next steps", l.next_steps],
        ["Zone quote", l.zone_quote ? "$" + l.zone_quote : ""], ["Entered in QuickBooks", l.in_quickbooks ? "Yes" : ""]]
        .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)];
    [...FORM, { title: "From the call", fields: CALL_FIELDS }].forEach((s) => {
      const rows = s.fields.map((f) => [f.label, fieldVal(l, f, fv.values)]).filter(([, v]) => v);
      if (rows.length) lines.push("", s.title.toUpperCase(), ...rows.map(([k, v]) => `${k}: ${v}`));
    });
    if (fv.other.length) lines.push("", "OTHER ANSWERS", ...fv.other.map((o) => `${o.q}: ${o.a}`));
    return lines.join("\n");
  }

  // =====================================================================
  // Lead card: a read-only view of what was filled in, with an Edit button
  // =====================================================================
  async function openCard(id) {
    const [lead, intakes] = await Promise.all([S.lead(id), S.intakes(id)]);
    const fv = formValues(intakes);
    const row = (label, v, html) => `<div class="qa"><div class="q">${esc(label)}</div><div class="a">${html || linkify(v)}</div></div>`;
    const stands = [
      ["Assigned to", assigneeName(lead)], ["Next steps", lead.next_steps],
      ["Zone quote", lead.zone_quote != null && lead.zone_quote !== "" ? "$" + lead.zone_quote : ""],
      ["Why we lost it", lead.stage === "lost" ? lead.closed_reason : ""],
    ].filter(([k, v]) => v && k !== "Assigned to");
    const photos = (lead.details || {}).photos || [];
    const sections = [...FORM, { title: "From the call", fields: CALL_FIELDS }].map((s) => {
      const rows = s.fields.map((f) => [f.label, fieldVal(lead, f, fv.values), f]).filter(([, v, f]) => v || (f.photos && photos.length));
      return rows.length ? `<h3>${esc(s.title)}</h3>${rows.map(([k, v, f]) => f.photos ? row(k, "", `${v ? `<div>${linkify(v)}</div>` : ""}<div class="thumbs" id="cardThumbs"></div>`) : row(k, v)).join("")}` : "";
    }).join("");
    const subs = intakes.length ? `<p class="small muted" style="margin:4px 0 0">${intakes.map((it) => `${srcLabel(it)} received ${esc(niceTime(it.submitted_at))}`).join(" · ")}</p>` : "";
    const { m, close } = modal(`
      <div class="lc-head">
        <div><p class="eyebrow">${esc(CHANNEL[lead.channel] || lead.channel)}${lead.lead_date ? " · " + esc(niceDate(lead.lead_date)) : ""}</p>
          <h2 class="lc-title">${esc(displayName(lead))}</h2>
          <div>${stageBadge(lead.stage)} ${lead.in_quickbooks ? `<span class="qb-badge">✓ Entered in QB</span>` : ""}</div>
          <div class="lc-assign"><label>Assigned to</label>${assignPick(lead)}</div>${subs}</div>
        <button type="button" class="lc-x secondary" data-close aria-label="Close">✕</button>
      </div>
      <div class="quick">
        <button type="button" id="cardEdit">Edit</button>
        ${assigneeName(lead) ? `<button type="button" class="secondary" id="cardAssign">Resend report to ${esc(assigneeName(lead))}</button>` : `<button type="button" class="assign-btn" id="cardAssign">Assign and send report</button>`}
        ${(lead.details || {}).report ? `<a class="btn secondary" href="${esc(S.reportUrl(lead))}" target="_blank" rel="noopener">View lead report</a>` : ""}
        ${lead.phone ? `<a class="btn secondary" href="tel:${esc(telHref(lead.phone))}">Call</a><a class="btn secondary" href="sms:${esc(telHref(lead.phone))}">Text</a>` : ""}
        ${lead.email ? `<a class="btn secondary" href="mailto:${esc(lead.email)}">Email</a>` : ""}
        <button type="button" class="secondary" id="cardQB">Copy for QuickBooks</button>
        <button type="button" class="secondary" id="cardAll">Copy everything</button>
      </div>
      <div class="lc-body">
        ${stands.length ? `<h3>Where it stands</h3>${stands.map(([k, v]) => row(k, v)).join("")}` : ""}
        ${sections || `<p class="muted">Nothing filled in yet. Click Edit to add what you learn on the call.</p>`}
        ${fv.other.length ? `<h3>Other answers</h3>${fv.other.map((o) => row(o.q, o.a)).join("")}` : ""}
      </div>`, true);
    m.classList.add("lead-card-view");
    if (photos.length && $("#cardThumbs", m)) thumbsHtml(photos, false).then((h) => { if ($("#cardThumbs", m)) $("#cardThumbs", m).innerHTML = h; });
    $("[data-close]", m).onclick = close;
    $("#cardEdit", m).onclick = () => openEdit(lead.id);
    $("#cardAssign", m).onclick = () => openAssign(lead.id).catch(fail);
    $(".assign-pick-sel", m).onchange = (e) => assignChange(lead.id, e.target.value, () => openCard(lead.id).catch(fail));
    $("#cardQB", m).onclick = (e) => copy(qbText(lead), e.target);
    $("#cardAll", m).onclick = (e) => copy(allText(lead, intakes), e.target);
    const esc_ = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc_); } };
    document.addEventListener("keydown", esc_);
  }

  // =====================================================================
  // Assign a lead: make the branded lead report and tag the person in Slack
  // =====================================================================
  function buildReport(lead, intakes, who, note) {
    const fv = formValues(intakes);
    const val = (k) => { const f = [...FORM.flatMap((x) => x.fields), ...CALL_FIELDS].find((x) => x.k === k); return f ? fieldVal(lead, f, fv.values) : ""; };
    const sections = [...FORM, { title: "From the call", fields: CALL_FIELDS }].map((sec) => ({
      title: sec.title,
      rows: sec.fields.filter((f) => !["request", "goals"].includes(f.k)).map((f) => [f.label, fieldVal(lead, f, fv.values)]).filter(([, v]) => v),
    })).filter((sec) => sec.rows.length);
    if (fv.other.length) sections.push({ title: "Other answers", rows: fv.other.map((o) => [o.q, o.a]) });
    const me = state.me.full_name || state.me.email || "";
    return {
      v: 1, title: displayName(lead), contact_name: lead.contact_name || "", company: lead.company || "",
      phone: lead.phone || "", email: lead.email || "", address: lead.address || "",
      stage: STAGE[lead.stage] || lead.stage, channel: CHANNEL[lead.channel] || lead.channel, lead_date: niceDate(lead.lead_date),
      heard_about: lead.heard_about || "", service: val("service"),
      zone_quote: lead.zone_quote != null && lead.zone_quote !== "" ? "$" + lead.zone_quote : "",
      request: val("request"), goals: val("goals"), next_steps: lead.next_steps || "",
      note, assignee: ASSIGNEE[who], assigned_by: me.split(/[\s@]/)[0], assigned_at: new Date().toISOString(),
      sections, photos: ((lead.details || {}).photos || []).map((x) => ({ path: x.path, name: x.name || "" })),
    };
  }
  const newToken = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };

  async function assignChange(id, who, back) {
    try {
      if (who) return await openAssign(id, { who, back });
      const lead = await S.lead(id);
      const was = assigneeName(lead);
      const saved = await S.update(id, { details: { ...(lead.details || {}), assignee: "" } });
      if (was) await S.addNote(id, `No longer assigned to ${was}.`);
      const l = state.leads.find((x) => x.id === id); if (l) Object.assign(l, saved);
      toast("Unassigned");
      back();
    } catch (e) { fail(e); }
  }

  async function openAssign(id, opts = {}) {
    const [lead, intakes] = await Promise.all([S.lead(id), S.intakes(id)]);
    const d = lead.details || {};
    let who = opts.who || d.assignee || "";
    let sent = false; // closing without sending puts things back as they were
    const back = opts.back || (() => openCard(id).catch(fail));
    const { m, close } = modal(`
      <h2>Assign ${esc(displayName(lead))}</h2>
      <p class="small muted" style="margin-top:-4px">They get a branded lead report and a Slack message that tags them.</p>
      <div class="field"><label>Who's taking it?</label><div class="assign-pick">${ASSIGNEES.map(([k, v]) => `<button type="button" data-who="${k}" class="${k === who ? "on" : ""}">${v}</button>`).join("")}</div></div>
      <div class="field"><label for="as_note">Note for them (optional)</label><textarea id="as_note" rows="3" placeholder="e.g. Prefers texts before 10 AM. Can you get out there this week?"></textarea></div>
      <p class="error-text hidden" id="as_err"></p>
      <div class="btn-row" style="justify-content:flex-end"><button class="secondary" type="button" data-no>Cancel</button><button type="button" data-go>Assign and send</button></div>`, false, () => { if (!sent) back(); });
    $$("[data-who]", m).forEach((b) => (b.onclick = () => { who = b.dataset.who; $$("[data-who]", m).forEach((x) => x.classList.toggle("on", x === b)); }));
    $("[data-no]", m).onclick = () => close();
    $("[data-go]", m).onclick = async (e) => {
      const err = $("#as_err", m);
      if (!who) { err.textContent = "Pick who's taking it."; err.classList.remove("hidden"); return; }
      e.target.disabled = true; e.target.textContent = "Sending…";
      try {
        const report = buildReport(lead, intakes, who, $("#as_note", m).value.trim());
        const saved = await S.update(lead.id, { details: { ...d, assignee: who, report_token: d.report_token || newToken(), report } });
        await S.addNote(lead.id, `Assigned to ${ASSIGNEE[who]}. Lead report sent in Slack.`);
        let slack = "sent";
        try { const r = await S.assign(lead.id); slack = (r && r.slack) || "sent"; } catch (ex) { slack = friendly(ex); }
        const url = S.reportUrl(saved);
        const okSlack = slack === "sent" || slack === "demo";
        sent = true;
        close();
        const inList = state.leads.find((x) => x.id === lead.id); if (inList) Object.assign(inList, saved);
        refreshList();
        const done = modal(`
          <h2>${okSlack ? `Sent to ${esc(ASSIGNEE[who])}` : `Assigned to ${esc(ASSIGNEE[who])}`}</h2>
          <p>${slack === "demo" ? "On the demo page nothing goes to Slack, but here's the report they'd get." : okSlack ? `${esc(ASSIGNEE[who])} was tagged in Slack with a button to open the lead report.` : `The report is ready, but Slack didn't take the message: ${esc(slack)}. You can send them the link yourself.`}</p>
          <div class="btn-row"><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Open the lead report</a><button type="button" class="secondary" data-copy-link>Copy link</button><button type="button" class="secondary" data-back>Back to the lead</button></div>`);
        $("[data-copy-link]", done.m).onclick = (ev) => copy(url, ev.target);
        $("[data-back]", done.m).onclick = () => { done.close(); openCard(lead.id).catch(fail); };
      } catch (ex) { e.target.disabled = false; e.target.textContent = "Assign and send"; fail(ex); }
    };
  }

  // =====================================================================
  // Edit a lead: every intake question, filled from the form where we have it
  // =====================================================================
  function formInput(lead, f, fromForm) {
    const v = fieldVal(lead, f, fromForm);
    if (f.photos) {
      const n = ((lead.details || {}).photos || []).length;
      return `<div class="field photo-field-wrap"><label>${esc(f.label)}</label>
        ${v ? `<div class="form-links small">From the form: ${linkify(v)}</div>` : ""}
        <div class="thumbs" id="thumbs"></div>
        <label class="btn secondary photo-add">Add photos<input type="file" id="photoInput" accept="image/*" multiple hidden></label>
        <span class="small muted" id="photoCount">${n ? `${n} of ${MAX_PHOTOS}` : `Up to ${MAX_PHOTOS} photos`}</span></div>`;
    }
    if (f.heard) {
      const h = splitHeard(v);
      return `<div class="field"><label for="heard_about_pick">${esc(f.label)}</label>
        <select id="heard_about_pick"><option value="">Not answered</option>${HEARD.map((o) => `<option ${o === h.pick ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>
        <input id="heard_about_more" class="hidden" style="margin-top:8px" value="${esc(h.more)}" autocomplete="off">
        <input type="hidden" id="heard_about" data-f="heard_about" value="${esc(v)}"></div>`;
    }
    const attr = f.col ? `data-f="${f.k}"` : `data-d="${f.k}"`;
    if (f.yn || f.options) {
      const choices = f.options || ["Yes", "No"];
      const cur = f.yn ? (/^\s*y/i.test(v) ? "Yes" : /^\s*n/i.test(v) ? "No" : v) : (choices.find((c) => c.toLowerCase() === v.trim().toLowerCase()) || v);
      const opts = ["", ...choices].concat(cur && !choices.includes(cur) ? [cur] : []);
      return `<div class="field"><label for="${f.k}">${esc(f.label)}</label><select id="${f.k}" ${attr}>${opts.map((o) => `<option value="${esc(o)}" ${o === cur ? "selected" : ""}>${o ? esc(o) : "Not answered"}</option>`).join("")}</select></div>`;
    }
    const tag = f.area
      ? `<textarea id="${f.k}" ${attr} rows="${f.rows || 2}">${esc(v)}</textarea>`
      : `<input id="${f.k}" ${attr} type="${f.type || "text"}" value="${esc(v)}" ${f.type === "tel" ? 'inputmode="tel"' : ""}>`;
    if (!f.copy) return `<div class="field"><label for="${f.k}">${esc(f.label)}</label>${tag}</div>`;
    return `<div class="field"><label for="${f.k}">${esc(f.label)}</label><div class="copy-field">${tag}<button type="button" class="copy-btn" data-copy="${f.k}">Copy</button></div></div>`;
  }

  // Edit inside the card: same edit view, in a large pop-up over the list
  function openEdit(id) {
    let changed = false;
    const { m, close } = modal(`<div id="editHost"><p class="muted">Loading…</p></div>`, true, () => { if (changed) refreshList(); });
    m.classList.add("lead-edit-modal");
    renderLead(id, $("#editHost", m), {
      done: () => { close(); openCard(id).catch(fail); },
      changed: () => { changed = true; },
    }).catch(fail);
  }
  // Redraw the list behind a pop-up without losing the filters
  function refreshList() { if (!location.hash.includes("lead=")) renderList().catch(fail); }

  async function renderLead(id, host, inCard) {
    host = host || $("#view");
    const [l, intakes, notes] = await Promise.all([S.lead(id), S.intakes(id), S.notes(id)]);
    let lead = l;
    const fv = formValues(intakes);
    const sectionHtml = (s) => {
      // Keep the form's order; short answers two to a row, long answers full width
      const parts = []; let run = [];
      const flush = () => { if (run.length) parts.push(`<div class="grid2">${run.join("")}</div>`); run = []; };
      s.fields.forEach((f) => { const h = formInput(lead, f, fv.values); if (f.area || f.photos) { flush(); parts.push(h); } else run.push(h); });
      flush();
      return `<h3 class="form-h">${esc(s.title)}</h3>${parts.join("")}`;
    };
    host.innerHTML = `
      ${inCard
        ? `<div class="edit-bar"><span class="small muted">Changes save as you type.</span><button type="button" id="backLink">Done</button></div>`
        : `<p style="margin:0 0 10px"><a href="#" id="backLink">← All leads</a></p>`}
      <div class="lead-head">
        <div><p class="eyebrow">Editing · ${esc(CHANNEL[lead.channel] || lead.channel)}${lead.lead_date ? " · " + esc(niceDate(lead.lead_date)) : ""}</p>
          <h1 id="leadTitle">${esc(displayName(lead))}</h1>
          <div>${stageBadge(lead.stage)} <span class="saved-note" id="savedNote"></span></div></div>
      </div>
      <div class="quick">
        ${lead.phone ? `<a class="btn" href="tel:${esc(telHref(lead.phone))}">Call</a><a class="btn secondary" href="sms:${esc(telHref(lead.phone))}">Text</a>` : ""}
        ${lead.email ? `<a class="btn secondary" href="mailto:${esc(lead.email)}">Email</a>` : ""}
        <button type="button" class="secondary" id="viewCard">View card</button>
        <button type="button" class="secondary" id="copyQB">Copy for QuickBooks</button>
        <button type="button" class="secondary" id="copyAll">Copy everything</button>
      </div>
      <div class="lead-grid">
        <div>
          <div class="card"><h2>Where it stands</h2>
            <div class="grid2">
              <div class="field"><label for="stage">Stage</label><select id="stage" data-f="stage">${STAGES.map(([k, v]) => `<option value="${k}" ${lead.stage === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
              <div class="field"><label>Assigned to</label><div class="assign-line"><strong>${esc(assigneeName(lead) || "Not assigned")}</strong><button type="button" class="secondary assign-btn" id="editAssign">${assigneeName(lead) ? "Reassign or resend" : "Assign and send report"}</button></div></div>
            </div>
            <div class="field"><label for="next_steps">Next steps</label><textarea id="next_steps" data-f="next_steps" rows="2">${esc(lead.next_steps)}</textarea></div>
            <div class="grid2">
              <div class="field"><label for="channel">Came in by</label><select id="channel" data-f="channel">${CHANNELS.map(([k, v]) => `<option value="${k}" ${lead.channel === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
              <div class="field"><label for="lead_date">Date it came in</label><input id="lead_date" data-f="lead_date" type="date" value="${esc(lead.lead_date || "")}"></div>
            </div>
            <div class="grid2">
              <div class="field"><label for="zone_quote">Zone quote ($)</label><input id="zone_quote" data-f="zone_quote" type="number" inputmode="decimal" step="any" value="${lead.zone_quote == null ? "" : esc(lead.zone_quote)}"></div>
              <div class="field"><label>&nbsp;</label><label class="check qb-check"><input type="checkbox" id="in_quickbooks" data-f="in_quickbooks" ${lead.in_quickbooks ? "checked" : ""}> Entered in QuickBooks ✓</label></div>
            </div>
            <div class="field ${lead.stage === "lost" ? "" : "hidden"}" id="lostWrap"><label for="closed_reason">Why we lost it</label><input id="closed_reason" data-f="closed_reason" value="${esc(lead.closed_reason)}"></div>
          </div>
          <div class="card"><h2>Intake form</h2>
            <p class="small muted" style="margin-top:0">The same questions as the client intake form. Answers from the client's form fill in here on their own, and anything you change is saved as you go.</p>
            ${FORM.map(sectionHtml).join("")}
          </div>
        </div>
        <div>
          <div class="card"><h2>From the call</h2>
            ${CALL_FIELDS.map((f) => formInput(lead, f, fv.values)).join("")}
          </div>
          <div class="card"><h2>Notes and history</h2>
            <div class="field"><textarea id="newNote" rows="2" placeholder="Add a note: left a message, sent intake form, booked for Tuesday…"></textarea></div>
            <button type="button" id="addNoteBtn" class="small">Add note</button>
            <div id="notesOut" style="margin-top:10px">${notesHtml(notes)}</div>
          </div>
          ${intakes.length ? `<div class="card"><details><summary><strong>Original form submissions (${intakes.length})</strong></summary>
            ${intakes.map((it) => `<div class="intake-meta">${srcLabel(it)} · ${esc(niceTime(it.submitted_at))}</div>
              ${(it.answers || []).filter((x) => String(x.a || "").trim()).map((x) => `<div class="qa"><div class="q">${esc(x.q)}</div><div class="a">${linkify(x.a)}</div></div>`).join("")}`).join("")}
          </details></div>` : ""}
          ${isAdmin() ? `<p style="text-align:right"><button type="button" class="danger small" id="delBtn">Delete this lead</button></p>` : ""}
        </div>
      </div>`;

    $("#backLink").onclick = (e) => { e.preventDefault(); if (inCard) inCard.done(); else location.hash = ""; };
    $("#viewCard").onclick = () => (inCard ? inCard.done() : openCard(lead.id).catch(fail));
    $$("[data-copy]").forEach((b) => (b.onclick = () => copy($("#" + b.dataset.copy).value, b)));
    $("#copyQB").onclick = (e) => copy(qbText(lead), e.target);
    $("#copyAll").onclick = (e) => copy(allText(lead, intakes), e.target);

    // Save each field as soon as it changes
    let pending = Promise.resolve();
    addressLookup($("#address"));
    wireHeard(host);
    $("#editAssign").onclick = async () => { try { await pending; } catch (e) { /* shown already */ } openAssign(lead.id).catch(fail); };
    // Photos: upload as soon as they're picked
    const photosNow = () => ((lead.details || {}).photos || []).slice();
    const drawThumbs = async () => {
      $("#thumbs").innerHTML = await thumbsHtml(photosNow(), true);
      const n = photosNow().length;
      $("#photoCount").textContent = n ? `${n} of ${MAX_PHOTOS}` : `Up to ${MAX_PHOTOS} photos`;
      $$("[data-rm]", $("#thumbs")).forEach((b) => (b.onclick = async () => {
        const list = photosNow(); const [gone] = list.splice(Number(b.dataset.rm), 1);
        try {
          lead = await S.update(lead.id, { details: { ...(lead.details || {}), photos: list } });
          S.removeLeadPhotos([gone.path]).catch(() => {});
          drawThumbs(); toast("Photo removed");
        } catch (e) { fail(e); }
      }));
    };
    if ($("#photoInput")) {
      drawThumbs();
      $("#photoInput").onchange = async (e) => {
        const files = [...e.target.files].slice(0, Math.max(0, MAX_PHOTOS - photosNow().length));
        e.target.value = "";
        if (!files.length) return toast(`That's the most photos (${MAX_PHOTOS}) for one lead.`, true);
        $("#savedNote").textContent = "Uploading photos…";
        try {
          const added = [];
          for (const file of files) added.push({ path: await S.uploadLeadPhoto(lead.id, await shrinkPhoto(file)), name: file.name });
          lead = await S.update(lead.id, { details: { ...(lead.details || {}), photos: [...photosNow(), ...added] } });
          $("#savedNote").textContent = "Saved";
          drawThumbs();
        } catch (ex) { $("#savedNote").textContent = ""; fail(ex); }
      };
    }
    const saveField = (el, patchFor) => {
      $("#savedNote").textContent = "Saving…";
      if (inCard) inCard.changed();
      pending = pending.then(async () => {
        lead = await S.update(lead.id, patchFor());
        $("#savedNote").textContent = "Saved";
        return lead;
      });
      return pending;
    };
    $$("[data-d]").forEach((el) => el.addEventListener("change", () => {
      const k = el.dataset.d;
      let v = el.value.trim();
      if (el.type === "email") {
        v = v.toLowerCase();
        el.classList.toggle("invalid", !EMAIL_OK(v));
        if (!EMAIL_OK(v)) { $("#savedNote").textContent = "Not saved: " + BAD_EMAIL; return; }
      }
      saveField(el, () => ({ details: { ...(lead.details || {}), [k]: v } })).catch((e) => { $("#savedNote").textContent = ""; fail(e); });
    }));
    $$("[data-f]").forEach((el) => {
      el.addEventListener("change", () => {
        const k = el.dataset.f;
        let v = el.type === "checkbox" ? el.checked : el.value;
        if (k === "zone_quote") v = v === "" ? null : Number(v);
        if (k === "assigned_to" || k === "lead_date") v = v || null;
        if (k === "email") {
          v = String(v).trim().toLowerCase();
          el.classList.toggle("invalid", !EMAIL_OK(v));
          if (!EMAIL_OK(v)) { $("#savedNote").textContent = "Not saved: " + BAD_EMAIL; return; }
        }
        saveField(el, () => ({ [k]: v })).then(async () => {
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
    if ($("#delBtn")) $("#delBtn").onclick = async (e) => {
      const btn = e.target;
      if (!btn.dataset.sure) {
        btn.dataset.sure = "1";
        btn.textContent = "Click again to delete for good";
        setTimeout(() => { if (document.body.contains(btn)) { delete btn.dataset.sure; btn.textContent = "Delete this lead"; } }, 5000);
        return;
      }
      try {
        const paths = ((lead.details || {}).photos || []).map((x) => x.path);
        await S.remove(lead.id);
        S.removeLeadPhotos(paths).catch(() => {});
        toast("Lead deleted");
        if (inCard) { $("#modalRoot").innerHTML = ""; refreshList(); } else location.hash = "";
      } catch (ex) { fail(ex); }
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
    const blank = { details: {} };
    const grid = (fields) => {
      const parts = []; let run = [];
      const flush = () => { if (run.length) parts.push(`<div class="grid2">${run.join("")}</div>`); run = []; };
      fields.forEach((f) => { const h = formInput(blank, f, {}); if (f.area || f.photos) { flush(); parts.push(h); } else run.push(h); });
      flush();
      return parts.join("");
    };
    const callFields = CALL_FIELDS.filter((f) => f.k === "request" || f.k === "company");
    const [first, ...rest] = FORM;
    const { m, close } = modal(`
      <h2>Add a lead</h2>
      <div class="field"><label>How did it come in?</label><div class="channel-pick">${CHANNELS.filter(([k]) => k !== "intake_form").map(([k, v]) => `<button type="button" data-ch="${k}" class="${k === channel ? "on" : ""}">${v}</button>`).join("")}</div></div>
      <h3 class="form-h">${esc(first.title)}</h3>
      ${grid(first.fields)}
      <h3 class="form-h">From the call</h3>
      ${grid(callFields)}
      <div class="field"><label for="a_next">Next steps</label><input id="a_next" autocomplete="off" placeholder="e.g. Send intake form"></div>
      <p class="small muted" style="margin:14px 0 4px">The rest of the intake form. Open a section to fill it in now, or add it later from Edit.</p>
      ${rest.map((s) => `<details class="add-sec"><summary>${esc(s.title)}</summary>${grid(s.fields)}</details>`).join("")}
      <p class="error-text hidden" id="a_err"></p>
      <label class="check" style="margin:14px 0"><input type="checkbox" id="a_slack" checked> Let the team know in Slack</label>
      <div class="btn-row" style="justify-content:flex-end"><button class="secondary" type="button" data-no>Cancel</button><button type="button" data-save>Save lead</button></div>`, true);
    m.classList.add("add-lead");
    $('label[for="contact_name"]', m).insertAdjacentHTML("beforeend", ' <span class="req">*</span>');
    $("#address", m).placeholder = "Start typing and pick from the list";
    $("#request", m).placeholder = "Paste the voicemail, text or email, or type a summary";
    $$("[data-copy]", m).forEach((b) => b.remove());
    $$("[data-ch]", m).forEach((b) => (b.onclick = () => { channel = b.dataset.ch; $$("[data-ch]", m).forEach((x) => x.classList.toggle("on", x === b)); }));
    $("[data-no]", m).onclick = close;
    addressLookup($("#address", m));
    wireHeard(m);
    // Photos picked here upload once the lead is saved
    let picked = [];
    const showPicked = () => {
      $("#thumbs", m).innerHTML = picked.map((f, i) => `<div class="thumb"><img src="${esc(f.url)}" alt=""><button type="button" class="thumb-x" data-rm="${i}" aria-label="Remove photo">✕</button></div>`).join("");
      $("#photoCount", m).textContent = picked.length ? `${picked.length} of ${MAX_PHOTOS}` : `Up to ${MAX_PHOTOS} photos`;
      $$("[data-rm]", $("#thumbs", m)).forEach((b) => (b.onclick = () => { URL.revokeObjectURL(picked[b.dataset.rm].url); picked.splice(Number(b.dataset.rm), 1); showPicked(); }));
    };
    $("#photoInput", m).onchange = (e) => {
      [...e.target.files].slice(0, MAX_PHOTOS - picked.length).forEach((file) => picked.push({ file, url: URL.createObjectURL(file) }));
      e.target.value = "";
      showPicked();
    };
    const err = $("#a_err", m);
    $$('input[type="email"]', m).forEach((el) => el.addEventListener("blur", () => {
      const ok = EMAIL_OK(el.value);
      el.classList.toggle("invalid", !ok);
      if (!ok) { err.textContent = BAD_EMAIL; err.classList.remove("hidden"); }
      else if (err.textContent === BAD_EMAIL && !$$("input.invalid", m).length) err.classList.add("hidden");
    }));
    setTimeout(() => $("#contact_name", m).focus(), 50);
    const val = (k) => { const el = $("#" + k, m); return el ? el.value.trim() : ""; };
    $("[data-save]", m).onclick = async (e) => {
      const name = val("contact_name");
      const phone = val("phone");
      const email = val("email").toLowerCase();
      if (!name && !phone && !email) { err.textContent = "Add at least a name, phone or email."; err.classList.remove("hidden"); return; }
      const bad = $$('input[type="email"]', m).find((el) => !EMAIL_OK(el.value));
      if (bad) {
        bad.classList.add("invalid"); const sec = bad.closest("details"); if (sec) sec.open = true; bad.focus();
        err.textContent = BAD_EMAIL; err.classList.remove("hidden"); return;
      }
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
      // Questions with their own column go there; the rest of the form goes in details
      const row = { channel, lead_date: isoDate(new Date()), next_steps: val("a_next") };
      const details = {};
      [...FORM.flatMap((s) => s.fields), ...callFields].filter((f) => !f.photos).forEach((f) => {
        const v = f.k === "email" ? email : val(f.k);
        if (f.col) row[f.k] = v; else if (v) details[f.k] = v;
      });
      row.details = details;
      const last = name.split(/\s+/).pop();
      if (!row.project_name) row.project_name = row.company || (last ? `${last} Residence` : "");
      try {
        let lead = await S.add(row);
        if (picked.length) {
          try {
            const photos = [];
            for (const p of picked) photos.push({ path: await S.uploadLeadPhoto(lead.id, await shrinkPhoto(p.file)), name: p.file.name });
            lead = await S.update(lead.id, { details: { ...(lead.details || {}), photos } });
          } catch (pe) { toast("Lead saved, but a photo didn't upload: " + friendly(pe), true); }
        }
        if ($("#a_slack", m).checked) {
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
      ["Assigned to", 18, (l) => assigneeName(l)], ["Zone quote", 12, (l) => l.zone_quote == null ? "" : Number(l.zone_quote)],
      ["Next steps", 34, (l) => l.next_steps], ["Service", 18, (l) => l.service], ["Request", 60, (l) => l.request],
      ["Entered in QuickBooks", 20, (l) => (l.in_quickbooks ? "✓ Yes" : "")],
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
