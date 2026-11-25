// =====================================================================
// Harmony Horticulture SOPs: the library of standard operating
// procedures, open to everyone signed in (consultants, technicians and
// admins).
//
// Each SOP is written and edited right here (js/sop-doc.js draws it in
// the branded SOP layout and makes the PDF and Word files). Admins edit
// and save; saving records the revised date, who made the change and a
// new version in the Revision History, keeps the old version, and saves
// the new Word file and PDF to the Google Drive SOP folder
// (integrations/sop-drive.gs).
// An SOP can also be just an uploaded PDF, for documents made elsewhere.
// Uses the same login and database as the Report Builder and Time Tracker
// (tables and rules: supabase/07_sops.sql and 08_sop_editing.sql).
// =====================================================================
(function () {
  const cfg = window.HH_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const LIVE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) && !params.has("demo");
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TT = cfg.TIME_TRACKER_URL || "https://harmony-horticulture.github.io/time-tracker/";
  const D = window.SopDoc;

  // Categories offered for an SOP. Admins can type a new one too.
  const CATEGORIES = ["Field work", "Office and accounting", "Apps and tools"];
  const PDF = "application/pdf";
  const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const safeName = (s) => String(s || "file").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 80);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pad2 = (n) => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`; };

  // -------------------------------------------------------------------
  // Data: Supabase when connected, otherwise a demo copy in this browser
  // -------------------------------------------------------------------
  function liveStore() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const ok = (res) => { if (res.error) throw new Error(friendly(res.error)); return res.data; };
    return {
      mode: "live",
      async me() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return null;
        return ok(await sb.from("profiles").select("id, email, full_name, role, active").eq("id", data.session.user.id).single());
      },
      async token() { const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : ""; },
      async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
      async signOut() { await sb.auth.signOut(); },
      async list() { return ok(await sb.from("sops").select("*").order("title")); },
      async get(id) { return ok(await sb.from("sops").select("*").eq("id", id).single()); },
      async versions(id) { return ok(await sb.from("sop_versions").select("*").eq("sop_id", id).order("replaced_at", { ascending: false })); },
      async file(path) {
        const { data, error } = await sb.storage.from("sops").download(path);
        if (error) throw new Error("That file couldn't be opened. " + friendly(error));
        return data;
      },
      async upload(sopId, file, type) {
        const path = `${sopId}/${Date.now()}-${safeName(file.name)}`;
        ok(await sb.storage.from("sops").upload(path, file, { contentType: type, upsert: false }));
        return path;
      },
      async insert(row) { return ok(await sb.from("sops").insert(row).select("*").single()); },
      async update(id, patch) { return ok(await sb.from("sops").update(patch).eq("id", id).select("*").single()); },
      async addVersion(row) { ok(await sb.from("sop_versions").insert(row)); },
      async settings() {
        const res = await sb.from("report_settings").select("sop_drive_url").eq("id", 1).maybeSingle();
        return res.error ? {} : res.data || {};
      },
      async saveSettings(patch) { ok(await sb.from("report_settings").update(patch).eq("id", 1)); },
    };
  }

  function demoStore() {
    const KEY = "hh-sops-demo-v2";
    const files = new Map(); // uploaded in demo mode: kept until the page is reloaded
    const day = 864e5;
    const at = (n) => new Date(Date.now() - n * day).toISOString();
    // Sample content only: the real SOPs live in the database, not in this code
    const sample = (title, subtitle, num, version, purpose) => {
      const c = D.blank("Krista O'Malley, Accounting");
      c.title = title.toUpperCase(); c.subtitle = subtitle.toUpperCase();
      Object.assign(c.meta, { sop_number: num, version, effective_date: "11/20/2026", applies_to: "Everyone named in this SOP" });
      c.sections[0].blocks[0].text = purpose + " This is sample text so you can try the editor in demo mode.";
      c.sections[1].blocks[1].items = ["The main steps, in order", "Who does each one, and when"];
      c.sections[1].blocks[3].items = ["Anything covered by another SOP"];
      c.sections[2].blocks[0].rows = [["**Admin**", "Keeps this SOP current and answers questions."], ["**Consultant**", "Follows the steps below."]];
      c.sections[6].blocks[1].rows = [["1", "Open the app and sign in.", "You", "Same email and password in both apps."], ["2", "Do the next step.", "You", "Within one business day."]];
      c.revisions = [{ version: "1.0", date: "11/18/2026", change: "Initial draft", changed_by: "Krista", approved_by: "Kasey" }];
      return c;
    };
    const seed = () => [
      { id: "s1", category: "Field work", audience: "everyone", content: sample("Flower Planting Season", "Who does what, from estimate to final walk-through", "HH-SOP-001", "1.1", "How the team plans, orders, installs and follows up on seasonal flower plantings.") },
      { id: "s2", category: "Office and accounting", audience: "everyone", content: sample("Receipts Submission", "Every receipt in within 24 hours", "HH-SOP-002", "1.0", "How and when to send in receipts for company card purchases.") },
      { id: "s3", category: "Apps and tools", audience: "admins", content: sample("App Administration", "Invite the team and keep our lists clean", "HH-SOP-003", "1.0", "Inviting people, roles, lists and QuickBooks files in the apps.") },
      { id: "s4", category: "Apps and tools", audience: "everyone", content: sample("Time Tracking and Client Reports", "Log every hour the same day", "HH-SOP-004", "1.1", "Logging billable time every day, and writing and sending client reports.") },
      { id: "s5", category: "Field work", audience: "everyone", content: sample("Treatment Approval", "No treatment is scheduled until it is approved", "HH-SOP-005", "1.0", "Getting client approval before any treatment is applied.") },
    ].map((s) => ({ ...s, title: D.titleCase(s.content.title), sop_number: s.content.meta.sop_number, version: s.content.meta.version, summary: "",
      pdf_path: null, word_path: null, drive_url: "", search_text: "", archived: false, updated_at: at(5), updated_by_name: "Krista", created_at: at(7), drive_synced_at: null }));
    let data;
    try { data = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { data = null; }
    if (!data) data = { sops: seed(), versions: [], settings: {} };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode */ } };
    save();
    const as = params.get("as") === "consultant" ? "consultant" : "admin";
    return {
      mode: "demo",
      as,
      async me() { return { id: "demo", email: "demo@harmonyhorticulture.com", full_name: as === "admin" ? "Demo Admin" : "Demo Consultant", role: as, active: true }; },
      async token() { return ""; },
      async signIn() {},
      async signOut() {},
      async list() {
        const rows = clone(data.sops).sort((a, b) => a.title.localeCompare(b.title));
        return as === "admin" ? rows : rows.filter((s) => s.audience === "everyone" && !s.archived);
      },
      async get(id) { return clone(data.sops.find((s) => s.id === id)); },
      async versions(id) { return clone(data.versions.filter((v) => v.sop_id === id).sort((a, b) => b.replaced_at.localeCompare(a.replaced_at))); },
      async file(path) {
        if (files.has(path)) return files.get(path);
        throw new Error("In demo mode, files you upload are only kept until the page is reloaded.");
      },
      async upload(sopId, file) { const path = `${sopId}/${Date.now()}-${safeName(file.name)}`; files.set(path, file); return path; },
      async insert(row) { const r = { id: uid(), ...clone(row), created_at: new Date().toISOString(), archived: false }; data.sops.push(r); save(); return clone(r); },
      async update(id, patch) { const r = data.sops.find((s) => s.id === id); Object.assign(r, clone(patch)); save(); return clone(r); },
      async addVersion(row) { data.versions.push({ ...clone(row), id: uid(), replaced_at: new Date().toISOString() }); save(); },
      async settings() { return clone(data.settings || {}); },
      async saveSettings(patch) { data.settings = { ...(data.settings || {}), ...patch }; save(); },
    };
  }

  function friendly(err) {
    const msg = (err && (err.message || String(err))) || "Something went wrong.";
    if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
    if (/Invalid login credentials/i.test(msg)) return "That email and password don't match.";
    if (/column .*content.* does not exist|sop_drive_url/i.test(msg)) return "SOP editing isn't set up in Supabase yet. Run supabase/08_sop_editing.sql.";
    if (/relation .*sop.* does not exist|Could not find the table|Bucket not found/i.test(msg)) return "The SOP library isn't set up in Supabase yet. Run supabase/07_sops.sql.";
    if (/Failed to fetch|NetworkError/i.test(msg)) return "Can't reach the server. Check your connection and try again.";
    return msg;
  }

  const S = LIVE ? liveStore() : demoStore();
  const state = { me: null, sops: [], settings: {}, q: "", cat: "", showArchived: false, editing: null, dirty: false };
  try { const f = JSON.parse(sessionStorage.getItem("hh-sops-filters") || "{}"); state.q = f.q || ""; state.cat = f.cat || ""; } catch (e) { /* ignore */ }
  const keepFilters = () => { try { sessionStorage.setItem("hh-sops-filters", JSON.stringify({ q: state.q, cat: state.cat })); } catch (e) { /* ignore */ } };
  const isAdmin = () => state.me && state.me.role === "admin";
  const myName = () => (state.me && (state.me.full_name || state.me.email)) || "";
  const q = S.mode === "demo" ? "?demo" + (S.as === "consultant" ? "&as=consultant" : "") : "";

  // --- small UI helpers ------------------------------------------------
  let toastTimer;
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), isError ? 7000 : 3200);
  }
  const fail = (e) => { console.error(e); toast(friendly(e), true); };
  function modal(html, onClose) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-back"><div class="modal wide" role="dialog" aria-modal="true">${html}</div></div>`;
    const m = $(".modal", root);
    const close = () => { if ($(".modal", root) !== m) return; root.innerHTML = ""; if (onClose) onClose(); };
    $(".modal-back", root).addEventListener("click", (e) => { if (e.target.classList.contains("modal-back")) close(); });
    return { m, close };
  }
  const niceDate = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  };
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) loaded[src] = new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load " + src)); document.head.appendChild(s); });
    return loaded[src];
  }
  async function pdfjs() {
    await loadScript("vendor/pdfjs/pdf.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
    return window.pdfjsLib;
  }
  const makePdf = async (c) => { await loadScript("vendor/jspdf.umd.min.js"); return D.pdf(c); };
  const makeDocx = async (c) => { await loadScript("vendor/docx.umd.js"); return D.docx(c); };
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const fileName = (s, ext) => (s.content ? D.fileBase(s.content) : `Harmony Horticulture SOP - ${String(s.title).replace(/[\\/:*?"<>|]+/g, "")}`) + `.${ext}`;
  const audienceBadge = (s) => (s.audience === "admins" ? `<span class="sop-badge admins">Admins only</span>` : "");
  function blobB64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  }
  // Everything an SOP says, so search can find it by its words
  function contentText(c) {
    if (!c) return "";
    const parts = [c.title, c.subtitle, ...Object.values(c.meta || {})];
    (c.sections || []).forEach((s) => { parts.push(s.title); (s.blocks || []).forEach((b) => {
      if (b.text) parts.push(b.text);
      (b.items || []).forEach((i) => parts.push(i));
      (b.head || []).forEach((i) => parts.push(i));
      (b.rows || []).forEach((r) => r.forEach((x) => parts.push(x)));
    }); });
    return D.plain(parts.filter(Boolean).join("\n")).slice(0, 200000);
  }
  // "1.1 (draft)" -> "1.2 (draft)"
  function nextVersion(v) {
    const m = String(v || "").match(/^(\d+)\.(\d+)(.*)$/);
    if (m) return `${m[1]}.${Number(m[2]) + 1}${m[3]}`;
    const n = String(v || "").match(/^(\d+)(.*)$/);
    return n ? `${n[1]}.1${n[2]}` : "1.0";
  }
  const lastRev = (s) => (s.content && (s.content.revisions || []).slice(-1)[0]) || null;

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
    $("#whoName").textContent = myName();
    $("#whoRole").textContent = { admin: "Admin", technician: "Technician" }[state.me.role] || "Consultant";
    if (S.mode === "demo") {
      const other = S.as === "admin" ? "consultant" : "admin";
      $("#demoBanner").innerHTML = `Demo mode: sample SOPs in this browser only. Seeing it as ${S.as === "admin" ? "an admin" : "a consultant"}. <a href="sops.html?demo${other === "consultant" ? "&as=consultant" : ""}" style="color:#fff">See it as ${other === "admin" ? "an admin" : "a consultant"}</a>`;
      $("#demoBanner").classList.remove("hidden");
    }
    const tt = esc(TT);
    const admin = isAdmin();
    $("#sideNav").innerHTML = (admin ? `<a class="nav-link" href="dashboard.html${q}">Dashboard</a><a class="nav-link" href="leads.html${q}">Leads</a>` : "")
      + `<a class="nav-link" href="index.html${q}">Reports</a>
      <button type="button" class="active" data-home>SOPs</button>
      ${admin ? `<button type="button" data-add>+ Add an SOP</button>` : ""}
      <div class="nav-label">Apps</div>
      <a class="nav-link" href="${tt}">Time tracker ↗</a>`;
    $("#bottomNav").innerHTML = (admin ? `<a class="nav-link" href="dashboard.html${q}">Home</a>` : "")
      + `<a class="nav-link" href="index.html${q}">Reports</a><button type="button" class="active" data-home>SOPs</button><a class="nav-link" href="${tt}">Time</a>`;
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
      if (isAdmin()) state.settings = await S.settings().catch(() => ({}));
      await route();
    } catch (e) {
      $("#loading").classList.add("hidden");
      showAuth(friendly(e));
    }
  }

  // Unsaved edits: ask before leaving
  window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });
  let lastHash = location.hash;
  async function route() {
    if (state.dirty && location.hash !== lastHash) {
      if (!confirm("Leave without saving your changes?")) { history.replaceState(null, "", lastHash || location.pathname + location.search); return; }
      state.dirty = false;
    }
    lastHash = location.hash;
    const m = location.hash.match(/sop=([\w-]+)/);
    window.scrollTo(0, 0);
    try {
      state.sops = await S.list();
      if (m && /[&?]edit/.test(location.hash) && isAdmin()) return renderEditor(m[1]);
      if (m) return await renderSop(m[1]);
      return renderList();
    } catch (e) { fail(e); $("#view").innerHTML = `<div class="card"><p>${esc(friendly(e))}</p></div>`; }
  }
  window.addEventListener("hashchange", route);

  // =====================================================================
  // The library
  // =====================================================================
  const norm = (s) => String(s || "").toLowerCase();
  function snippet(text, words) {
    const t = String(text || "").replace(/\s+/g, " ");
    const i = norm(t).indexOf(words[0]);
    if (i < 0) return "";
    const from = Math.max(0, i - 60), to = Math.min(t.length, i + 120);
    let out = esc((from ? "…" : "") + t.slice(from, to) + (to < t.length ? "…" : ""));
    words.forEach((w) => { out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (x) => `<mark>${x}</mark>`); });
    return out;
  }
  function categories() {
    const seen = new Set(CATEGORIES);
    state.sops.forEach((s) => s.category && seen.add(s.category));
    return [...seen];
  }
  const subtitleOf = (s) => (s.content && s.content.subtitle) || s.summary || "";

  function renderList() {
    const admin = isAdmin();
    const cats = categories().filter((c) => state.sops.some((s) => s.category === c && (!s.archived || state.showArchived)));
    const driveOn = !!state.settings.sop_drive_url;
    $("#view").innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">Standard operating procedures</p><h1>SOPs</h1></div>
        ${admin ? `<div class="btn-row"><button type="button" class="secondary" id="driveBtn">${driveOn ? "Google Drive: on" : "Set up Google Drive"}</button><button type="button" id="addBtn">+ Add an SOP</button></div>` : ""}
      </div>
      <div class="sop-search">
        <input id="sopQ" type="search" placeholder="Search SOPs, including the words inside them" value="${esc(state.q)}" aria-label="Search SOPs">
      </div>
      <div class="sop-chips" role="group" aria-label="Category">
        <button type="button" class="chip ${state.cat ? "" : "on"}" data-cat="">All</button>
        ${cats.map((c) => `<button type="button" class="chip ${state.cat === c ? "on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
      </div>
      <div id="sopResults"></div>
      ${admin && state.sops.some((s) => s.archived) ? `<p class="small" style="margin-top:18px"><label class="check"><input type="checkbox" id="showArch" ${state.showArchived ? "checked" : ""}> Show archived SOPs</label></p>` : ""}`;
    if (admin) { $("#addBtn").onclick = () => openAdd(); $("#driveBtn").onclick = () => openDriveSetup(); }
    const input = $("#sopQ");
    input.oninput = () => { state.q = input.value; keepFilters(); drawResults(); };
    $$("[data-cat]").forEach((b) => (b.onclick = () => {
      state.cat = b.dataset.cat; keepFilters();
      $$("[data-cat]").forEach((x) => x.classList.toggle("on", x === b));
      drawResults();
    }));
    const arch = $("#showArch");
    if (arch) arch.onchange = () => { state.showArchived = arch.checked; renderList(); };
    drawResults();
  }

  function drawResults() {
    const words = norm(state.q).split(/\s+/).filter(Boolean);
    const rows = state.sops.filter((s) => {
      if (s.archived && !state.showArchived) return false;
      if (state.cat && s.category !== state.cat) return false;
      if (!words.length) return true;
      const hay = norm([s.title, s.sop_number, s.category, subtitleOf(s), s.search_text].join(" "));
      return words.every((w) => hay.includes(w));
    });
    const host = $("#sopResults");
    if (!state.sops.length) {
      host.innerHTML = `<div class="card sop-empty"><h2>No SOPs yet</h2><p class="muted">${isAdmin() ? "Add the first one with <b>+ Add an SOP</b>." : "Your admin hasn't added any SOPs yet."}</p></div>`;
      return;
    }
    if (!rows.length) { host.innerHTML = `<div class="card sop-empty"><p class="muted">No SOPs match "${esc(state.q)}". Try fewer or different words.</p></div>`; return; }
    const groups = categories().map((c) => [c, rows.filter((s) => s.category === c)]).filter(([, list]) => list.length);
    host.innerHTML = groups.map(([c, list]) => `
      <h2 class="sop-group">${esc(c)}</h2>
      <div class="sop-grid">
        ${list.map((s) => {
          const inBody = words.length && !words.every((w) => norm([s.title, s.sop_number, s.category, subtitleOf(s)].join(" ")).includes(w));
          return `<a class="sop-card ${s.archived ? "archived" : ""}" href="#sop=${esc(s.id)}">
            <div class="sop-card-top"><span class="sop-num">${esc(s.sop_number || "SOP")}</span>${audienceBadge(s)}${s.archived ? `<span class="sop-badge">Archived</span>` : ""}</div>
            <div class="sop-title">${esc(s.title)}</div>
            ${inBody ? `<div class="sop-snip">${snippet(s.search_text, words)}</div>` : subtitleOf(s) ? `<div class="sop-sum">${esc(subtitleOf(s))}</div>` : ""}
            <div class="sop-meta">${s.version ? `Version ${esc(s.version)} · ` : ""}Revised ${esc(niceDate(s.updated_at))}${s.updated_by_name ? ` by ${esc(s.updated_by_name)}` : ""}</div>
          </a>`;
        }).join("")}
      </div>`).join("");
  }

  // =====================================================================
  // One SOP: read it in the app, download it
  // =====================================================================
  let renderToken = 0;
  async function renderSop(id) {
    const s = state.sops.find((x) => x.id === id);
    if (!s) {
      $("#view").innerHTML = `<div class="card"><h2>SOP not found</h2><p class="muted">It may have been archived or isn't open to your role.</p><p><a href="#">Back to all SOPs</a></p></div>`;
      return;
    }
    const admin = isAdmin();
    const rev = lastRev(s);
    $("#view").innerHTML = `
      <p class="small"><a href="#" class="back-link">← All SOPs</a></p>
      <div class="card sop-head">
        <div class="sop-head-row">
          <div>
            <p class="eyebrow">${esc(s.category)} ${audienceBadge(s)}${s.archived ? `<span class="sop-badge">Archived</span>` : ""}</p>
            <p class="sop-meta">${[s.sop_number, s.version ? "Version " + s.version : ""].filter(Boolean).map(esc).join(" · ")}<br>
              Revised ${esc(niceDate(s.updated_at))}${s.updated_by_name ? ` by ${esc(s.updated_by_name)}` : ""}${rev && rev.change ? `: ${esc(rev.change)}` : ""}</p>
          </div>
          <div class="btn-row">
            ${admin && s.content ? `<button type="button" id="editBtn">Edit</button>` : ""}
            <button type="button" class="${admin && s.content ? "secondary" : ""}" id="dlPdf">Download PDF</button>
            ${admin && (s.content || s.word_path) ? `<button type="button" class="secondary" id="dlWord">Word file</button>` : ""}
            ${admin ? `<button type="button" class="secondary" id="moreBtn">${s.content ? "Settings" : "Update"}</button>` : ""}
          </div>
        </div>
        ${admin ? `<div class="sop-drive-line small muted" id="driveLine">${driveLine(s)}</div>` : ""}
        ${admin ? `<div id="pastVersions" class="sop-versions"></div>` : ""}
      </div>
      <div id="pages" class="sop-pages" aria-label="${esc(s.title)}">${s.content ? `<div class="sop-paper">${D.html(s.content)}</div>` : `<p class="muted sop-loading">Opening the SOP…</p>`}</div>`;
    $("#dlPdf").onclick = async () => { try { download(s.content ? await makePdf(s.content) : await S.file(s.pdf_path), fileName(s, "pdf")); } catch (e) { fail(e); } };
    if ($("#dlWord")) $("#dlWord").onclick = async () => { try { download(s.content ? await makeDocx(s.content) : await S.file(s.word_path), fileName(s, "docx")); } catch (e) { fail(e); } };
    if ($("#editBtn")) $("#editBtn").onclick = () => { location.hash = `sop=${s.id}&edit`; };
    if ($("#moreBtn")) $("#moreBtn").onclick = () => openSettings(s);
    if (admin) { wireDriveLine(s); drawVersions(s).catch(console.error); }
    if (!s.content) {
      const token = ++renderToken;
      try { await drawPages(await S.file(s.pdf_path), $("#pages"), token); }
      catch (e) { if (token === renderToken) $("#pages").innerHTML = `<div class="card"><p>${esc(friendly(e))}</p></div>`; }
    }
  }

  function driveLine(s) {
    if (!s.content) return s.drive_url ? `<a href="${esc(s.drive_url)}" target="_blank" rel="noopener">Open in Google Drive ↗</a>` : "";
    if (!state.settings.sop_drive_url) return `Google Drive: not set up yet. <a href="#" data-drive-setup>Set it up</a> so saved SOPs go to the Drive SOP folder.`;
    const when = s.drive_synced_at ? `Saved to Google Drive ${esc(niceDate(s.drive_synced_at))}` : "Not in Google Drive yet";
    return `${when}${s.drive_url ? ` · <a href="${esc(s.drive_url)}" target="_blank" rel="noopener">Open in Drive ↗</a>` : ""} · <a href="#" data-drive-send>Save to Drive now</a>`;
  }
  function wireDriveLine(s) {
    const line = $("#driveLine");
    if (!line) return;
    const setup = $("[data-drive-setup]", line);
    if (setup) setup.onclick = (e) => { e.preventDefault(); openDriveSetup(); };
    const send = $("[data-drive-send]", line);
    if (send) send.onclick = async (e) => {
      e.preventDefault();
      line.textContent = "Saving to Google Drive…";
      const r = await pushToDrive(s);
      if (r.ok) { Object.assign(s, r.row || {}); toast("Saved to Google Drive"); } else toast(r.error, true);
      line.innerHTML = driveLine(s); wireDriveLine(s);
    };
  }

  // An uploaded PDF, drawn page by page so it reads well on a phone
  async function drawPages(blob, host, token) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    if (token !== renderToken) return;
    host.innerHTML = "";
    const width = Math.min(host.clientWidth || 800, 900);
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      if (token !== renderToken) return;
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / base.width) * ratio });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      canvas.className = "sop-page";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Page ${n} of ${doc.numPages}`);
      host.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    }
  }

  async function drawVersions(s) {
    const list = await S.versions(s.id);
    const host = $("#pastVersions");
    if (!host || !list.length) return;
    host.innerHTML = `<details><summary>Past versions (${list.length})</summary><ul>${list.map((v, i) => `
      <li>${v.version ? "Version " + esc(v.version) : "Earlier version"} · replaced ${esc(niceDate(v.replaced_at))}${v.replaced_by_name ? " by " + esc(v.replaced_by_name) : ""}
        <button type="button" class="ghost small" data-vpdf="${i}">PDF</button>
        ${v.content || v.word_path ? `<button type="button" class="ghost small" data-vword="${i}">Word</button>` : ""}
      </li>`).join("")}</ul></details>`;
    const name = (v, ext) => fileName({ ...s, content: v.content || null }, ext).replace(/\.(pdf|docx)$/, ` v${v.version || "old"}.$1`);
    $$("[data-vpdf]", host).forEach((b) => (b.onclick = async () => { const v = list[b.dataset.vpdf]; try { download(v.content ? await makePdf(v.content) : await S.file(v.pdf_path), name(v, "pdf")); } catch (e) { fail(e); } }));
    $$("[data-vword]", host).forEach((b) => (b.onclick = async () => { const v = list[b.dataset.vword]; try { download(v.content ? await makeDocx(v.content) : await S.file(v.word_path), name(v, "docx")); } catch (e) { fail(e); } }));
  }

  // =====================================================================
  // Admins: the editor
  // =====================================================================
  const BLOCK_LABEL = { text: "Text", subhead: "Subheading", bullets: "Bullet list", table: "Table", callout: "Highlight box" };
  const TABLE_PRESETS = {
    steps: ["Step", "Action", "Owner", "Standard / Notes"],
    two: ["Term", "Meaning"],
    roles: ["Role", "Responsibilities"],
    trouble: ["Issue", "Likely Cause", "What to Do"],
  };

  async function renderEditor(id) {
    const fresh = await S.get(id);
    if (!fresh || !fresh.content) { location.hash = "sop=" + id; return; }
    state.editing = { row: fresh, c: clone(fresh.content), category: fresh.category, audience: fresh.audience, preview: false };
    state.dirty = false;
    drawEditor();
  }

  function drawEditor() {
    const E = state.editing;
    const c = E.c;
    const m = c.meta || (c.meta = {});
    const scrollY = window.scrollY;
    const field = (key, label, val, o = {}) => `<div class="field ${o.cls || ""}"><label for="f-${key}">${label}</label>${o.area
      ? `<textarea id="f-${key}" data-meta="${key}" rows="2">${esc(val)}</textarea>`
      : `<input id="f-${key}" ${o.top ? `data-top="${key}"` : `data-meta="${key}"`} value="${esc(val)}" ${o.list ? `list="${o.list}"` : ""}>`}${o.hint ? `<div class="hint">${o.hint}</div>` : ""}</div>`;
    $("#view").innerHTML = `
      <div class="sop-editbar">
        <div><p class="eyebrow">Editing</p><div class="sop-editbar-title">${esc(D.titleCase(c.title) || "New SOP")}</div></div>
        <div class="btn-row">
          <button type="button" class="secondary" id="edPreview">${E.preview ? "Back to editing" : "Preview"}</button>
          <button type="button" class="secondary" id="edCancel">Cancel</button>
          <button type="button" id="edSave">Save</button>
        </div>
      </div>
      ${E.preview ? `<div class="sop-paper">${D.html(c)}</div>` : `
      <div class="card">
        <h2>Details</h2>
        ${field("title", "Title", c.title, { top: true })}
        ${field("subtitle", "Subtitle (the one-line outcome under the title)", c.subtitle, { top: true })}
        <div class="grid2">
          ${field("sop_number", "SOP number", m.sop_number)}
          <div class="field"><label>Version</label><input value="${esc(m.version)}" disabled><div class="hint">Goes up by itself when you save.</div></div>
          ${field("effective_date", "Effective date", m.effective_date)}
          ${field("next_review", "Next review", m.next_review)}
          ${field("process_owner", "Process owner", m.process_owner)}
          ${field("approved_by", "Approved by", m.approved_by)}
          ${field("applies_to", "Applies to", m.applies_to)}
          ${field("content_pillar", "Content pillar", m.content_pillar, { list: "pillars" })}
          <div class="field"><label for="f-cat">Category in the library</label><input id="f-cat" list="catList" value="${esc(E.category)}"><datalist id="catList">${categories().map((x) => `<option value="${esc(x)}">`).join("")}</datalist></div>
          <div class="field"><label for="f-aud">Who can see it</label><select id="f-aud">
            <option value="everyone" ${E.audience === "everyone" ? "selected" : ""}>Everyone signed in</option>
            <option value="admins" ${E.audience === "admins" ? "selected" : ""}>Admins only</option></select></div>
        </div>
        <datalist id="pillars"><option value="Professionalism"><option value="Science-Backed Expertise"><option value="Sustainability"><option value="Community"></datalist>
        <p class="hint">Tip: put <b>**two stars**</b> around words to make them bold. Each new line starts a new paragraph.</p>
      </div>
      ${c.sections.map((s, si) => `
        <div class="card sop-ed-sec" data-si="${si}">
          <div class="sop-ed-sechead">
            <span class="sop-ed-num">${si + 1}.</span>
            <input class="sop-ed-sectitle" data-sectitle="${si}" value="${esc(s.title)}" aria-label="Section ${si + 1} heading">
            <div class="sop-ed-tools">
              <button type="button" class="ghost small" data-secmove="${si}:-1" ${si === 0 ? "disabled" : ""} title="Move section up" aria-label="Move section up">↑</button>
              <button type="button" class="ghost small" data-secmove="${si}:1" ${si === c.sections.length - 1 ? "disabled" : ""} title="Move section down" aria-label="Move section down">↓</button>
              <button type="button" class="ghost small" data-secdel="${si}" title="Delete section" aria-label="Delete section">✕</button>
            </div>
          </div>
          ${(s.blocks || []).map((b, bi) => blockEditor(b, si, bi, s.blocks.length)).join("")}
          ${addBar(si)}
        </div>`).join("")}
      <div class="btn-row" style="margin-bottom:24px"><button type="button" class="secondary" id="addSec">+ Add a section</button></div>
      <div class="card">
        <h2>${c.sections.length + 1}. Revision history</h2>
        <p class="muted small">Filled in for you each time you save: the date, who saved it, the new version and what changed. Kasey is the approver.</p>
        ${(c.revisions || []).length ? `<div class="sd-scroll"><table class="sd-table"><thead><tr><th>Version</th><th>Date</th><th>Description of Change</th><th>Changed By</th><th>Approved By</th></tr></thead><tbody>${c.revisions.map((r) => `<tr><td>${esc(r.version)}</td><td>${esc(r.date)}</td><td>${esc(r.change)}</td><td>${esc(r.changed_by)}</td><td>${esc(r.approved_by)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="small">Nothing yet.</p>`}
      </div>`}`;
    // Text boxes grow to fit what's in them
    const fit = (el) => { el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; };
    $$("#view textarea").forEach((el) => { fit(el); el.addEventListener("input", () => fit(el)); });
    window.scrollTo(0, scrollY);
    wireEditor();
  }

  function blockEditor(b, si, bi, count) {
    const id = `${si}:${bi}`;
    const tools = `<div class="sop-ed-tools">
      <span class="sop-ed-type">${BLOCK_LABEL[b.type] || "Text"}</span>
      <button type="button" class="ghost small" data-bmove="${id}:-1" ${bi === 0 ? "disabled" : ""} title="Move up" aria-label="Move up">↑</button>
      <button type="button" class="ghost small" data-bmove="${id}:1" ${bi === count - 1 ? "disabled" : ""} title="Move down" aria-label="Move down">↓</button>
      <button type="button" class="ghost small" data-bdel="${id}" title="Delete" aria-label="Delete">✕</button></div>`;
    const rowsFor = (t) => Math.min(12, Math.max(2, Math.ceil(String(t || "").length / 70) + (String(t || "").match(/\n/g) || []).length));
    let inner = "";
    if (b.type === "subhead") inner = `<input class="sop-ed-subhead" data-btext="${id}" value="${esc(b.text)}" aria-label="Subheading">`;
    else if (b.type === "bullets") inner = `<textarea data-bitems="${id}" rows="${Math.max(2, (b.items || []).length + 1)}" aria-label="Bullet list">${esc((b.items || []).join("\n"))}</textarea><div class="hint">One bullet per line.</div>`;
    else if (b.type === "callout") {
      inner = (b.rows || []).map((r, ri) => `<div class="sop-ed-callrow">
        <input data-cell="${id}:${ri}:0" value="${esc(r[0])}" aria-label="Label">
        <textarea data-cell="${id}:${ri}:1" rows="${rowsFor(r[1])}" aria-label="Text">${esc(r[1])}</textarea>
        <button type="button" class="ghost small" data-rowdel="${id}:${ri}" title="Remove row" aria-label="Remove row">✕</button></div>`).join("")
        + `<button type="button" class="ghost small" data-rowadd="${id}">+ Add a row</button>`;
    } else if (b.type === "table") {
      const n = Math.max((b.head || []).length, 1);
      const w = D.colWidths(b);
      inner = `<div class="sop-ed-table" style="grid-template-columns:${w.map((x) => `minmax(90px, ${x.toFixed(3)}fr)`).join(" ")} 64px">
        ${(b.head || []).map((h, hi) => `<input class="sop-ed-th" data-head="${id}:${hi}" value="${esc(D.plain(h))}" aria-label="Column ${hi + 1} heading">`).join("")}<span></span>
        ${(b.rows || []).map((r, ri) => Array.from({ length: n }, (_, ci) => `<textarea data-cell="${id}:${ri}:${ci}" rows="${rowsFor(r[ci])}" aria-label="Row ${ri + 1}, ${esc(D.plain((b.head || [])[ci] || ""))}">${esc(r[ci] || "")}</textarea>`).join("")
          + `<div class="sop-ed-rowtools"><button type="button" class="ghost small" data-rowmove="${id}:${ri}:-1" ${ri === 0 ? "disabled" : ""} aria-label="Move row up">↑</button><button type="button" class="ghost small" data-rowdel="${id}:${ri}" aria-label="Remove row">✕</button></div>`).join("")}
      </div>
      <div class="btn-row"><button type="button" class="ghost small" data-rowadd="${id}">+ Add a row</button>
        <button type="button" class="ghost small" data-coladd="${id}">+ Column</button>
        ${n > 1 ? `<button type="button" class="ghost small" data-coldel="${id}">− Last column</button>` : ""}</div>`;
    } else inner = `<textarea data-btext="${id}" rows="${rowsFor(b.text)}" aria-label="Text">${esc(b.text)}</textarea>`;
    return `<div class="sop-ed-block t-${b.type}">${tools}${inner}</div>`;
  }

  const addBar = (si) => `<div class="sop-ed-add">
    <span class="small muted">Add:</span>
    <button type="button" class="ghost small" data-addb="${si}:text">Text</button>
    <button type="button" class="ghost small" data-addb="${si}:subhead">Subheading</button>
    <button type="button" class="ghost small" data-addb="${si}:bullets">Bullets</button>
    <button type="button" class="ghost small" data-addb="${si}:steps">Step table</button>
    <button type="button" class="ghost small" data-addb="${si}:two">Two-column table</button>
    <button type="button" class="ghost small" data-addb="${si}:trouble">Troubleshooting table</button>
    <button type="button" class="ghost small" data-addb="${si}:callout">Highlight box</button></div>`;

  function wireEditor() {
    const E = state.editing;
    const c = E.c;
    const touch = () => { state.dirty = true; };
    const blk = (id) => { const [si, bi] = id.split(":").map(Number); return c.sections[si].blocks[bi]; };
    const redraw = () => { touch(); renumberSteps(c); drawEditor(); };
    $("#edPreview").onclick = () => { E.preview = !E.preview; drawEditor(); window.scrollTo(0, 0); };
    $("#edCancel").onclick = () => { if (state.dirty && !confirm("Leave without saving your changes?")) return; state.dirty = false; location.hash = "sop=" + E.row.id; };
    $("#edSave").onclick = () => openSaveDialog();
    if (E.preview) return;
    $$("[data-top]").forEach((el) => (el.oninput = () => { c[el.dataset.top] = el.value; touch(); }));
    $$("[data-meta]").forEach((el) => (el.oninput = () => { c.meta[el.dataset.meta] = el.value; touch(); }));
    $("#f-cat").oninput = (e) => { E.category = e.target.value; touch(); };
    $("#f-aud").onchange = (e) => { E.audience = e.target.value; touch(); };
    $$("[data-sectitle]").forEach((el) => (el.oninput = () => { c.sections[+el.dataset.sectitle].title = el.value.toUpperCase(); touch(); }));
    $$("[data-btext]").forEach((el) => (el.oninput = () => { blk(el.dataset.btext).text = el.value; touch(); }));
    $$("[data-bitems]").forEach((el) => (el.oninput = () => { blk(el.dataset.bitems).items = el.value.split("\n"); touch(); }));
    $$("[data-head]").forEach((el) => (el.oninput = () => { const p = el.dataset.head.split(":"); blk(p[0] + ":" + p[1]).head[+p[2]] = el.value; touch(); }));
    $$("[data-cell]").forEach((el) => (el.oninput = () => { const p = el.dataset.cell.split(":"); const b = blk(p[0] + ":" + p[1]); b.rows[+p[2]][+p[3]] = el.value; touch(); }));
    $$("[data-secmove]").forEach((el) => (el.onclick = () => { const [si, d] = el.dataset.secmove.split(":").map(Number); const s = c.sections.splice(si, 1)[0]; c.sections.splice(si + d, 0, s); redraw(); }));
    $$("[data-secdel]").forEach((el) => (el.onclick = () => { const si = +el.dataset.secdel; if (!confirm(`Delete section ${si + 1}, ${D.titleCase(c.sections[si].title)}, and everything in it?`)) return; c.sections.splice(si, 1); redraw(); }));
    $("#addSec").onclick = () => { c.sections.push({ title: "NEW SECTION", blocks: [{ type: "text", text: "" }] }); redraw(); setTimeout(() => { const all = $$(".sop-ed-sectitle"); const last = all[all.length - 1]; if (last) { last.focus(); last.select(); } }, 0); };
    $$("[data-bmove]").forEach((el) => (el.onclick = () => { const [si, bi, d] = el.dataset.bmove.split(":").map(Number); const list = c.sections[si].blocks; const b = list.splice(bi, 1)[0]; list.splice(bi + d, 0, b); redraw(); }));
    $$("[data-bdel]").forEach((el) => (el.onclick = () => { const [si, bi] = el.dataset.bdel.split(":").map(Number); const b = c.sections[si].blocks[bi]; const empty = !D.plain(JSON.stringify([b.text, b.items, b.rows])).replace(/[\[\]",\s]|null/g, ""); if (!empty && !confirm(`Delete this ${BLOCK_LABEL[b.type].toLowerCase()}?`)) return; c.sections[si].blocks.splice(bi, 1); redraw(); }));
    $$("[data-addb]").forEach((el) => (el.onclick = () => {
      const [si, kind] = el.dataset.addb.split(":");
      const b = TABLE_PRESETS[kind] ? { type: "table", head: TABLE_PRESETS[kind].slice(), rows: [TABLE_PRESETS[kind].map(() => "")] }
        : kind === "bullets" ? { type: "bullets", items: [""] } : kind === "callout" ? { type: "callout", rows: [["", ""]] } : { type: kind, text: "" };
      if (kind === "steps") b.rows[0][0] = String(lastStep(c) + 1);
      c.sections[+si].blocks.push(b); redraw();
    }));
    $$("[data-rowadd]").forEach((el) => (el.onclick = () => {
      const b = blk(el.dataset.rowadd);
      const n = b.type === "callout" ? 2 : Math.max((b.head || []).length, 1);
      const row = Array.from({ length: n }, () => "");
      const prev = b.rows[b.rows.length - 1];
      if (b.type === "table" && prev && /^\d+$/.test(String(prev[0]).trim())) row[0] = String(Number(prev[0]) + 1);
      b.rows.push(row); redraw();
    }));
    $$("[data-rowdel]").forEach((el) => (el.onclick = () => { const p = el.dataset.rowdel.split(":"); const b = blk(p[0] + ":" + p[1]); b.rows.splice(+p[2], 1); redraw(); }));
    $$("[data-rowmove]").forEach((el) => (el.onclick = () => { const p = el.dataset.rowmove.split(":").map(Number); const b = c.sections[p[0]].blocks[p[1]]; const r = b.rows.splice(p[2], 1)[0]; b.rows.splice(p[2] + p[3], 0, r); redraw(); }));
    $$("[data-coladd]").forEach((el) => (el.onclick = () => { const b = blk(el.dataset.coladd); b.head = b.head || []; b.head.push("New column"); b.rows.forEach((r) => r.push("")); redraw(); }));
    $$("[data-coldel]").forEach((el) => (el.onclick = () => { const b = blk(el.dataset.coldel); if (!confirm("Remove the last column and what's in it?")) return; b.head.pop(); b.rows.forEach((r) => r.pop()); redraw(); }));
  }
  // The highest step number in the SOP, so a new step table carries on from it
  function lastStep(c) {
    let n = 0;
    c.sections.forEach((s) => (s.blocks || []).forEach((b) => { if (b.type === "table" && D.plain((b.head || [])[0]).toLowerCase() === "step") b.rows.forEach((r) => { const v = parseInt(r[0], 10); if (v > n) n = v; }); }));
    return n;
  }

  // Step numbers run 1, 2, 3… through every step table in the SOP
  function renumberSteps(c) {
    let n = 0;
    c.sections.forEach((s) => (s.blocks || []).forEach((b) => {
      if (b.type === "table" && D.plain((b.head || [])[0]).trim().toLowerCase() === "step") b.rows.forEach((r) => { r[0] = String(++n); });
    }));
  }

  // Tidy before saving: drop empty bullets and blank rows
  function tidy(c) {
    c.title = String(c.title || "").trim().toUpperCase();
    c.subtitle = String(c.subtitle || "").trim().toUpperCase();
    c.sections = c.sections.map((s) => ({
      title: String(s.title || "").trim().toUpperCase(),
      blocks: (s.blocks || []).map((b) => {
        if (b.type === "bullets") return { ...b, items: (b.items || []).map((i) => String(i).trim()).filter(Boolean) };
        if (b.type === "table" || b.type === "callout") return { ...b, rows: (b.rows || []).filter((r) => r.some((x) => String(x || "").trim())) };
        return { ...b, text: String(b.text || "").trim() };
      }).filter((b) => (b.type === "bullets" ? b.items.length : b.type === "table" ? b.rows.length || (b.head || []).length : b.type === "callout" ? b.rows.length : b.text)),
    })).filter((s) => s.title || s.blocks.length);
    renumberSteps(c);
    return c;
  }

  function openSaveDialog() {
    const E = state.editing;
    if (!String(E.c.title || "").trim()) { toast("Give the SOP a title first.", true); return; }
    const v = nextVersion(E.c.meta.version);
    const { m, close } = modal(`
      <h2>Save changes</h2>
      <form id="saveForm">
        <div class="field"><label for="sChange">What changed? <span class="req">*</span></label>
          <textarea id="sChange" required maxlength="300" style="min-height:70px" placeholder="For example: Added the irrigation check to step 14"></textarea>
          <div class="hint">This goes in the Revision History.</div></div>
        <div class="grid2">
          <div class="field"><label for="sVer">New version</label><input id="sVer" value="${esc(v)}"></div>
          <div class="field"><label>Revised</label><input value="${esc(today())} by ${esc(myName())}" disabled></div>
        </div>
        <p class="small muted">${state.settings.sop_drive_url ? "The new Word file and PDF will also be saved to the Google Drive SOP folder, and the old ones moved to its Archive folder." : "Google Drive isn't set up yet, so this saves in the app only."}</p>
        <p id="sErr" class="error-text"></p>
        <div class="btn-row" style="justify-content:flex-end"><button type="button" class="secondary" id="sCancel">Cancel</button><button type="submit" id="sGo">Save</button></div>
      </form>`);
    $("#sCancel", m).onclick = close;
    $("#sChange", m).focus();
    $("#saveForm", m).onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("#sGo", m);
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        const row = await saveSop($("#sChange", m).value.trim(), $("#sVer", m).value.trim() || v);
        close();
        state.dirty = false;
        location.hash = "sop=" + row.id;
        if (state.settings.sop_drive_url) {
          toast("Saved. Now saving to Google Drive…");
          const r = await pushToDrive(row);
          toast(r.ok ? "Saved, and saved to Google Drive" : "Saved in the app, but not to Google Drive: " + r.error, !r.ok);
          if (r.ok && location.hash === "#sop=" + row.id) await route();
        } else toast("Saved");
      } catch (ex) {
        $("#sErr", m).textContent = friendly(ex);
        btn.disabled = false; btn.textContent = "Save";
      }
    };
  }

  async function saveSop(change, version) {
    const E = state.editing;
    const before = await S.get(E.row.id);
    if (before.updated_at !== E.row.updated_at) throw new Error(`${before.updated_by_name || "Someone"} saved this SOP while you were editing. Copy anything you need, then reload the page and make your changes again.`);
    const c = tidy(clone(E.c));
    const who = myName();
    c.meta.version = version;
    if (!c.meta.approved_by) c.meta.approved_by = "Kasey";
    c.revisions = [...(c.revisions || []), { version, date: today(), change, changed_by: who, approved_by: c.meta.approved_by.split(",")[0].trim() || "Kasey" }];
    await S.addVersion({ sop_id: before.id, version: before.version, content: before.content, pdf_path: before.pdf_path, word_path: before.word_path, was_updated_at: before.updated_at, replaced_by_name: who });
    const saved = await S.update(before.id, {
      content: c, title: D.titleCase(c.title), sop_number: c.meta.sop_number || "", version, summary: "",
      category: (E.category || "").trim() || CATEGORIES[0], audience: E.audience, search_text: contentText(c),
      updated_at: new Date().toISOString(), updated_by: LIVE ? state.me.id : null, updated_by_name: who,
    });
    return saved;
  }

  // Send the Word file and PDF to the Drive SOP folder
  async function pushToDrive(s, opts = {}) {
    const url = state.settings.sop_drive_url;
    if (!url) return { ok: false, error: "Google Drive isn't set up yet." };
    if (S.mode === "demo") return { ok: false, error: "Demo mode doesn't save to Google Drive." };
    try {
      const token = await S.token();
      const body = opts.ping ? { token, ping: true } : {
        token, base: D.fileBase(s.content), oldBase: opts.oldBase || "",
        docx: await blobB64(await makeDocx(s.content)), pdf: await blobB64(await makePdf(s.content)),
      };
      const res = await fetch(url, { method: "POST", body: JSON.stringify(body) });
      let out;
      try { out = await res.json(); } catch (e) { throw new Error("Google didn't answer as expected. Check the Web app address in Google Drive setup."); }
      if (!out.ok) throw new Error(out.error || "Google Drive said no.");
      if (opts.ping) return out;
      const row = await S.update(s.id, { drive_url: out.docx_url || "", drive_synced_at: new Date().toISOString() });
      return { ok: true, row };
    } catch (e) {
      return { ok: false, error: friendly(e) };
    }
  }

  function openDriveSetup() {
    const { m, close } = modal(`
      <h2>Google Drive setup</h2>
      <p>Each time an admin saves an SOP, the app can save the new Word file and PDF to your <a href="https://drive.google.com/drive/folders/12Q-lMck_aNmYqiWwUcgyfMgF17ieZNge" target="_blank" rel="noopener">Drive SOP folder</a> and move the old copies into its Archive folder. It takes one small script in your Google account, set up once:</p>
      <ol class="sop-steps">
        <li>Sign in to Google as an account that can edit the SOP folder, and go to <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com</a> (it opens a new project).</li>
        <li>Delete the sample code. Paste everything from <a href="https://github.com/Harmony-Horticulture/report-builder/blob/main/integrations/sop-drive.gs" target="_blank" rel="noopener">this script</a> (click the copy button at the top right of the file), then click the save icon. Name the project "Harmony SOPs to Drive".</li>
        <li>Click <b>Deploy</b> &gt; <b>New deployment</b>. Click the gear next to "Select type" and choose <b>Web app</b>. Set <b>Execute as</b> to <b>Me</b> and <b>Who has access</b> to <b>Anyone</b>. Click <b>Deploy</b>, then <b>Authorize access</b> and allow it. (If Google says the app isn't verified, click Advanced, then Go to Harmony SOPs to Drive.)</li>
        <li>Copy the <b>Web app URL</b> and paste it below.</li>
      </ol>
      <p class="small muted">"Anyone" only means the app can reach the script. The script checks that the person saving is signed in to the app as an admin before it touches the folder.</p>
      <div class="field"><label for="dUrl">Web app URL</label><input id="dUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(state.settings.sop_drive_url || "")}"></div>
      <p id="dMsg" class="small"></p>
      <div class="btn-row" style="justify-content:space-between">
        <div>${state.settings.sop_drive_url ? `<button type="button" class="danger" id="dOff">Turn off</button>` : ""}</div>
        <div class="btn-row"><button type="button" class="secondary" id="dCancel">Close</button><button type="button" id="dSave">Save and test</button></div>
      </div>`);
    $("#dCancel", m).onclick = close;
    const msg = $("#dMsg", m);
    if ($("#dOff", m)) $("#dOff", m).onclick = async () => { try { await S.saveSettings({ sop_drive_url: "" }); state.settings.sop_drive_url = ""; close(); toast("Google Drive saving is off"); route(); } catch (e) { fail(e); } };
    $("#dSave", m).onclick = async () => {
      const url = $("#dUrl", m).value.trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/i.test(url)) { msg.className = "error-text"; msg.textContent = "That doesn't look like a Web app URL. It starts with https://script.google.com/macros/s/"; return; }
      msg.className = "small muted"; msg.textContent = "Testing…";
      const prev = state.settings.sop_drive_url;
      state.settings.sop_drive_url = url;
      const r = S.mode === "demo" ? { ok: true, folder: "SOPs (demo)" } : await pushToDrive(null, { ping: true });
      if (!r.ok) { state.settings.sop_drive_url = prev; msg.className = "error-text"; msg.textContent = "The test didn't work: " + r.error; return; }
      try { await S.saveSettings({ sop_drive_url: url }); } catch (e) { state.settings.sop_drive_url = prev; msg.className = "error-text"; msg.textContent = friendly(e); return; }
      close();
      toast(`Connected to the "${r.folder}" folder. Saved SOPs will go there.`);
      route();
    };
  }

  // =====================================================================
  // Admins: add an SOP, and its settings
  // =====================================================================
  function openAdd() {
    if (!isAdmin()) return;
    const { m, close } = modal(`
      <h2>Add an SOP</h2>
      <div class="sop-choice">
        <button type="button" class="sop-choice-btn" id="aWrite"><b>Write it in the app</b><span>Starts from the SOP Template with every section ready to fill in. You can edit and save it any time.</span></button>
        <button type="button" class="sop-choice-btn" id="aUpload"><b>Upload a PDF</b><span>For a document made somewhere else. People read it in the app, but it can't be edited here.</span></button>
      </div>
      <div class="btn-row" style="justify-content:flex-end;margin-top:14px"><button type="button" class="secondary" id="aCancel">Cancel</button></div>`);
    $("#aCancel", m).onclick = close;
    $("#aUpload", m).onclick = () => { close(); openUpload(null); };
    $("#aWrite", m).onclick = async () => {
      try {
        const c = D.blank(myName());
        const nums = state.sops.map((s) => parseInt(String(s.sop_number).replace(/\D/g, ""), 10)).filter((n) => n > 0);
        c.meta.sop_number = `HH-SOP-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}`;
        c.meta.effective_date = today();
        const row = await S.insert({ id: uid(), content: c, title: D.titleCase(c.title), sop_number: c.meta.sop_number, version: c.meta.version, category: state.cat || CATEGORIES[0], audience: "everyone", summary: "", search_text: "", updated_at: new Date().toISOString(), updated_by: LIVE ? state.me.id : null, updated_by_name: myName() });
        close();
        location.hash = `sop=${row.id}&edit`;
      } catch (e) { fail(e); }
    };
  }

  // Category, who sees it, archive (SOPs written in the app)
  function openSettings(s) {
    if (!s.content) return openUpload(s);
    const { m, close } = modal(`
      <h2>${esc(s.title)}</h2>
      <div class="grid2">
        <div class="field"><label for="oCat">Category</label><input id="oCat" list="catList2" value="${esc(s.category)}"><datalist id="catList2">${categories().map((x) => `<option value="${esc(x)}">`).join("")}</datalist></div>
        <div class="field"><label for="oAud">Who can see it</label><select id="oAud"><option value="everyone" ${s.audience === "everyone" ? "selected" : ""}>Everyone signed in</option><option value="admins" ${s.audience === "admins" ? "selected" : ""}>Admins only</option></select></div>
      </div>
      <div class="btn-row" style="justify-content:space-between">
        <button type="button" class="danger" id="oArch">${s.archived ? "Restore" : "Archive"}</button>
        <div class="btn-row"><button type="button" class="secondary" id="oCancel">Cancel</button><button type="button" id="oSave">Save</button></div>
      </div>`);
    $("#oCancel", m).onclick = close;
    $("#oArch", m).onclick = async () => {
      try { await S.update(s.id, { archived: !s.archived }); close(); toast(s.archived ? "SOP restored" : "SOP archived. It's hidden from everyone but admins."); location.hash = ""; await route(); } catch (e) { fail(e); }
    };
    $("#oSave", m).onclick = async () => {
      try { await S.update(s.id, { category: $("#oCat", m).value.trim() || CATEGORIES[0], audience: $("#oAud", m).value }); close(); toast("Saved"); await route(); } catch (e) { fail(e); }
    };
  }

  // The words inside an uploaded PDF, so search finds it by what it says
  async function pdfText(file) {
    try {
      const lib = await pdfjs();
      const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      let out = "";
      for (let n = 1; n <= doc.numPages && out.length < 200000; n++) {
        const tc = await (await doc.getPage(n)).getTextContent();
        out += tc.items.map((i) => i.str).join(" ") + "\n";
      }
      return out.replace(/[ \t]+/g, " ").slice(0, 200000);
    } catch (e) { console.warn("Couldn't read the PDF's text", e); return ""; }
  }

  // Add or update an SOP that is an uploaded PDF
  function openUpload(s) {
    const isNew = !s;
    const v = s || { title: "", sop_number: "", category: state.cat || CATEGORIES[0], audience: "everyone", version: "1.0", summary: "", drive_url: "" };
    const { m, close } = modal(`
      <h2>${isNew ? "Upload a PDF SOP" : "Update " + esc(s.title)}</h2>
      <form id="sopForm">
        <div class="field"><label for="fTitle">Title <span class="req">*</span></label><input id="fTitle" required value="${esc(v.title)}"></div>
        <div class="grid2">
          <div class="field"><label for="fNum">SOP number</label><input id="fNum" value="${esc(v.sop_number)}" placeholder="HH-SOP-006"></div>
          <div class="field"><label for="fVer">Version</label><input id="fVer" value="${esc(v.version)}" placeholder="1.0"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="fCat">Category</label><input id="fCat" list="catList" value="${esc(v.category)}"><datalist id="catList">${categories().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
          <div class="field"><label for="fAud">Who can see it</label><select id="fAud">
            <option value="everyone" ${v.audience === "everyone" ? "selected" : ""}>Everyone signed in</option>
            <option value="admins" ${v.audience === "admins" ? "selected" : ""}>Admins only</option>
          </select></div>
        </div>
        <div class="field"><label for="fSum">Short summary</label><textarea id="fSum" maxlength="400" style="min-height:64px">${esc(v.summary)}</textarea></div>
        <div class="field"><label for="fPdf">PDF ${isNew ? `<span class="req">*</span>` : ""}</label><input id="fPdf" type="file" accept="application/pdf,.pdf" ${isNew ? "required" : ""}>
          <div class="hint">${isNew ? "This is what everyone reads in the app." : "Only if the SOP changed. The current PDF is kept under Past versions."}</div></div>
        <div class="field"><label for="fWord">Word file (optional)</label><input id="fWord" type="file" accept=".docx,${WORD}"><div class="hint">Only admins can download it.</div></div>
        <div class="field"><label for="fDrive">Google Drive link (optional)</label><input id="fDrive" type="url" value="${esc(v.drive_url)}" placeholder="https://docs.google.com/…"></div>
        <p id="fErr" class="error-text"></p>
        <div class="btn-row" style="justify-content:space-between">
          <div>${!isNew ? `<button type="button" class="danger" id="fArch">${s.archived ? "Restore" : "Archive"}</button>` : ""}</div>
          <div class="btn-row"><button type="button" class="secondary" id="fCancel">Cancel</button><button type="submit" id="fSave">${isNew ? "Add SOP" : "Save"}</button></div>
        </div>
      </form>`);
    $("#fCancel", m).onclick = close;
    if ($("#fArch", m)) $("#fArch", m).onclick = async () => {
      try { await S.update(s.id, { archived: !s.archived }); close(); toast(s.archived ? "SOP restored" : "SOP archived. It's hidden from everyone but admins."); location.hash = ""; await route(); } catch (e) { fail(e); }
    };
    $("#sopForm", m).onsubmit = async (e) => {
      e.preventDefault();
      const err = $("#fErr", m);
      const pdf = $("#fPdf", m).files[0];
      const word = $("#fWord", m).files[0];
      const drive = $("#fDrive", m).value.trim();
      err.textContent = "";
      if (pdf && !/\.pdf$/i.test(pdf.name) && pdf.type !== PDF) { err.textContent = "The PDF box needs a .pdf file."; return; }
      if (word && !/\.docx$/i.test(word.name)) { err.textContent = "The Word box needs a .docx file."; return; }
      if ((pdf && pdf.size > 25e6) || (word && word.size > 25e6)) { err.textContent = "Files need to be under 25 MB."; return; }
      if (drive && !/^https:\/\//i.test(drive)) { err.textContent = "The Drive link should start with https://"; return; }
      const btn = $("#fSave", m);
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        const who = myName();
        const fields = {
          title: $("#fTitle", m).value.trim(), sop_number: $("#fNum", m).value.trim(), version: $("#fVer", m).value.trim(),
          category: $("#fCat", m).value.trim() || CATEGORIES[0], audience: $("#fAud", m).value,
          summary: $("#fSum", m).value.trim(), drive_url: drive,
        };
        const id = isNew ? uid() : s.id;
        if (pdf || word) { fields.updated_at = new Date().toISOString(); fields.updated_by = LIVE ? state.me.id : null; fields.updated_by_name = who; }
        if (!isNew && (pdf || word)) await S.addVersion({ sop_id: s.id, version: s.version, pdf_path: s.pdf_path, word_path: s.word_path, was_updated_at: s.updated_at, replaced_by_name: who });
        if (pdf) { fields.pdf_path = await S.upload(id, pdf, PDF); fields.search_text = await pdfText(pdf); }
        if (word) fields.word_path = await S.upload(id, word, WORD);
        const saved = isNew ? await S.insert({ id, ...fields }) : await S.update(s.id, fields);
        close();
        toast(isNew ? "SOP added" : "SOP updated");
        if (location.hash === "#sop=" + saved.id) await route(); else location.hash = "sop=" + saved.id;
      } catch (ex) {
        err.textContent = friendly(ex);
        btn.disabled = false; btn.textContent = isNew ? "Add SOP" : "Save";
      }
    };
  }

  start();
})();
