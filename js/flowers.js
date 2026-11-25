// =====================================================================
// Flower season planner (admins): every client's seasonal flower job in
// one place, replacing the estimates and tally spreadsheets.
//  - Season page: each client's job with flats, cost, client price and
//    profit; season totals; copy a past season to start the next one
//  - Job page: plants (flats worked out from plants needed), beds and
//    pots for soil, labor, materials, QuickBooks estimate lines, and
//    ordered / used for leftovers and actual cost
//  - Order list: every plant and material across the season, by client
//  - Branded Excel download of the season
// The math is in js/flower-calc.js (same rules as the estimates workbook).
// Tables: supabase/09_flower_planner.sql. Sample: flowers.html?demo
// =====================================================================
(function () {
  const cfg = window.HH_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const DEMO = params.has("demo") || !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const TT = cfg.TIME_TRACKER_URL || "https://harmony-horticulture.github.io/time-tracker/";
  const C = window.FlowerCalc;
  const SEED = window.HH_FLOWER_SEED || { season: "", jobs: [] };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money0 = (n) => "$" + Math.round(n || 0).toLocaleString("en-US");
  const pct = (n) => Math.round((n || 0) * 100) + "%";
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const nice = (iso) => {
    if (!iso) return "";
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    toastTimer = setTimeout(() => t.classList.add("hidden"), isError ? 7000 : 3000);
  }
  function friendly(e) {
    const msg = (e && (e.message || String(e))) || "Something went wrong.";
    if (/flower_jobs|flower_settings/.test(msg) && /does not exist|Could not find/.test(msg)) return "The flower planner isn't set up in Supabase yet. Run supabase/09_flower_planner.sql.";
    if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
    if (/Failed to fetch|NetworkError/i.test(msg)) return "Can't reach the server. Check your connection and try again.";
    return msg;
  }
  const fail = (e) => { console.warn(e); toast(friendly(e), true); };

  // A job row from the database <-> the job object the screens use
  const toJob = (row) => ({ ...(row.data || {}), id: row.id, season: row.season, client_id: row.client_id, client_name: row.client_name, status: row.status, install_date: row.install_date || "", updated_at: row.updated_at, updated_by_name: row.updated_by_name });
  const toRow = (j) => {
    const { id, season, client_id, client_name, status, install_date, updated_at, updated_by_name, ...data } = j;
    return { id, season, client_id: client_id || null, client_name, status: status || "Draft", install_date: install_date || null, data };
  };
  const blankJob = (season, name) => ({ id: uid(), season, client_name: name || "", client_id: null, status: "Draft", install_date: "", address: "", qb_estimate: "", plants: [], labor: [], materials: [], locations: [], notes: "" });

  // =====================================================================
  // Data
  // =====================================================================
  function liveStore() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    const ok = (res) => { if (res.error) throw new Error(res.error.message); return res.data; };
    return {
      sb,
      async me() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return null;
        return ok(await sb.from("profiles").select("id, email, full_name, role, active").eq("id", data.session.user.id).single());
      },
      async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
      async signOut() { await sb.auth.signOut(); },
      async jobs() { return ok(await sb.from("flower_jobs").select("*").order("install_date", { ascending: true, nullsFirst: false })).map(toJob); },
      async save(job, by) { ok(await sb.from("flower_jobs").upsert({ ...toRow(job), updated_by_name: by })); },
      async saveMany(jobs, by) { ok(await sb.from("flower_jobs").insert(jobs.map((j) => ({ ...toRow(j), updated_by_name: by })))); },
      async remove(id) { ok(await sb.from("flower_jobs").delete().eq("id", id)); },
      async settings() { const r = await sb.from("report_settings").select("flower_settings").eq("id", 1).maybeSingle(); return r.error || !r.data ? null : r.data.flower_settings; },
      async saveSettings(s) { ok(await sb.from("report_settings").update({ flower_settings: s }).eq("id", 1)); },
      async clients() { const r = await sb.from("clients").select("id, name, properties").eq("active", true).order("name"); return r.error ? [] : r.data; },
      async materials() { const r = await sb.from("materials").select("name, unit, price, cost").eq("active", true).order("name"); return r.error ? [] : r.data; },
    };
  }
  function demoStore() {
    const KEY = "hh-flowers-demo-v1";
    let db;
    try { db = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { db = null; }
    if (!db) db = { jobs: SEED.jobs.map((j) => ({ ...clone(j), id: uid(), season: SEED.season })), settings: null };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* private mode */ } };
    save();
    return {
      async me() { return { full_name: "Demo Admin", role: "admin", active: true }; },
      async signIn() {}, async signOut() { localStorage.removeItem(KEY); },
      async jobs() { return clone(db.jobs); },
      async save(job) { const i = db.jobs.findIndex((j) => j.id === job.id); if (i >= 0) db.jobs[i] = clone(job); else db.jobs.push(clone(job)); save(); },
      async saveMany(jobs) { jobs.forEach((j) => db.jobs.push(clone(j))); save(); },
      async remove(id) { db.jobs = db.jobs.filter((j) => j.id !== id); save(); },
      async settings() { return db.settings; },
      async saveSettings(s) { db.settings = s; save(); },
      async clients() { return SEED.jobs.map((j, i) => ({ id: i + 1, name: j.client_name + " Residence", properties: [j.address] })); },
      async materials() { return [{ name: "Mirimichi", unit: "bag", cost: 70 }, { name: "Omni Seed Cover / Compost", unit: "bag", cost: 5.4 }, { name: "MitoGro", unit: "lb", cost: 90 }, { name: "Watering can", unit: "each", cost: 15 }]; },
    };
  }
  const S = DEMO ? demoStore() : liveStore();
  const state = { me: null, jobs: [], settings: null, clients: [], materials: [], season: "", dirty: new Set() };
  const myName = () => (state.me && (state.me.full_name || state.me.email)) || "";
  const sett = () => C.settingsWith(state.settings);

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
      <p class="small muted" style="text-align:center;margin-top:14px">Same email and password as the Reports app and the Time Tracker.</p>`;
    $("#signInForm").onsubmit = async (e) => {
      e.preventDefault();
      try { await S.signIn($("#em").value.trim(), $("#pw").value); start(); }
      catch (err) { showAuth(/Invalid login/i.test(err.message) ? "That email and password don't match." : err.message); }
    };
  }
  async function start() {
    try {
      state.me = await S.me();
      if (!state.me) return showAuth();
      if (!state.me.active) return showAuth("Your account is switched off. Ask an admin.");
      if (state.me.role !== "admin") return showAuth("The flower planner is for admins.");
      [state.jobs, state.settings, state.clients, state.materials] = await Promise.all([S.jobs(), S.settings().catch(() => null), S.clients(), S.materials()]);
    } catch (e) {
      $("#loading").classList.add("hidden");
      return showAuth(friendly(e));
    }
    $("#loading").classList.add("hidden");
    $("#authView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    $("#demoBanner").classList.toggle("hidden", !DEMO);
    $("#whoName").textContent = myName();
    $("#whoRole").textContent = "Admin";
    const q = DEMO ? "?demo" : "";
    const tt = esc(TT);
    $("#sideNav").innerHTML = `<a class="nav-link" href="dashboard.html${q}">Dashboard</a>
      <a class="nav-link" href="leads.html${q}">Leads</a>
      <a class="nav-link active" href="flowers.html${q}#">Flower planner</a>
      <a class="nav-link" href="statements.html${q}">Statement check</a>
      <a class="nav-link" href="index.html${q}">Reports</a>
      <a class="nav-link" href="sops.html${q}">SOPs</a>
      <a class="nav-link" href="${tt}">Time tracker ↗</a>
      <a class="nav-link" href="${tt}#people">People ↗</a>`;
    $("#bottomNav").innerHTML = `<a class="nav-link" href="dashboard.html${q}">Home</a><a class="nav-link active" href="flowers.html${q}#">Flowers</a><a class="nav-link" href="flowers.html${q}#order">Order list</a><a class="nav-link" href="leads.html${q}">Leads</a>`;
    const out = async () => { await S.signOut(); location.reload(); };
    $("#signOutBtn").onclick = out;
    $("#signOutBtnMobile").onclick = out;
    const seasons = seasonList();
    state.season = sessionStorage.getItem("hh-flower-season") || seasons[0] || "";
    if (!seasons.includes(state.season)) state.season = seasons[0] || "";
    route();
  }
  window.addEventListener("hashchange", () => route());
  window.addEventListener("beforeunload", (e) => { if (state.dirty.size) { flush(); e.preventDefault(); e.returnValue = ""; } });

  // Seasons newest first: "Spring 2027" after "Fall 2026"
  function seasonKey(s) {
    const m = String(s).match(/(spring|summer|fall|autumn|winter)\s+(\d{4})/i);
    if (!m) return String(s);
    return m[2] + ({ spring: 1, summer: 2, fall: 3, autumn: 3, winter: 4 }[m[1].toLowerCase()]);
  }
  const seasonList = () => [...new Set(state.jobs.map((j) => j.season))].sort((a, b) => seasonKey(b).localeCompare(seasonKey(a)));
  const seasonJobs = () => state.jobs.filter((j) => j.season === state.season).sort((a, b) => (a.install_date || "9999").localeCompare(b.install_date || "9999") || a.client_name.localeCompare(b.client_name));
  function nextSeason(s) {
    const m = String(s || "").match(/(spring|fall)\s+(\d{4})/i);
    if (!m) { const y = new Date().getFullYear(); return new Date().getMonth() < 6 ? `Fall ${y}` : `Spring ${y + 1}`; }
    return /spring/i.test(m[1]) ? `Fall ${m[2]}` : `Spring ${Number(m[2]) + 1}`;
  }

  function route() {
    flush();
    window.scrollTo(0, 0);
    const h = location.hash;
    const m = h.match(/job=([\w-]+)/);
    if (m) return renderJob(m[1]);
    if (h === "#order") return renderOrder();
    return renderSeason();
  }

  // =====================================================================
  // Saving: a second after the last change, and when leaving the page
  // =====================================================================
  let saveTimer = null;
  function changed(job) {
    state.dirty.add(job.id);
    const el = $("#saveState");
    if (el) el.textContent = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 1000);
  }
  async function flush() {
    clearTimeout(saveTimer);
    const ids = [...state.dirty];
    state.dirty.clear();
    for (const id of ids) {
      const job = state.jobs.find((j) => j.id === id);
      if (!job) continue;
      try { await S.save(job, myName()); job.updated_by_name = myName(); job.updated_at = new Date().toISOString(); }
      catch (e) { state.dirty.add(id); fail(e); }
    }
    const el = $("#saveState");
    if (el && !state.dirty.size) el.textContent = "Saved";
  }

  // =====================================================================
  // Season page
  // =====================================================================
  function renderSeason() {
    const seasons = seasonList();
    const jobs = seasonJobs();
    const totals = jobs.map((j) => ({ j, t: C.jobTotals(j, state.settings) }));
    const sum = (f) => totals.reduce((a, x) => a + (f(x) || 0), 0);
    const tone = { Draft: "sent", "Sent to client": "new", Approved: "approved", Ordered: "approved", Installed: "approved", Billed: "sent" };
    $("#view").innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Admin · seasonal flowers, from estimate to install</p><h1>Flower planner</h1></div>
        <div class="btn-row">
          ${seasons.length ? `<select id="seasonSel" aria-label="Season">${seasons.map((s) => `<option ${s === state.season ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>` : ""}
          <button type="button" class="secondary" id="newSeason">Start a new season</button>
        </div></div>
      ${!seasons.length ? `<div class="card"><h2 style="margin-top:0">Start your first season</h2>
        <p>Bring in Fall 2026 from the old estimates and tally spreadsheets (${SEED.jobs.length} clients, with their plants, materials and labor), then copy it to start the next season. Or start empty.</p>
        <div class="btn-row"><button type="button" id="importSeed">Bring in Fall 2026</button><button type="button" class="secondary" id="newSeason2">Start empty</button></div></div>` : `
      <div class="stat-row">
        <div class="stat"><div class="label">Clients</div><div class="num">${jobs.length}</div></div>
        <div class="stat"><div class="label">Flats</div><div class="num">${Math.round(sum((x) => x.t.flats))}</div></div>
        <div class="stat"><div class="label">Our cost</div><div class="num">${money0(sum((x) => x.t.cost))}</div></div>
        <div class="stat"><div class="label">Client price</div><div class="num">${money0(sum((x) => x.t.price))}</div></div>
        <div class="stat"><div class="label">Profit</div><div class="num">${money0(sum((x) => x.t.profit))}</div></div>
      </div>
      <div class="card">
        <div class="btn-row" style="margin-bottom:12px"><h2 style="margin:0;flex:1">${esc(state.season)}</h2>
          <a class="btn secondary" href="flowers.html${DEMO ? "?demo" : ""}#order">Order list</a>
          <button type="button" class="secondary" id="dlSeason">Download Excel</button>
          <button type="button" class="secondary" id="settingsBtn">Rates and markups</button>
          <button type="button" id="addJob">+ Add a client</button></div>
        ${jobs.length ? `<div class="table-wrap"><table class="fl-season">
          <thead><tr><th>Client</th><th>Install</th><th>Status</th><th class="num">Flats</th><th class="num">Plants</th><th class="num">Labor hrs</th><th class="num">Our cost</th><th class="num">Client price</th><th class="num">Profit</th><th></th></tr></thead>
          <tbody>${totals.map(({ j, t }) => `<tr data-open="${esc(j.id)}">
            <td><strong>${esc(j.client_name || "No name")}</strong>${j.address ? `<div class="small muted">${esc(j.address)}</div>` : ""}</td>
            <td style="white-space:nowrap">${esc(nice(j.install_date))}</td>
            <td><span class="badge ${tone[j.status] || "sent"}">${esc(j.status)}</span></td>
            <td class="num">${t.flats}</td><td class="num">${t.plantCount}</td><td class="num">${t.hours}</td>
            <td class="num">${money(t.cost)}</td><td class="num">${money(t.price)}</td><td class="num">${money(t.profit)}<div class="small muted">${pct(t.margin)}</div></td>
            <td>${t.warnings.length ? `<span class="badge pending" title="${esc(t.warnings.join("\n"))}">${t.warnings.length} to fill in</span>` : ""}</td></tr>`).join("")}</tbody>
        </table></div>` : `<p class="muted">No clients in this season yet. Add one, or copy a past season.</p>`}
      </div>`}`;
    if ($("#seasonSel")) $("#seasonSel").onchange = (e) => { state.season = e.target.value; sessionStorage.setItem("hh-flower-season", state.season); renderSeason(); };
    $$("[data-open]").forEach((tr) => (tr.onclick = () => { location.hash = "job=" + tr.dataset.open; }));
    const ns = () => openNewSeason();
    if ($("#newSeason")) $("#newSeason").onclick = ns;
    if ($("#newSeason2")) $("#newSeason2").onclick = ns;
    if ($("#importSeed")) $("#importSeed").onclick = async () => {
      const jobs = SEED.jobs.map((j) => ({ ...clone(j), id: uid(), season: SEED.season, client_id: matchClient(j.client_name) }));
      try { await S.saveMany(jobs, myName()); state.jobs.push(...jobs); state.season = SEED.season; renderSeason(); toast(`Brought in ${jobs.length} clients from Fall 2026.`); } catch (e) { fail(e); }
    };
    if ($("#addJob")) $("#addJob").onclick = () => openAddJob();
    if ($("#settingsBtn")) $("#settingsBtn").onclick = () => openSettings();
    if ($("#dlSeason")) $("#dlSeason").onclick = () => downloadSeason().catch(fail);
  }
  function matchClient(name) {
    const n = String(name || "").toLowerCase();
    const c = state.clients.find((x) => x.name.toLowerCase() === n) || state.clients.find((x) => x.name.toLowerCase().startsWith(n + " ") || x.name.toLowerCase().startsWith(n + ","));
    return c ? c.id : null;
  }

  function modal(html) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const close = () => { root.innerHTML = ""; };
    $(".modal-back", root).addEventListener("click", (e) => { if (e.target.classList.contains("modal-back")) close(); });
    $$("[data-close]", root).forEach((b) => (b.onclick = close));
    return { m: $(".modal", root), close };
  }

  function openNewSeason() {
    const seasons = seasonList();
    const { m, close } = modal(`
      <h2>Start a new season</h2>
      <div class="field"><label for="nsName">Season name</label><input id="nsName" value="${esc(nextSeason(seasons[0]))}"></div>
      ${seasons.length ? `<div class="field"><label for="nsFrom">Start from</label><select id="nsFrom"><option value="">Nothing (empty season)</option>${seasons.map((s, i) => `<option ${i === 0 ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
        <p class="small muted">Copies each client's plants, beds, labor and materials. Status goes back to Draft, and install dates, ordered and used amounts and actual hours are cleared. Change plants and prices for the new season after.</p></div>` : ""}
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="secondary" data-close>Cancel</button><button type="button" id="nsGo">Start season</button></div>`);
    $("#nsGo", m).onclick = async () => {
      const name = $("#nsName", m).value.trim();
      if (!name) return toast("Give the season a name, like Spring 2027.", true);
      if (seasonList().includes(name)) return toast("That season already exists.", true);
      const from = $("#nsFrom", m) ? $("#nsFrom", m).value : "";
      const jobs = state.jobs.filter((j) => j.season === from).map((j) => {
        const n = clone(j);
        Object.assign(n, { id: uid(), season: name, status: "Draft", install_date: "", qb_estimate: "" });
        delete n.updated_at; delete n.updated_by_name;
        (n.plants || []).forEach((p) => { p.ordered = null; p.used = null; });
        (n.materials || []).forEach((x) => { x.ordered = null; x.used = null; });
        (n.labor || []).forEach((x) => { x.actual_hours = null; });
        return n;
      });
      try {
        if (jobs.length) await S.saveMany(jobs, myName());
        state.jobs.push(...jobs);
        state.season = name; sessionStorage.setItem("hh-flower-season", name);
        close();
        if (!jobs.length) { const j = blankJob(name, ""); state.jobs.push(j); await S.save(j, myName()); location.hash = "job=" + j.id; return; }
        location.hash = ""; renderSeason();
        toast(`${name} started with ${jobs.length} clients.`);
      } catch (e) { fail(e); }
    };
  }
  function openAddJob() {
    const { m, close } = modal(`
      <h2>Add a client to ${esc(state.season)}</h2>
      <div class="field"><label for="ajName">Client</label><input id="ajName" list="ajList" placeholder="Start typing a client name"><datalist id="ajList">${state.clients.map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist></div>
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="secondary" data-close>Cancel</button><button type="button" id="ajGo">Add</button></div>`);
    $("#ajName", m).focus();
    $("#ajGo", m).onclick = async () => {
      const name = $("#ajName", m).value.trim();
      if (!name) return;
      const c = state.clients.find((x) => x.name.toLowerCase() === name.toLowerCase());
      const j = blankJob(state.season, c ? c.name : name);
      if (c) { j.client_id = c.id; j.address = (c.properties || [])[0] || ""; }
      try { await S.save(j, myName()); state.jobs.push(j); close(); location.hash = "job=" + j.id; } catch (e) { fail(e); }
    };
  }

  // Rates, markups and crew
  function openSettings() {
    const s = sett();
    const pctIn = (v) => Math.round((v || 0) * 1000) / 10;
    const { m, close } = modal(`
      <h2>Rates and markups</h2>
      <p class="small muted">Used for every client unless a job sets its own markup. Same rules as the estimates workbook.</p>
      <div class="grid2">
        <div class="field"><label for="sTax">Sales tax %</label><input id="sTax" type="number" step="0.1" value="${pctIn(s.tax)}"></div>
        <div class="field"><label for="sSur">Armstrong surcharge % (wholesale flowers)</label><input id="sSur" type="number" step="0.1" value="${pctIn(s.surcharge)}"></div>
        <div class="field"><label for="sMethod">Markup method</label><select id="sMethod"><option value="Multiply" ${s.method === "Multiply" ? "selected" : ""}>Multiply: cost × (1 + markup)</option><option value="Divide" ${s.method === "Divide" ? "selected" : ""}>Divide: cost ÷ (1 − markup)</option></select></div>
        <div class="field"><label for="sBag">Compost bag size (cu ft)</label><input id="sBag" type="number" step="0.1" value="${s.bag_cf}"></div>
        <div class="field"><label for="sPot">Soil per pot (cu ft)</label><input id="sPot" type="number" step="0.1" value="${s.soil_per_pot}"></div>
        <div class="field"><label for="sDepth">Soil depth for beds (inches)</label><input id="sDepth" type="number" step="0.5" value="${s.soil_depth_in}"></div>
      </div>
      <h3>Markups</h3>
      <div class="grid2">${Object.keys(s.markups).map((k) => `<div class="field"><label>${esc(k)} %</label><input type="number" step="1" data-mk="${esc(k)}" value="${pctIn(s.markups[k])}"></div>`).join("")}</div>
      <h3>Crew</h3>
      <p class="small muted">Our cost per hour, and what the client pays per hour (leave blank to use the labor markup).</p>
      <div class="table-wrap"><table class="fl-edit"><thead><tr><th>Name</th><th>Our cost / hr</th><th>Client rate / hr</th><th>QuickBooks item</th></tr></thead>
        <tbody id="crewRows">${s.crew.map((c) => crewRow(c)).join("")}${crewRow({})}</tbody></table></div>
      <div class="btn-row" style="justify-content:flex-end;margin-top:14px"><button type="button" class="secondary" data-close>Cancel</button><button type="button" id="sSave">Save</button></div>`);
    $("#sSave", m).onclick = async () => {
      const n = (id) => Number($(id, m).value);
      const next = { ...s, tax: n("#sTax") / 100, surcharge: n("#sSur") / 100, method: $("#sMethod", m).value, bag_cf: n("#sBag"), soil_per_pot: n("#sPot"), soil_depth_in: n("#sDepth"), markups: {} };
      $$("[data-mk]", m).forEach((i) => (next.markups[i.dataset.mk] = Number(i.value) / 100));
      next.crew = $$("#crewRows tr", m).map((tr) => {
        const v = (k) => $(`[data-c="${k}"]`, tr).value.trim();
        return { name: v("name"), cost: v("cost") === "" ? null : Number(v("cost")), rate: v("rate") === "" ? null : Number(v("rate")), qb_item: v("qb_item") || "Labor" };
      }).filter((c) => c.name);
      try { await S.saveSettings(next); state.settings = next; close(); route(); toast("Rates and markups saved."); } catch (e) { fail(e); }
    };
  }
  const crewRow = (c) => `<tr><td><input data-c="name" value="${esc(c.name || "")}" placeholder="Add someone"></td><td><input data-c="cost" type="number" step="0.01" value="${c.cost == null ? "" : c.cost}"></td><td><input data-c="rate" type="number" step="0.01" value="${c.rate == null ? "" : c.rate}"></td><td><input data-c="qb_item" value="${esc(c.qb_item || "")}" placeholder="Labor"></td></tr>`;

  // =====================================================================
  // Job page
  // =====================================================================
  // Columns of the editable tables. calc() returns computed cells.
  const PLANT_COLS = [
    { k: "plant", label: "Plant", w: 170 }, { k: "variety", label: "Variety", w: 140 }, { k: "color", label: "Color", w: 100 }, { k: "size", label: "Size", w: 70 },
    { k: "unit", label: "Sold by", type: "select", options: ["Flat", "Each"], w: 80 }, { k: "per_flat", label: "Per flat", type: "number", w: 64 },
    { k: "plants", label: "Plants needed", type: "number", w: 80 }, { k: "units", label: "Flats override", type: "number", w: 80, ph: "auto" },
    { k: "cost", label: "Cost per flat / each", type: "number", step: "0.01", w: 90 }, { k: "cost_basis", label: "Cost is", type: "select", options: ["Tax incl.", "Pre-tax"], w: 90 },
    { k: "qb_item", label: "Wholesale or retail", type: "select", options: ["Flowers - Wholesale", "Flowers - Retail"], w: 150 }, { k: "where", label: "Where", w: 130 },
  ];
  const PLANT_ACT = [{ k: "ordered", label: "Ordered", type: "number", w: 70 }, { k: "used", label: "Used", type: "number", w: 70 }];
  const LABOR_COLS = [{ k: "person", label: "Who", type: "crew", w: 150 }, { k: "task", label: "Task", w: 150 }, { k: "hours", label: "Bid hours", type: "number", step: "0.25", w: 80 },
    { k: "cost", label: "Our cost / hr", type: "number", step: "0.01", w: 90, ph: "from crew" }, { k: "rate", label: "Client rate / hr", type: "number", step: "0.01", w: 90, ph: "markup" },
    { k: "actual_hours", label: "Actual hours", type: "number", step: "0.25", w: 80 }];
  const MAT_COLS = [{ k: "item", label: "Item", type: "material", w: 200 }, { k: "qty", label: "Bid qty", type: "number", step: "0.5", w: 70 }, { k: "unit", label: "Unit", w: 70 },
    { k: "cost", label: "Our cost / unit", type: "number", step: "0.01", w: 90 }, { k: "category", label: "Markup", type: "select", options: ["Chemicals", "Other items", "Flowers - Wholesale", "Flowers - Retail"], w: 110 },
    { k: "qb_item", label: "QuickBooks item", type: "qb", w: 150 }, { k: "ordered", label: "Ordered", type: "number", w: 70 }, { k: "used", label: "Used", type: "number", w: 70 }];
  const LOC_COLS = [{ k: "name", label: "Bed or pot location", w: 200 }, { k: "type", label: "Type", type: "select", options: ["Bed", "Pot", "Planter"], w: 90 },
    { k: "exposure", label: "Exposure", w: 120 }, { k: "pots", label: "# of pots", type: "number", w: 70 }, { k: "sqft", label: "Bed sq ft", type: "number", w: 80 }];

  function cell(col, v) {
    const val = v == null ? "" : v;
    const attrs = `data-k="${col.k}" style="width:${col.w || 90}px"${col.ph ? ` placeholder="${esc(col.ph)}"` : ""}`;
    if (col.type === "select") return `<select ${attrs}>${col.options.map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    if (col.type === "crew") return `<input ${attrs} list="crewList" value="${esc(val)}">`;
    if (col.type === "material") return `<input ${attrs} list="matList" value="${esc(val)}">`;
    if (col.type === "qb") return `<input ${attrs} list="qbList" value="${esc(val)}">`;
    if (col.type === "number") return `<input ${attrs} type="number" inputmode="decimal" step="${col.step || "1"}" value="${esc(val)}">`;
    return `<input ${attrs} value="${esc(val)}">`;
  }
  function table(name, cols, rows, calcHead) {
    return `<div class="table-wrap"><table class="fl-edit" data-table="${name}">
      <thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}${calcHead.map((h) => `<th class="num">${esc(h)}</th>`).join("")}<th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-i="${i}">${cols.map((c) => `<td>${cell(c, r[c.k])}</td>`).join("")}${calcHead.map((h, ci) => `<td class="num calc" data-calc="${name}:${i}:${ci}"></td>`).join("")}
        <td><button type="button" class="ghost small" data-del aria-label="Remove line">✕</button></td></tr>`).join("")}</tbody></table></div>
      <button type="button" class="secondary small" data-add="${name}" style="margin-top:8px">+ Add a line</button>`;
  }

  function renderJob(id) {
    const job = state.jobs.find((j) => j.id === id);
    if (!job) { location.hash = ""; return; }
    state.season = job.season;
    const s = sett();
    $("#view").innerHTML = `
      <div class="page-head"><div><p class="eyebrow"><a href="#">← ${esc(job.season)}</a></p><h1>${esc(job.client_name || "New client")}</h1></div>
        <div class="btn-row"><span class="small muted" id="saveState">${job.updated_at ? "Saved" : ""}</span>
          <button type="button" class="secondary" id="dlJob">Download Excel</button><button type="button" class="danger" id="delJob">Remove</button></div></div>
      <div class="stat-row" id="jobStats"></div>
      <div class="card">
        <h2 style="margin-top:0">Job details</h2>
        <div class="grid4">
          <div class="field"><label>Client</label><input data-job="client_name" list="clientList" value="${esc(job.client_name)}"></div>
          <div class="field"><label>Job address</label><input data-job="address" value="${esc(job.address)}"></div>
          <div class="field"><label>Install date</label><input data-job="install_date" type="date" value="${esc(job.install_date)}"></div>
          <div class="field"><label>Status</label><select data-job="status">${C.STATUSES.map((x) => `<option ${x === job.status ? "selected" : ""}>${x}</option>`).join("")}</select></div>
          <div class="field"><label>QuickBooks estimate #</label><input data-job="qb_estimate" value="${esc(job.qb_estimate)}"></div>
          <div class="field"><label>Flowers markup % (this job)</label><input data-mk="Flowers - Wholesale" type="number" placeholder="${Math.round(s.markups["Flowers - Wholesale"] * 100)}" value="${job.markups && job.markups["Flowers - Wholesale"] != null ? Math.round(job.markups["Flowers - Wholesale"] * 1000) / 10 : ""}"></div>
          <div class="field" style="grid-column:span 2"><label>Notes</label><input data-job="notes" value="${esc(job.notes)}"></div>
        </div>
        <p class="small muted" id="jobWarn"></p>
      </div>
      <div class="card"><h2 style="margin-top:0">1. Plants</h2>
        <p class="small muted">Type how many plants each spot needs; flats are worked out (rounded up). Type a flats override to order a different number. After the job, fill in ordered and used to see leftovers and the actual cost.</p>
        ${table("plants", PLANT_COLS.concat(PLANT_ACT), job.plants, ["Flats / each", "Our cost", "Client price", "Left over"])}</div>
      <div class="card"><h2 style="margin-top:0">2. Beds and pots (for soil)</h2>
        <p class="small muted" id="soilNote"></p>
        ${table("locations", LOC_COLS, job.locations || [], [])}
        <button type="button" class="ghost small" id="addSoil" style="margin-top:8px">Put the compost bags in materials</button></div>
      <div class="card"><h2 style="margin-top:0">3. Labor</h2>${table("labor", LABOR_COLS, job.labor, ["Our cost", "Client price"])}</div>
      <div class="card"><h2 style="margin-top:0">4. Materials</h2>${table("materials", MAT_COLS, job.materials, ["Our cost", "Client price", "Left over"])}</div>
      <div class="card"><div class="btn-row" style="margin-bottom:8px"><h2 style="margin:0;flex:1">5. QuickBooks estimate</h2><button type="button" class="secondary small" id="copyQB">Copy lines</button></div>
        <p class="small muted">Enter these lines on the estimate in QuickBooks, in this order.</p><div id="qbLines"></div></div>
      <datalist id="crewList">${s.crew.map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist>
      <datalist id="matList">${state.materials.map((m) => `<option value="${esc(m.name)}">`).join("")}</datalist>
      <datalist id="qbList">${s.qb_items.map(([i]) => `<option value="${esc(i)}">`).join("")}</datalist>
      <datalist id="clientList">${state.clients.map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist>`;

    $$("[data-job]").forEach((el) => (el.onchange = () => {
      job[el.dataset.job] = el.value;
      if (el.dataset.job === "client_name") { job.client_id = matchClient(el.value); $("h1").textContent = el.value; }
      changed(job); recalc(job);
    }));
    $$("[data-mk]").forEach((el) => (el.onchange = () => { job.markups = job.markups || {}; job.markups[el.dataset.mk] = el.value === "" ? null : Number(el.value) / 100; changed(job); recalc(job); }));
    $$("table.fl-edit").forEach((t) => {
      const list = (job[t.dataset.table] = job[t.dataset.table] || []);
      $$("[data-k]", t).forEach((el) => (el.onchange = () => {
        const row = list[Number(el.closest("tr").dataset.i)];
        const k = el.dataset.k;
        row[k] = el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value;
        // Picking a material fills its unit and cost; picking a person fills nothing (rates come from the crew list)
        if (t.dataset.table === "materials" && k === "item") {
          const m = state.materials.find((x) => x.name.toLowerCase() === el.value.toLowerCase());
          if (m) { row.unit = row.unit || m.unit; if (row.cost == null) row.cost = m.cost != null ? Number(m.cost) : m.price != null ? Number(m.price) : null; return renderKeep(job); }
        }
        changed(job); recalc(job);
      }));
      $$("[data-del]", t).forEach((b) => (b.onclick = () => { list.splice(Number(b.closest("tr").dataset.i), 1); changed(job); renderKeep(job); }));
    });
    $$("[data-add]").forEach((b) => (b.onclick = () => {
      const name = b.dataset.add;
      const blank = { plants: { unit: "Flat", per_flat: 16, cost_basis: "Tax incl.", qb_item: "Flowers - Wholesale" }, labor: { hours: null }, materials: { qty: 1, category: "Other items", qb_item: "Other" }, locations: { type: "Bed" } }[name];
      (job[name] = job[name] || []).push({ ...blank });
      changed(job); renderKeep(job);
      const rows = $$(`[data-table="${name}"] tbody tr`);
      const last = rows[rows.length - 1];
      if (last) { const i = $("input", last); if (i) i.focus(); }
    }));
    $("#addSoil").onclick = () => {
      const sl = C.soil(job, s);
      if (!sl.bags) return toast("Add beds or pots first.", true);
      const mat = state.materials.find((m) => /compost/i.test(m.name));
      const existing = (job.materials || []).find((m) => /compost/i.test(m.item));
      if (existing) existing.qty = sl.bags;
      else job.materials.push({ item: mat ? mat.name : "Omni Seed Cover / Compost", unit: "bag", qty: sl.bags, cost: mat ? Number(mat.cost != null ? mat.cost : mat.price) : null, category: "Other items", qb_item: "Compost" });
      changed(job); renderKeep(job); toast(`${sl.bags} bags of compost in materials.`);
    };
    $("#copyQB").onclick = async () => {
      const t = C.jobTotals(job, state.settings);
      const text = t.qbLines.map((q) => [q.item, q.desc, q.qty, q.rate.toFixed(2), q.amount.toFixed(2)].join("\t")).join("\n");
      try { await navigator.clipboard.writeText(text); toast("Copied. Paste into a spreadsheet or keep it open next to QuickBooks."); } catch (e) { toast("Couldn't copy. Select the table instead.", true); }
    };
    $("#dlJob").onclick = () => downloadSeason([job]).catch(fail);
    $("#delJob").onclick = async () => {
      if (!confirm(`Remove ${job.client_name || "this client"} from ${job.season}?`)) return;
      try { await S.remove(job.id); state.jobs = state.jobs.filter((j) => j !== job); state.dirty.delete(job.id); location.hash = ""; } catch (e) { fail(e); }
    };
    recalc(job);
  }
  // Re-draw the job page but keep the scroll position (after adding or removing lines)
  function renderKeep(job) { const y = window.scrollY; renderJob(job.id); window.scrollTo(0, y); }

  // Update the computed cells and totals without re-drawing the inputs
  function recalc(job) {
    const t = C.jobTotals(job, state.settings);
    const setCalc = (name, i, ci, v) => { const el = $(`[data-calc="${name}:${i}:${ci}"]`); if (el) el.innerHTML = v; };
    t.plants.forEach((x, i) => {
      setCalc("plants", i, 0, `${x.c.units}${x.p.unit === "Each" ? "" : ` <span class="muted">(${x.c.bidPlants} plants)</span>`}`);
      setCalc("plants", i, 1, money(x.c.cost)); setCalc("plants", i, 2, money(x.c.price));
      setCalc("plants", i, 3, x.c.leftover == null ? "" : String(x.c.leftover));
    });
    t.labor.forEach((x, i) => { setCalc("labor", i, 0, money(x.c.cost)); setCalc("labor", i, 1, money(x.c.price)); });
    t.materials.forEach((x, i) => { setCalc("materials", i, 0, money(x.c.cost)); setCalc("materials", i, 1, money(x.c.price)); setCalc("materials", i, 2, x.c.leftover == null ? "" : String(x.c.leftover)); });
    $("#jobStats").innerHTML = `
      <div class="stat"><div class="label">Flats</div><div class="num">${t.flats}</div></div>
      <div class="stat"><div class="label">Plants</div><div class="num">${t.plantCount}</div></div>
      <div class="stat"><div class="label">Labor hours</div><div class="num">${t.hours}</div></div>
      <div class="stat"><div class="label">Our cost</div><div class="num">${money0(t.cost)}</div></div>
      <div class="stat"><div class="label">Client price</div><div class="num">${money0(t.price)}</div></div>
      <div class="stat"><div class="label">Profit</div><div class="num">${money0(t.profit)} <span class="small muted">${pct(t.margin)}</span></div></div>
      ${t.actualCost != null ? `<div class="stat"><div class="label">Actual cost so far</div><div class="num">${money0(t.actualCost)}</div></div>` : ""}`;
    $("#jobWarn").textContent = t.warnings.length ? "To fill in: " + t.warnings.join("; ") + "." : "";
    $("#soilNote").textContent = t.soil.cf ? `About ${t.soil.cf} cu ft of soil: ${t.soil.bags} bags of ${t.S.bag_cf} cu ft.` : "Add each bed (square feet) and pot so the app can work out compost bags.";
    $("#qbLines").innerHTML = t.qbLines.length ? `<div class="table-wrap"><table><thead><tr><th>Product / service</th><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th><th class="num">Our cost</th></tr></thead>
      <tbody>${t.qbLines.map((q) => `<tr><td>${esc(q.item)}</td><td>${esc(q.desc)}</td><td class="num">${q.qty}</td><td class="num">${money(q.rate)}</td><td class="num">${money(q.amount)}</td><td class="num muted">${money(q.cost)}</td></tr>`).join("")}
      <tr><td colspan="4"><strong>Estimate total</strong></td><td class="num"><strong>${money(t.price)}</strong></td><td class="num muted">${money(t.cost)}</td></tr></tbody></table></div>` : `<p class="muted">Add plants, labor or materials.</p>`;
  }

  // =====================================================================
  // Order list (season tally)
  // =====================================================================
  function renderOrder() {
    const jobs = seasonJobs();
    const T = C.seasonTally(jobs, state.settings);
    const short = (n) => esc(String(n).split(/[ ,]/)[0]);
    $("#view").innerHTML = `
      <div class="page-head"><div><p class="eyebrow"><a href="#">← ${esc(state.season)}</a></p><h1>Order list</h1></div>
        <div class="btn-row"><button type="button" class="secondary" id="dlOrder">Download Excel</button></div></div>
      <div class="card"><h2 style="margin-top:0">Plants · ${T.plants.reduce((a, p) => a + (p.per > 1 ? p.units : 0), 0)} flats</h2>
        <div class="table-wrap"><table class="fl-order"><thead><tr><th>Plant</th><th>Variety</th><th>Color</th><th>Unit</th>${T.clients.map((c) => `<th class="num">${short(c)}</th>`).join("")}<th class="num">Total</th><th class="num">Plants</th><th class="num">Est. cost</th></tr></thead>
        <tbody>${T.plants.map((p) => `<tr><td>${esc(p.plant)}</td><td>${esc(p.variety)}</td><td>${esc(p.color)}</td><td class="small">${esc(p.unit)}</td>${T.clients.map((c) => `<td class="num">${p.by[c] || ""}</td>`).join("")}<td class="num"><strong>${p.units}</strong></td><td class="num">${p.plants}</td><td class="num">${money(p.cost)}</td></tr>`).join("")}</tbody></table></div></div>
      <div class="card"><h2 style="margin-top:0">Materials</h2>
        <div class="table-wrap"><table class="fl-order"><thead><tr><th>Item</th><th>Unit</th>${T.clients.map((c) => `<th class="num">${short(c)}</th>`).join("")}<th class="num">Total</th><th class="num">Est. cost</th></tr></thead>
        <tbody>${T.materials.map((m) => `<tr><td>${esc(m.item)}</td><td>${esc(m.unit)}</td>${T.clients.map((c) => `<td class="num">${m.by[c] || ""}</td>`).join("")}<td class="num"><strong>${Math.round(m.qty * 100) / 100}</strong></td><td class="num">${money(m.cost)}</td></tr>`).join("")}</tbody></table></div></div>`;
    $("#dlOrder").onclick = () => downloadSeason().catch(fail);
  }

  // =====================================================================
  // Branded Excel: summary, order list, materials, one tab per client
  // =====================================================================
  async function logoB64() {
    const buf = await (await fetch("assets/logo.png")).arrayBuffer();
    let bin = "";
    new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }
  async function downloadSeason(onlyJobs) {
    await loadScript("vendor/exceljs.min.js");
    const jobs = onlyJobs || seasonJobs();
    const wb = new window.ExcelJS.Workbook();
    wb.creator = "Harmony Horticulture";
    const logo = wb.addImage({ base64: await logoB64(), extension: "png" });
    const F = "Montserrat", BROWN = "FF5F351B", PINK = "FFF065A5", GREEN = "FF009344", PANEL = "FFF2F2F2";
    const used = new Set();
    function sheet(name, title, sub, cols, rows, totals) {
      let n = String(name).replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31), k = 2;
      while (used.has(n.toLowerCase())) n = String(name).slice(0, 27) + ` (${k++})`;
      used.add(n.toLowerCase());
      const ws = wb.addWorksheet(n, { views: [{ state: "frozen", ySplit: 6, showGridLines: false }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        headerFooter: { oddFooter: '&L&"Montserrat"&8Harmony Horticulture&R&"Montserrat"&8Page &P of &N' } });
      ws.columns = cols.map((c) => ({ width: c.w }));
      ws.addImage(logo, { tl: { col: 0.15, row: 0.15 }, ext: { width: 131, height: 96 } });
      for (let i = 1; i <= 5; i++) ws.getRow(i).height = i === 5 ? 12 : 21;
      const tc = cols.length > 2 ? 3 : 2;
      Object.assign(ws.getCell(2, tc), { value: title.toUpperCase(), font: { name: F, size: 16, color: { argb: BROWN } } });
      Object.assign(ws.getCell(3, tc), { value: sub.toUpperCase(), font: { name: F, size: 9, bold: true, color: { argb: PINK } } });
      Object.assign(ws.getCell(4, tc), { value: `Prepared ${new Date().toLocaleDateString("en-US")}`, font: { name: F, size: 8, color: { argb: "FF595959" } } });
      const h = ws.getRow(6);
      cols.forEach((c, i) => Object.assign(h.getCell(i + 1), { value: c.h, font: { name: F, size: 10, bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: BROWN } }, alignment: { vertical: "middle", wrapText: true, horizontal: c.money || c.n ? "right" : "left" } }));
      h.height = 30;
      const all = totals ? rows.concat([Object.assign(totals, { total: true })]) : rows;
      all.forEach((row, ri) => {
        const xr = ws.getRow(7 + ri);
        cols.forEach((c, i) => {
          const cell = xr.getCell(i + 1);
          cell.value = row[i] === undefined || row[i] === "" ? null : row[i];
          cell.font = { name: F, size: 10, bold: !!row.total, color: { argb: row.total ? BROWN : "FF1A1A1A" } };
          cell.alignment = { vertical: "top", wrapText: !!c.wrap, horizontal: c.money || c.n ? "right" : "left" };
          if (c.money) cell.numFmt = '"$"#,##0.00';
          if (c.date) cell.numFmt = "mm/dd/yyyy";
          if (!row.total && ri % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PANEL } };
          if (row.total) cell.border = { top: { style: "medium", color: { argb: GREEN } } };
        });
      });
      return ws;
    }
    const season = jobs[0] ? jobs[0].season : state.season;
    const d = (iso) => (iso ? new Date(iso + "T12:00:00") : null);
    const tot = jobs.map((j) => ({ j, t: C.jobTotals(j, state.settings) }));
    const sum = (f) => tot.reduce((a, x) => a + (f(x) || 0), 0);
    if (!onlyJobs) {
      sheet("Summary", `${season} flowers`, `${jobs.length} clients`, [{ h: "Client", w: 26 }, { h: "Install date", w: 13, date: true }, { h: "Status", w: 14 }, { h: "QuickBooks est. #", w: 14 }, { h: "Flats", w: 8, n: true },
        { h: "Plants", w: 9, n: true }, { h: "Labor hours", w: 10, n: true }, { h: "Our cost", w: 13, money: true }, { h: "Client price", w: 13, money: true }, { h: "Profit", w: 13, money: true }, { h: "Actual cost", w: 13, money: true }],
        tot.map(({ j, t }) => [j.client_name, d(j.install_date), j.status, j.qb_estimate, t.flats, t.plantCount, t.hours, t.cost, t.price, t.profit, t.actualCost]),
        ["Total", null, "", "", sum((x) => x.t.flats), sum((x) => x.t.plantCount), sum((x) => x.t.hours), sum((x) => x.t.cost), sum((x) => x.t.price), sum((x) => x.t.profit), null]);
      const T = C.seasonTally(jobs, state.settings);
      sheet("Order list", "Plant order list", season, [{ h: "Plant", w: 24, wrap: true }, { h: "Variety", w: 20, wrap: true }, { h: "Color", w: 14 }, { h: "Unit", w: 16 },
        ...T.clients.map((c) => ({ h: c, w: 10, n: true })), { h: "Total", w: 9, n: true }, { h: "Plants", w: 9, n: true }, { h: "Est. cost", w: 12, money: true }],
        T.plants.map((p) => [p.plant, p.variety, p.color, p.unit, ...T.clients.map((c) => p.by[c] || null), p.units, p.plants, p.cost]));
      sheet("Materials", "Materials order list", season, [{ h: "Item", w: 30, wrap: true }, { h: "Unit", w: 10 }, ...T.clients.map((c) => ({ h: c, w: 10, n: true })), { h: "Total", w: 9, n: true }, { h: "Est. cost", w: 12, money: true }],
        T.materials.map((m) => [m.item, m.unit, ...T.clients.map((c) => m.by[c] || null), Math.round(m.qty * 100) / 100, m.cost]));
    }
    tot.forEach(({ j, t }) => {
      const sub = `${season}${j.install_date ? " · install " + nice(j.install_date) : ""}${j.address ? " · " + j.address : ""}`;
      const ws = sheet(j.client_name || "Client", `${j.client_name} estimate`, sub, [{ h: "Section", w: 12 }, { h: "Item", w: 28, wrap: true }, { h: "Detail", w: 26, wrap: true }, { h: "Qty", w: 9, n: true }, { h: "Unit", w: 14 },
        { h: "Our cost", w: 12, money: true }, { h: "Client price", w: 12, money: true }, { h: "Ordered", w: 9, n: true }, { h: "Used", w: 9, n: true }],
        [...t.plants.map((x) => ["Plants", [x.p.plant, x.p.variety].filter(Boolean).join(" "), [x.p.color, x.p.size, x.p.where].filter(Boolean).join(" · "), x.c.units, x.p.unit === "Each" ? "each" : `flat of ${x.p.per_flat}`, x.c.cost, x.c.price, x.p.ordered, x.p.used]),
          ...t.labor.map((x) => ["Labor", x.l.person, x.l.task, x.c.hours, "hours", x.c.cost, x.c.price, x.l.actual_hours, null]),
          ...t.materials.map((x) => ["Materials", x.m.item, x.m.notes || "", x.m.qty, x.m.unit, x.c.cost, x.c.price, x.m.ordered, x.m.used]),
          [], ["QuickBooks", "Product / service", "Description", "Qty", "Rate", "Our cost", "Amount"],
          ...t.qbLines.map((q) => ["", q.item, q.desc, q.qty, q.rate, q.cost, q.amount])],
        ["Total", "", "", null, "", t.cost, t.price]);
      ws.getColumn(5).numFmt = "General";
    });
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = onlyJobs ? `${onlyJobs[0].client_name} - ${season} Flowers Estimate.xlsx` : `Harmony Horticulture ${season} Flowers.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  start();
})();
