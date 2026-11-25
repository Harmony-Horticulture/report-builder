// =====================================================================
// Harmony Horticulture SOPs: the library of standard operating
// procedures, open to everyone signed in (consultants, technicians and
// admins). Each SOP opens as a readable page in the app, with a PDF to
// download. Admins add and update SOPs; replacing the file keeps the old
// one as a past version. Google Drive stays the master copy.
// Uses the same login and database as the Report Builder and Time Tracker
// (tables and rules: supabase/07_sops.sql).
// =====================================================================
(function () {
  const cfg = window.HH_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const LIVE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) && !params.has("demo");
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TT = cfg.TIME_TRACKER_URL || "https://harmony-horticulture.github.io/time-tracker/";

  // Categories offered when adding an SOP. Admins can type a new one too.
  const CATEGORIES = ["Field work", "Office and accounting", "Apps and tools"];
  const PDF = "application/pdf";
  const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const safeName = (s) => String(s || "file").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 80);

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
      async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
      async signOut() { await sb.auth.signOut(); },
      async list() { return ok(await sb.from("sops").select("*").order("title")); },
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
    };
  }

  function demoStore() {
    const KEY = "hh-sops-demo-v1";
    const files = new Map(); // uploaded in demo mode: kept until the page is reloaded
    const day = 864e5;
    const at = (n) => new Date(Date.now() - n * day).toISOString();
    const seed = () => [
      { id: "s1", sop_number: "HH-SOP-001", title: "Flower Planting Season", category: "Field work", audience: "everyone", version: "1.2", updated_at: at(5),
        summary: "How the team plans, orders, installs and follows up on seasonal flower plantings.", drive_url: "" },
      { id: "s2", sop_number: "HH-SOP-002", title: "Receipts Submission", category: "Office and accounting", audience: "everyone", version: "1.0", updated_at: at(5),
        summary: "How and when to send in receipts for company card purchases and reimbursements.", drive_url: "https://drive.google.com/drive/folders/12Q-lMck_aNmYqiWwUcgyfMgF17ieZNge" },
      { id: "s3", sop_number: "HH-SOP-003", title: "App Administration", category: "Apps and tools", audience: "admins", version: "1.0", updated_at: at(5),
        summary: "Inviting people, roles, client and service lists, and QuickBooks files in the Time Tracker and Reports apps.", drive_url: "https://drive.google.com/drive/folders/12Q-lMck_aNmYqiWwUcgyfMgF17ieZNge" },
      { id: "s4", sop_number: "HH-SOP-004", title: "Time Tracking and Client Reports", category: "Apps and tools", audience: "everyone", version: "1.1", updated_at: at(5),
        summary: "Logging billable time and materials every day, and writing and sending client reports.", drive_url: "https://drive.google.com/drive/folders/12Q-lMck_aNmYqiWwUcgyfMgF17ieZNge" },
      { id: "s5", sop_number: "HH-SOP-005", title: "Treatment Approval", category: "Field work", audience: "everyone", version: "1.0", updated_at: at(5),
        summary: "Getting client approval before any treatment is applied, and recording it for billing.", drive_url: "https://drive.google.com/drive/folders/12Q-lMck_aNmYqiWwUcgyfMgF17ieZNge" },
    ].map((s) => ({ ...s, pdf_path: "sample:" + s.id, word_path: null, search_text: "", archived: false, updated_by_name: "Krista", created_at: s.updated_at }));
    let data;
    try { data = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { data = null; }
    if (!data) data = { sops: seed(), versions: [] };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode */ } };
    const as = params.get("as") === "consultant" ? "consultant" : "admin";
    return {
      mode: "demo",
      as,
      async me() { return { id: "demo", email: "demo@harmonyhorticulture.com", full_name: as === "admin" ? "Demo Admin" : "Demo Consultant", role: as, active: true }; },
      async signIn() {},
      async signOut() {},
      async list() {
        const rows = data.sops.slice().sort((a, b) => a.title.localeCompare(b.title));
        return as === "admin" ? rows : rows.filter((s) => s.audience === "everyone" && !s.archived);
      },
      async versions(id) { return data.versions.filter((v) => v.sop_id === id).sort((a, b) => b.replaced_at.localeCompare(a.replaced_at)); },
      async file(path) {
        if (files.has(path)) return files.get(path);
        if (path.startsWith("sample:")) return samplePdf(data.sops.find((s) => s.pdf_path === path) || data.versions.find((v) => v.pdf_path === path) || {});
        throw new Error("In demo mode, files you upload are only kept until the page is reloaded.");
      },
      async upload(sopId, file) { const path = `${sopId}/${Date.now()}-${safeName(file.name)}`; files.set(path, file); return path; },
      async insert(row) { const r = { id: uid(), ...row, created_at: new Date().toISOString(), archived: false }; data.sops.push(r); save(); return r; },
      async update(id, patch) { const r = data.sops.find((s) => s.id === id); Object.assign(r, patch); save(); return r; },
      async addVersion(row) { data.versions.push({ ...row, id: uid(), replaced_at: new Date().toISOString() }); save(); },
    };
  }

  // A stand-in PDF for the demo, so the reader can be tried before the
  // real SOPs are uploaded
  async function samplePdf(s) {
    await loadScript("vendor/jspdf.umd.min.js");
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
    const W = 612, M = 60;
    doc.setFillColor(95, 53, 27); doc.rect(0, 0, W, 8, "F");
    doc.setTextColor(240, 101, 165); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("HARMONY HORTICULTURE  ·  STANDARD OPERATING PROCEDURE", M, 60);
    doc.setTextColor(95, 53, 27); doc.setFont("helvetica", "normal"); doc.setFontSize(22);
    doc.text(doc.splitTextToSize(String(s.title || "Sample SOP").toUpperCase(), W - 2 * M), M, 92);
    doc.setFontSize(10); doc.setTextColor(89, 89, 89);
    doc.text(`${s.sop_number || ""}   Version ${s.version || "1.0"}`, M, 130);
    doc.setDrawColor(138, 198, 65); doc.setLineWidth(2); doc.line(M, 142, W - M, 142);
    let y = 176;
    const para = (head, body) => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(0, 147, 68); doc.text(head.toUpperCase(), M, y); y += 18;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(26, 26, 26);
      const lines = doc.splitTextToSize(body, W - 2 * M); doc.text(lines, M, y); y += lines.length * 14 + 16;
    };
    para("This is a sample", "This page stands in for the real SOP so you can try the library in demo mode. Once the app is connected and an admin uploads the PDF, the real SOP shows here, page by page.");
    para("1. Purpose", s.summary || "Why this procedure exists and what it protects.");
    para("2. Who this applies to", "Everyone named in the SOP's Applies To line.");
    para("3. Steps", "Each step of the procedure, in order, with who does it and when.");
    doc.addPage();
    doc.setFillColor(95, 53, 27); doc.rect(0, 0, W, 8, "F");
    y = 70;
    para("4. Records", "What gets saved, where, and for how long.");
    para("5. Approval", "Approved by: Kasey");
    return doc.output("blob");
  }

  function friendly(err) {
    const msg = (err && (err.message || String(err))) || "Something went wrong.";
    if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
    if (/Invalid login credentials/i.test(msg)) return "That email and password don't match.";
    if (/relation .*sop.* does not exist|Could not find the table|Bucket not found/i.test(msg)) return "The SOP library isn't set up in Supabase yet. Run supabase/07_sops.sql.";
    if (/Failed to fetch|NetworkError/i.test(msg)) return "Can't reach the server. Check your connection and try again.";
    return msg;
  }

  const S = LIVE ? liveStore() : demoStore();
  const state = { me: null, sops: [], q: "", cat: "", showArchived: false };
  try { const f = JSON.parse(sessionStorage.getItem("hh-sops-filters") || "{}"); state.q = f.q || ""; state.cat = f.cat || ""; } catch (e) { /* ignore */ }
  const keepFilters = () => { try { sessionStorage.setItem("hh-sops-filters", JSON.stringify({ q: state.q, cat: state.cat })); } catch (e) { /* ignore */ } };
  const isAdmin = () => state.me && state.me.role === "admin";
  const q = S.mode === "demo" ? "?demo" + (S.as === "consultant" ? "&as=consultant" : "") : "";

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
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const fileName = (s, ext) => `Harmony Horticulture SOP - ${String(s.title).replace(/[\\/:*?"<>|]+/g, "")}${s.version ? " v" + s.version : ""}.${ext}`;
  const audienceBadge = (s) => (s.audience === "admins" ? `<span class="sop-badge admins">Admins only</span>` : "");

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
    $$("[data-add]").forEach((b) => (b.onclick = () => openForm(null)));
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
      await route();
    } catch (e) {
      $("#loading").classList.add("hidden");
      showAuth(friendly(e));
    }
  }

  async function route() {
    const m = location.hash.match(/sop=([\w-]+)/);
    window.scrollTo(0, 0);
    try {
      state.sops = await S.list();
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

  function renderList() {
    const admin = isAdmin();
    const cats = categories().filter((c) => state.sops.some((s) => s.category === c && (!s.archived || state.showArchived)));
    $("#view").innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">Standard operating procedures</p><h1>SOPs</h1></div>
        ${admin ? `<button type="button" id="addBtn">+ Add an SOP</button>` : ""}
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
    if (admin) $("#addBtn").onclick = () => openForm(null);
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
      const hay = norm([s.title, s.sop_number, s.category, s.summary, s.search_text].join(" "));
      return words.every((w) => hay.includes(w));
    });
    const host = $("#sopResults");
    if (!state.sops.length) {
      host.innerHTML = `<div class="card sop-empty"><h2>No SOPs yet</h2><p class="muted">${isAdmin() ? "Add the first one with <b>+ Add an SOP</b>. Upload the PDF, and the Word file too if you have it." : "Your admin hasn't added any SOPs yet."}</p></div>`;
      return;
    }
    if (!rows.length) { host.innerHTML = `<div class="card sop-empty"><p class="muted">No SOPs match "${esc(state.q)}". Try fewer or different words.</p></div>`; return; }
    const groups = categories().map((c) => [c, rows.filter((s) => s.category === c)]).filter(([, list]) => list.length);
    host.innerHTML = groups.map(([c, list]) => `
      <h2 class="sop-group">${esc(c)}</h2>
      <div class="sop-grid">
        ${list.map((s) => {
          const inBody = words.length && !words.every((w) => norm([s.title, s.sop_number, s.category, s.summary].join(" ")).includes(w));
          return `<a class="sop-card ${s.archived ? "archived" : ""}" href="#sop=${esc(s.id)}">
            <div class="sop-card-top"><span class="sop-num">${esc(s.sop_number || "SOP")}</span>${audienceBadge(s)}${s.archived ? `<span class="sop-badge">Archived</span>` : ""}</div>
            <div class="sop-title">${esc(s.title)}</div>
            ${inBody ? `<div class="sop-snip">${snippet(s.search_text, words)}</div>` : s.summary ? `<div class="sop-sum">${esc(s.summary)}</div>` : ""}
            <div class="sop-meta">${s.version ? `Version ${esc(s.version)} · ` : ""}Updated ${esc(niceDate(s.updated_at))}</div>
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
    $("#view").innerHTML = `
      <p class="small"><a href="#" class="back-link">← All SOPs</a></p>
      <div class="card sop-head">
        <p class="eyebrow">${esc(s.category)}</p>
        <h1>${esc(s.title)}</h1>
        <p class="sop-meta">${[s.sop_number, s.version ? "Version " + s.version : "", "Updated " + niceDate(s.updated_at)].filter(Boolean).map(esc).join(" · ")} ${audienceBadge(s)}${s.archived ? `<span class="sop-badge">Archived</span>` : ""}</p>
        ${s.summary ? `<p class="sop-summary">${esc(s.summary)}</p>` : ""}
        <div class="btn-row">
          <button type="button" id="dlPdf">Download PDF</button>
          ${admin && s.word_path ? `<button type="button" class="secondary" id="dlWord">Word file</button>` : ""}
          ${admin && s.drive_url ? `<a class="btn secondary-link" href="${esc(s.drive_url)}" target="_blank" rel="noopener">Open in Google Drive ↗</a>` : ""}
          ${admin ? `<button type="button" class="secondary" id="editBtn">Update</button>` : ""}
        </div>
        ${admin ? `<div id="pastVersions" class="sop-versions"></div>` : ""}
      </div>
      <div id="pages" class="sop-pages" aria-label="${esc(s.title)}, page by page"><p class="muted sop-loading">Opening the SOP…</p></div>`;
    $("#dlPdf").onclick = async () => { try { download(await S.file(s.pdf_path), fileName(s, "pdf")); } catch (e) { fail(e); } };
    if ($("#dlWord")) $("#dlWord").onclick = async () => { try { download(await S.file(s.word_path), fileName(s, "docx")); } catch (e) { fail(e); } };
    if ($("#editBtn")) $("#editBtn").onclick = () => openForm(s);
    if (admin) drawVersions(s).catch(console.error);
    const token = ++renderToken;
    try {
      const blob = await S.file(s.pdf_path);
      await drawPages(blob, $("#pages"), token);
    } catch (e) {
      if (token === renderToken) $("#pages").innerHTML = `<div class="card"><p>${esc(friendly(e))}</p></div>`;
    }
  }

  // Each page is drawn as a picture that fits the screen, so it reads the
  // same on a phone as on a computer (phones don't show PDFs inside a page well)
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
    const foot = document.createElement("p");
    foot.className = "small muted sop-end";
    foot.textContent = `End of SOP · ${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`;
    host.appendChild(foot);
  }

  async function drawVersions(s) {
    const list = await S.versions(s.id);
    const host = $("#pastVersions");
    if (!host || !list.length) return;
    host.innerHTML = `<details><summary>Past versions (${list.length})</summary><ul>${list.map((v) => `
      <li>${v.version ? "Version " + esc(v.version) : "Earlier version"} · replaced ${esc(niceDate(v.replaced_at))}${v.replaced_by_name ? " by " + esc(v.replaced_by_name) : ""}
        <button type="button" class="ghost small" data-vpdf="${esc(v.pdf_path)}" data-vname="${esc(v.version)}">PDF</button>
        ${v.word_path ? `<button type="button" class="ghost small" data-vword="${esc(v.word_path)}" data-vname="${esc(v.version)}">Word</button>` : ""}
      </li>`).join("")}</ul></details>`;
    $$("[data-vpdf]", host).forEach((b) => (b.onclick = async () => { try { download(await S.file(b.dataset.vpdf), fileName({ ...s, version: b.dataset.vname }, "pdf")); } catch (e) { fail(e); } }));
    $$("[data-vword]", host).forEach((b) => (b.onclick = async () => { try { download(await S.file(b.dataset.vword), fileName({ ...s, version: b.dataset.vname }, "docx")); } catch (e) { fail(e); } }));
  }

  // The words inside the PDF, so search finds SOPs by what they say
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
    } catch (e) {
      console.warn("Couldn't read the PDF's text", e);
      return "";
    }
  }

  // =====================================================================
  // Admins: add or update an SOP
  // =====================================================================
  function openForm(s) {
    if (!isAdmin()) return;
    const isNew = !s;
    const v = s || { title: "", sop_number: "", category: state.cat || CATEGORIES[0], audience: "everyone", version: "1.0", summary: "", drive_url: "" };
    const { m, close } = modal(`
      <h2>${isNew ? "Add an SOP" : "Update " + esc(s.title)}</h2>
      <form id="sopForm">
        <div class="field"><label for="fTitle">Title <span class="req">*</span></label><input id="fTitle" required value="${esc(v.title)}" placeholder="Flower Planting Season"></div>
        <div class="grid2">
          <div class="field"><label for="fNum">SOP number</label><input id="fNum" value="${esc(v.sop_number)}" placeholder="HH-SOP-006"></div>
          <div class="field"><label for="fVer">Version</label><input id="fVer" value="${esc(v.version)}" placeholder="1.0"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="fCat">Category</label><input id="fCat" list="catList" value="${esc(v.category)}"><datalist id="catList">${categories().map((c) => `<option value="${esc(c)}">`).join("")}</datalist><div class="hint">Pick one or type a new category.</div></div>
          <div class="field"><label for="fAud">Who can see it</label><select id="fAud">
            <option value="everyone" ${v.audience === "everyone" ? "selected" : ""}>Everyone signed in</option>
            <option value="admins" ${v.audience === "admins" ? "selected" : ""}>Admins only</option>
          </select></div>
        </div>
        <div class="field"><label for="fSum">Short summary</label><textarea id="fSum" maxlength="400" style="min-height:64px" placeholder="One or two sentences on what this SOP covers">${esc(v.summary)}</textarea></div>
        <div class="field"><label for="fPdf">PDF ${isNew ? `<span class="req">*</span>` : ""}</label><input id="fPdf" type="file" accept="application/pdf,.pdf" ${isNew ? "required" : ""}>
          <div class="hint">${isNew ? "This is what everyone reads in the app." : "Only if the SOP changed. The current PDF is kept under Past versions."}</div></div>
        <div class="field"><label for="fWord">Word file (optional)</label><input id="fWord" type="file" accept=".docx,${WORD}">
          <div class="hint">The editable copy. Only admins can download it.</div></div>
        <div class="field"><label for="fDrive">Google Drive link (optional)</label><input id="fDrive" type="url" value="${esc(v.drive_url)}" placeholder="https://docs.google.com/…"></div>
        <p id="fErr" class="error-text"></p>
        <div class="btn-row" style="justify-content:space-between">
          <div>${!isNew ? `<button type="button" class="danger" id="fArch">${s.archived ? "Restore" : "Archive"}</button>` : ""}</div>
          <div class="btn-row"><button type="button" class="secondary" id="fCancel">Cancel</button><button type="submit" id="fSave">${isNew ? "Add SOP" : "Save"}</button></div>
        </div>
      </form>`);
    $("#fCancel", m).onclick = close;
    if ($("#fArch", m)) $("#fArch", m).onclick = async () => {
      try {
        await S.update(s.id, { archived: !s.archived });
        close(); toast(s.archived ? "SOP restored" : "SOP archived. It's hidden from everyone but admins.");
        location.hash = ""; await route();
      } catch (e) { fail(e); }
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
        const who = state.me.full_name || state.me.email;
        const fields = {
          title: $("#fTitle", m).value.trim(), sop_number: $("#fNum", m).value.trim(), version: $("#fVer", m).value.trim(),
          category: $("#fCat", m).value.trim() || CATEGORIES[0], audience: $("#fAud", m).value,
          summary: $("#fSum", m).value.trim(), drive_url: drive,
        };
        const id = isNew ? uid() : s.id;
        if (pdf || word) {
          fields.updated_at = new Date().toISOString();
          fields.updated_by = LIVE ? state.me.id : null;
          fields.updated_by_name = who;
        }
        if (!isNew && (pdf || word)) {
          await S.addVersion({ sop_id: s.id, version: s.version, pdf_path: s.pdf_path, word_path: s.word_path, was_updated_at: s.updated_at, replaced_by_name: who });
        }
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
