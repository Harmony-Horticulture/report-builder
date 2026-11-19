// =====================================================================
// Harmony Horticulture Report Builder: the screens
// Story numbers (RC-xx) refer to the Report tab of the user stories.
// =====================================================================
(function () {
  const S = window.Store;
  const R = window.Report;
  const X = window.Exports;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = R.esc;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  const state = {
    me: null, clients: [], types: [], settings: { ai_polish_enabled: false, dictation_terms: [] },
    people: [], report: null, saveTimer: null, saving: null, dirty: false, filters: {},
    punchOpen: new Set(), punchHideDone: false,
  };
  const isAdmin = () => state.me && state.me.role === "admin";

  // --- little UI helpers -----------------------------------------------
  let toastTimer;
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), isError ? 6000 : 3200);
  }
  const fail = (e) => { console.error(e); toast(S.friendlyError(e), true); };

  function modal(html, { wide } = {}) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-back"><div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div></div>`;
    const m = $(".modal", root);
    const close = () => { root.innerHTML = ""; };
    $(".modal-back", root).addEventListener("click", (e) => { if (e.target.classList.contains("modal-back")) close(); });
    return { m, close };
  }
  function confirmBox(title, text, yes = "Yes", danger) {
    return new Promise((resolve) => {
      const { m, close } = modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p>
        <div class="btn-row" style="justify-content:flex-end"><button class="secondary" data-no>Cancel</button><button class="${danger ? "danger" : ""}" data-yes>${esc(yes)}</button></div>`);
      $("[data-yes]", m).onclick = () => { close(); resolve(true); };
      $("[data-no]", m).onclick = () => { close(); resolve(false); };
    });
  }
  const statusBadge = (s) => `<span class="status ${esc(s)}">${{ draft: "Draft", review: "Review", sent: "Sent" }[s] || esc(s)}</span>`;
  const todayIso = () => S.isoDate(new Date());

  // =====================================================================
  // Sign in (RC-01, RC-02)
  // =====================================================================
  function showAuth(html) {
    $("#loading").classList.add("hidden");
    $("#appView").classList.add("hidden");
    $("#authView").classList.remove("hidden");
    $("#authContent").innerHTML = html;
    addPasswordPeek($("#authContent"));
  }
  // A Show button inside each password box: tap to see what was typed, tap again to hide
  function addPasswordPeek(root) {
    $$('input[type="password"]', root).forEach((inp) => {
      const wrap = document.createElement("div");
      wrap.className = "pw-wrap";
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);
      const b = document.createElement("button");
      b.type = "button"; b.className = "pw-eye"; b.textContent = "Show"; b.setAttribute("aria-label", "Show password");
      b.onclick = () => {
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        b.textContent = show ? "Hide" : "Show";
        b.setAttribute("aria-label", show ? "Hide password" : "Show password");
      };
      wrap.appendChild(b);
    });
  }

  function renderSignIn(message) {
    if (S.mode === "demo") {
      const people = S.demoPeople();
      showAuth(`
        <h1>Welcome</h1>
        <p class="muted small" style="text-align:center">Demo mode. Pick someone to try the app as. Nothing here is saved online or emailed.</p>
        ${people.map((p) => `<button class="primary ${p.role === "admin" ? "" : "secondary"}" data-as="${esc(p.id)}" style="margin-bottom:8px">Sign in as ${esc(p.full_name)} · ${p.role}</button>`).join("")}
        <p class="hint" style="text-align:center">Robbie hasn't filled in a profile yet, so the first-time profile screen comes up.</p>
      `);
      $$("[data-as]").forEach((b) => (b.onclick = () => S.signInAs(b.dataset.as)));
      return;
    }
    showAuth(`
      <h1>Sign in</h1>
      ${message ? `<p class="small" style="color:var(--green);text-align:center">${esc(message)}</p>` : ""}
      <form id="signinForm" novalidate>
        <div class="field"><label for="siEmail">Email</label><input id="siEmail" type="email" autocomplete="username" required></div>
        <div class="field"><label for="siPass">Password</label><input id="siPass" type="password" autocomplete="current-password" required></div>
        <div id="siError" class="error-text"></div>
        <button class="primary" type="submit">Sign in</button>
      </form>
      <p class="small" style="text-align:center;margin-top:16px"><a href="#" id="forgotLink">Forgot your password?</a></p>
      <p class="hint" style="text-align:center">Same login as the Time Tracker. This app is invite-only: ask an admin for an invitation.</p>
    `);
    $("#signinForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const email = $("#siEmail").value.trim(), pass = $("#siPass").value;
      if (!email || !pass) { $("#siError").textContent = "Enter your email and password."; return; }
      try { await S.signIn(email, pass); } catch (e) { $("#siError").textContent = S.friendlyError(e); }
    };
    $("#forgotLink").onclick = (e) => { e.preventDefault(); renderForgot($("#siEmail").value); };
  }

  function renderForgot(email) {
    showAuth(`
      <h1>Reset password</h1>
      <p class="small muted">We'll email you a link to choose a new password.</p>
      <div class="field"><label for="fpEmail">Email</label><input id="fpEmail" type="email" value="${esc(email || "")}"></div>
      <button class="primary" id="fpSend">Email me a reset link</button>
      <p class="small" style="text-align:center;margin-top:16px"><a href="#" id="backSignIn">Back to sign in</a></p>`);
    $("#fpSend").onclick = async () => {
      try { await S.sendPasswordReset($("#fpEmail").value); renderSignIn("Check your email for the reset link."); } catch (e) { fail(e); }
    };
    $("#backSignIn").onclick = (e) => { e.preventDefault(); renderSignIn(); };
  }

  function renderSetPassword() {
    showAuth(`
      <h1>Choose a password</h1>
      <p class="small muted" style="text-align:center">Pick a new password for your account (at least 8 characters). It works for both Reports and the Time Tracker.</p>
      <div class="field"><label for="np1">New password</label><input id="np1" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="np2">Type it again</label><input id="np2" type="password" autocomplete="new-password"></div>
      <div id="npErr" class="error-text"></div>
      <button class="primary" id="npSave">Save password</button>
      <p class="small" style="text-align:center;margin-top:16px"><a href="#" id="npOut">Not you, or remembered it? Sign out</a></p>`);
    $("#npOut").onclick = async (e) => { e.preventDefault(); try { await S.signOut(); } catch (x) { /* already out */ } state.me = null; renderSignIn(); };
    $("#npSave").onclick = async () => {
      const a = $("#np1").value, b = $("#np2").value;
      if (a.length < 8) { $("#npErr").textContent = "Use at least 8 characters."; return; }
      if (a !== b) { $("#npErr").textContent = "The two passwords don't match."; return; }
      try { await S.setPassword(a); boot(); } catch (e) { $("#npErr").textContent = S.friendlyError(e); }
    };
  }

  // =====================================================================
  // Shell and navigation (prototype sidebar: Dashboard / New Report / Profile)
  // =====================================================================
  const NAV = [
    { route: "dashboard", label: "Dashboard" },
    { route: "new", label: "New Report" },
    { route: "profile", label: "Profile" },
    { route: "team", label: "Team", admin: true },
    { route: "clients", label: "Clients", admin: true },
    { route: "settings", label: "Settings", admin: true },
  ];
  function renderShell() {
    $("#loading").classList.add("hidden");
    $("#authView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    $("#whoName").textContent = state.me.full_name || state.me.email;
    $("#whoRole").textContent = { admin: "Admin", technician: "Technician" }[state.me.role] || "Consultant";
    $("#demoBanner").classList.toggle("hidden", S.mode !== "demo");
    const items = NAV.filter((n) => !n.admin || isAdmin());
    $("#sideNav").innerHTML = items.map((n, i) =>
      (n.admin && !items[i - 1].admin ? `<div class="nav-label">Admin</div>` : "") + `<button type="button" data-route="${n.route}">${n.label}</button>`).join("");
    // Link over to the Time Tracker, for every role
    const tt = esc((window.HH_CONFIG && window.HH_CONFIG.TIME_TRACKER_URL) || "https://harmony-horticulture.github.io/time-tracker/");
    $("#sideNav").innerHTML += `<div class="nav-label">Apps</div><a class="nav-link" href="${tt}">Time tracker ↗</a>`;
    $("#bottomNav").innerHTML = items.map((n) => `<button type="button" data-route="${n.route}">${n.label}</button>`).join("") + `<a class="nav-link" href="${tt}">Time</a>`;
    $$("[data-route]").forEach((b) => (b.onclick = () => go(b.dataset.route)));
  }
  function setActive(route) {
    $$("[data-route]").forEach((b) => b.classList.toggle("active", b.dataset.route === route));
  }
  function go(route) {
    if (location.hash === "#/" + route) onRoute(); else location.hash = "#/" + route;
  }

  async function onRoute() {
    if (!state.me) return;
    await flushSave();
    const [route, id] = location.hash.replace(/^#\/?/, "").split("/");
    window.scrollTo(0, 0);
    // First sign-in: ask for name, title and credentials (RC-04)
    if (!state.me.full_name || !state.me.title) { setActive("profile"); return renderProfile(true); }
    try {
      if (route === "new") { setActive("new"); return renderTypePicker(); }
      if (route === "report" && id) { setActive("dashboard"); return await renderEditor(id); }
      if (route === "review" && id) { setActive("dashboard"); return await renderReview(id); }
      if (route === "profile") { setActive("profile"); return renderProfile(false); }
      if (route === "team" && isAdmin()) { setActive("team"); return await renderTeam(); }
      if (route === "clients" && isAdmin()) { setActive("clients"); return await renderClients(); }
      if (route === "settings" && isAdmin()) { setActive("settings"); return await renderSettings(); }
      setActive("dashboard");
      return await renderDashboard();
    } catch (e) { fail(e); }
  }
  window.addEventListener("hashchange", onRoute);

  // =====================================================================
  // Dashboard and report library (RC-03, RC-29)
  // =====================================================================
  async function renderDashboard() {
    const view = $("#view");
    view.innerHTML = `<p class="muted">Loading reports…</p>`;
    const reports = await S.listReports();
    const f = state.filters;
    const consultants = [...new Map(reports.map((r) => [r.user_id, (r.consultant && r.consultant.name) || "Unknown"])).entries()];
    const types = [...new Set(reports.map((r) => r.type_name))];
    view.innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">${isAdmin() ? "Everyone's reports" : "My reports"}</p><h1>Dashboard</h1></div>
        <button id="newBtn">+ New Report</button>
      </div>
      <div class="card">
        <div class="filters">
          <div class="wide"><label for="fq">Search client or property</label><input id="fq" value="${esc(f.q || "")}" placeholder="Type a name"></div>
          <div><label for="fs">Status</label><select id="fs"><option value="">All</option>${["draft", "review", "sent"].map((s) => `<option value="${s}" ${f.status === s ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select></div>
          <div><label for="ft">Type</label><select id="ft"><option value="">All</option>${types.map((t) => `<option ${f.type === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
          ${isAdmin() ? `<div><label for="fc">Consultant</label><select id="fc"><option value="">All</option>${consultants.map(([id, n]) => `<option value="${esc(id)}" ${f.user === id ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>` : ""}
          <div><label for="ff">From</label><input id="ff" type="date" value="${esc(f.from || "")}"></div>
          <div><label for="fto">To</label><input id="fto" type="date" value="${esc(f.to || "")}"></div>
        </div>
      </div>
      <div class="card"><div id="rlist" class="rlist"></div></div>`;
    $("#newBtn").onclick = () => go("new");
    const draw = () => {
      const q = (f.q || "").toLowerCase();
      const rows = reports.filter((r) =>
        (!q || `${r.client_name} ${r.property} ${r.community}`.toLowerCase().includes(q)) &&
        (!f.status || r.status === f.status) && (!f.type || r.type_name === f.type) &&
        (!f.user || r.user_id === f.user) && (!f.from || r.report_date >= f.from) && (!f.to || r.report_date <= f.to));
      $("#rlist").innerHTML = rows.length
        ? rows.map((r) => `
          <div class="row" data-open="${esc(r.id)}" data-status="${esc(r.status)}" tabindex="0">
            <div>
              <div class="t">${esc(r.property || r.client_name || "No client yet")}</div>
              <div class="m">${esc(r.type_name)} · ${esc(R.niceDate(r.report_date))}${isAdmin() ? ` · ${esc((r.consultant && r.consultant.name) || "")}` : ""}${r.version > 1 ? ` · version ${r.version}` : ""}${r.status === "sent" && r.sent_to ? ` · sent to ${esc(r.sent_to)}` : ""}</div>
            </div>
            <div>${statusBadge(r.status)}</div>
          </div>`).join("")
        : `<p class="muted">${reports.length ? "No reports match these filters." : "No reports yet. Tap New Report to start one."}</p>`;
      $$("[data-open]").forEach((el) => {
        const open = () => go((el.dataset.status === "draft" ? "report/" : "review/") + el.dataset.open);
        el.onclick = open;
        el.onkeydown = (e) => { if (e.key === "Enter") open(); };
      });
    };
    const bind = (id, key) => { const el = $(id); if (el) el.oninput = el.onchange = () => { f[key] = el.value; draw(); }; };
    bind("#fq", "q"); bind("#fs", "status"); bind("#ft", "type"); bind("#fc", "user"); bind("#ff", "from"); bind("#fto", "to");
    draw();
  }

  // =====================================================================
  // New report: pick a type first (RC-05)
  // =====================================================================
  function renderTypePicker() {
    const types = state.types.filter((t) => t.active !== false);
    $("#view").innerHTML = `
      <div class="page-head"><div><p class="eyebrow">New report</p><h1>What kind of report?</h1></div></div>
      <div class="type-grid">
        ${types.map((t) => `
          <button class="type-card" data-type="${esc(t.id)}">
            <h3>${esc(t.name)}</h3>
            <div class="small muted">${esc(t.description || "")}</div>
            <div class="secs">${t.sections.map((s) => esc(s.title)).join(" · ")}</div>
          </button>`).join("")}
      </div>
      ${isAdmin() ? `<p class="small muted" style="margin-top:16px">Admins can add or change report types under Settings.</p>` : ""}`;
    $$("[data-type]").forEach((b) => (b.onclick = () => startReport(b.dataset.type)));
  }

  const consultantOf = (p) => ({ name: p.full_name, title: p.title || "", credentials: p.credentials || "", email: p.email, phone: p.phone || "" });

  function emptyContent(sections) {
    const c = {};
    for (const s of sections) c[s.key] = s.kind === "notes" ? { text: "" } : { items: [] };
    return c;
  }

  async function startReport(typeId) {
    const t = state.types.find((x) => x.id === typeId);
    try {
      const sections = JSON.parse(JSON.stringify(t.sections));
      const r = await S.createReport({
        type_id: t.id, type_name: t.name, sections, client_id: null, client_name: "", property: "", community: "",
        contact_name: "", contact_email: "", report_date: todayIso(), consultant: consultantOf(state.me),
        content: emptyContent(sections), status: "draft", version: 1,
      });
      location.hash = "#/report/" + r.id;
    } catch (e) { fail(e); }
  }

  // =====================================================================
  // Editor (RC-09 to RC-17)
  // =====================================================================
  const hasAnyContent = (r) => (r.sections || []).some((s) => R.sectionHasContent(s, r.content[s.key]));

  function scheduleSave() {
    state.dirty = true;
    const el = $("#savedState");
    if (el) { el.textContent = "Saving…"; el.classList.add("saving"); }
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => flushSave(), 1200);
  }
  async function flushSave() {
    clearTimeout(state.saveTimer);
    if (state.saving) await state.saving;
    if (!state.dirty || !state.report) return;
    state.dirty = false;
    const r = state.report;
    state.saving = (async () => {
      try {
        await S.saveReport(r);
        const el = $("#savedState");
        if (el) { el.textContent = "Saved"; el.classList.remove("saving"); }
      } catch (e) {
        state.dirty = true;
        const el = $("#savedState");
        if (el) el.textContent = "Not saved yet";
        fail(e);
      }
    })();
    await state.saving;
    state.saving = null;
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSave(); });
  window.addEventListener("pagehide", () => flushSave());

  // Field paths: "head:property", "sec:overview:text", "item:observations:<id>:recommendation"
  function getPath(r, path) {
    const p = path.split(":");
    if (p[0] === "head") return r[p[1]] || "";
    if (p[0] === "sec") return (r.content[p[1]] || {}).text || "";
    if (p[0] === "secf") return (r.content[p[1]] || {})[p[2]] || "";
    if (p[0] === "item") { const it = ((r.content[p[1]] || {}).items || []).find((i) => i.id === p[2]); return it ? it[p[3]] || "" : ""; }
    return "";
  }
  function setPath(r, path, value) {
    const p = path.split(":");
    if (p[0] === "head") r[p[1]] = value;
    if (p[0] === "sec") { r.content[p[1]] = r.content[p[1]] || {}; r.content[p[1]].text = value; }
    if (p[0] === "secf") { r.content[p[1]] = r.content[p[1]] || {}; r.content[p[1]][p[2]] = value; }
    if (p[0] === "item") { const it = r.content[p[1]].items.find((i) => i.id === p[2]); if (it) it[p[3]] = value; }
  }

  const fmtBar = (path) => `<div class="fmt-bar"><button type="button" data-fmt="bold" data-for="${esc(path)}"><b>B</b> Bold</button><button type="button" data-fmt="bullet" data-for="${esc(path)}">• Bullet</button></div>`;
  function textArea(path, value, { placeholder = "", rows = 4, fmt = true, label } = {}) {
    const id = "f_" + path.replace(/[^a-z0-9]/gi, "_");
    return `<div class="field">${label ? `<label for="${id}">${esc(label)}</label>` : ""}${fmt ? fmtBar(path) : ""}
      <div class="with-mic"><textarea id="${id}" data-path="${esc(path)}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value || "")}</textarea>
      <button type="button" class="mic" data-mic="${esc(path)}" title="Dictate" aria-label="Dictate">🎤</button></div></div>`;
  }

  async function renderEditor(id) {
    const r = await S.getReport(id);
    state.report = r;
    if (r.status === "sent") return renderReview(id);
    r.content = r.content || {};
    for (const s of r.sections) if (!r.content[s.key]) r.content[s.key] = s.kind === "notes" ? { text: "" } : { items: [] };
    await drawEditor();
  }

  async function drawEditor() {
    const r = state.report;
    const view = $("#view");
    const canChangeType = !hasAnyContent(r);
    const client = state.clients.find((c) => c.id === r.client_id);
    const props = client ? client.properties || [] : [];
    // Photo URLs for thumbnails
    const urls = {};
    for (const s of r.sections) for (const it of (r.content[s.key].items || [])) if (it.photo) urls[it.photo.id] = await S.photoUrl(it.photo);

    view.innerHTML = `
      <div class="toolbar">
        <div><span class="eyebrow">${esc(r.type_name)}</span> ${statusBadge(r.status)} <span id="savedState" class="saved-state">Saved</span></div>
        <div class="btn-row">
          ${S.mode === "demo" || isAdmin() ? `<button class="secondary small" id="sampleBtn" type="button">Fill with sample data</button>` : ""}
          <button class="secondary small" id="delBtn" type="button">Delete draft</button>
          <button id="previewBtn" type="button">Preview</button>
        </div>
      </div>
      ${r.version > 1 ? `<div class="notice">This is version ${r.version}. It needs to be sent again once it's ready.</div>` : ""}

      <div class="card">
        <h2>Report details</h2>
        ${canChangeType ? `<div class="field"><label for="typeSel">Report type</label><select id="typeSel">${state.types.filter((t) => t.active !== false || t.id === r.type_id).map((t) => `<option value="${esc(t.id)}" ${t.id === r.type_id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select><div class="hint">You can switch types until you add notes, photos or priorities.</div></div>` : ""}
        <div class="field">
          <label for="clientSearch">Client / property <span class="req">*</span></label>
          ${client ? `<div class="chosen"><span>${esc(client.name)}</span><button type="button" class="ghost small" id="clearClient">Change</button></div>`
            : `<input id="clientSearch" autocomplete="off" placeholder="Type 2 or more letters of the client name"><div id="clientResults"></div>`}
        </div>
        <div class="grid2">
          <div class="field"><label for="hProperty">Property</label>
            ${props.length > 1 ? `<select id="hProperty" data-path="head:property">${props.map((p) => `<option ${p === r.property ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>`
              : `<input id="hProperty" data-path="head:property" value="${esc(r.property)}">`}</div>
          <div class="field"><label for="hCommunity">HOA or community (optional)</label><input id="hCommunity" data-path="head:community" value="${esc(r.community)}"></div>
          <div class="field"><label for="hContact">Contact person</label><input id="hContact" data-path="head:contact_name" value="${esc(r.contact_name)}" placeholder="Used to greet them in the email"></div>
          <div class="field"><label for="hEmail">Contact email</label><input id="hEmail" type="email" data-path="head:contact_email" value="${esc(r.contact_email)}"></div>
          <div class="field"><label>Consultant</label><input value="${esc(r.consultant.name)}" disabled></div>
          <div class="field"><label for="hDate">Date</label><input id="hDate" type="date" data-path="head:report_date" value="${esc(r.report_date)}"></div>
        </div>
      </div>

      ${r.sections.map((s) => sectionEditor(s, r.content[s.key], urls)).join("")}

      <div class="btn-row" style="justify-content:flex-end"><button id="previewBtn2" type="button">Preview report</button></div>`;

    bindEditor();
  }

  function sectionEditor(s, c, urls) {
    let inner = "";
    if (s.kind === "notes") inner = textArea(`sec:${s.key}:text`, c.text, { placeholder: "Type or dictate notes", rows: 5 });
    if (s.kind === "observations" || s.kind === "photos") {
      inner = (c.items || []).map((it, i) => `
        <div class="item" data-item="${esc(it.id)}">
          <div class="item-head"><span class="num">${s.kind === "photos" ? "Photo" : "Observation"} ${i + 1}</span>
            <div class="item-tools">
              <button type="button" data-move="-1" data-sec="${esc(s.key)}" data-id="${esc(it.id)}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
              <button type="button" data-move="1" data-sec="${esc(s.key)}" data-id="${esc(it.id)}" ${i === c.items.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
              <button type="button" data-remove data-sec="${esc(s.key)}" data-id="${esc(it.id)}" aria-label="Remove">✕</button>
            </div></div>
          <div class="item-grid">
            <div class="photo-box">
              ${it.photo ? `<img src="${esc(urls[it.photo.id] || "")}" alt="">` : `<span class="small muted">${s.kind === "photos" ? "Add a photo" : "Photo (optional)"}</span>`}
              <div class="btn-row">
                ${useWebcam()
                  ? `<button type="button" data-webcam data-sec="${esc(s.key)}" data-id="${esc(it.id)}">${it.photo ? "Retake" : "Camera"}</button>`
                  : `<label class="btn"><input type="file" accept="image/*" capture="environment" data-photo data-sec="${esc(s.key)}" data-id="${esc(it.id)}">${it.photo ? "Retake" : "Camera"}</label>`}
                <label class="btn secondary"><input type="file" accept="image/*" data-photo data-sec="${esc(s.key)}" data-id="${esc(it.id)}">${useWebcam() ? "Upload photo" : "Library"}</label>
              </div>
              ${it.photo ? `<button type="button" class="ghost small" data-nophoto data-sec="${esc(s.key)}" data-id="${esc(it.id)}">No photo</button>` : ""}
            </div>
            <div>
              ${s.kind === "photos"
                ? textArea(`item:${s.key}:${it.id}:note`, it.note, { placeholder: "Short note about this photo", rows: 3, label: "Note" })
                : textArea(`item:${s.key}:${it.id}:text`, it.text, { placeholder: "What you saw", rows: 3, label: "Observation" }) +
                  textArea(`item:${s.key}:${it.id}:recommendation`, it.recommendation, { placeholder: "What should be done", rows: 3, label: "Recommendation" })}
            </div>
          </div>
        </div>`).join("");
      inner += s.kind === "photos"
        ? `<div class="btn-row"><button type="button" data-add data-sec="${esc(s.key)}">+ Add Photo</button>
             <label class="btn secondary" style="margin:0">Add several from library<input type="file" accept="image/*" multiple data-multi data-sec="${esc(s.key)}" style="display:none"></label></div>`
        : `<button type="button" data-add data-sec="${esc(s.key)}">+ Add Observation</button>`;
    }
    if (s.kind === "punchlist") inner = punchEditor(s, c, urls);
    if (s.kind === "priorities") {
      for (const t of R.TIERS) {
        const items = (c.items || []).filter((i) => (i.tier || "p1") === t.key);
        // Priority 1, 2 and Future always show; Priority 3 to 5 once something is added there
        if (!items.length && !["p1", "p2", "future"].includes(t.key)) continue;
        inner += `<div class="tier-label">${esc(t.label)} · ${esc(t.sub)}</div>`;
        inner += items.map((it, i) => `
          <div class="prio-row">
            <select data-tier data-sec="${esc(s.key)}" data-id="${esc(it.id)}" aria-label="Priority">${R.TIERS.map((x) => `<option value="${x.key}" ${x.key === t.key ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select>
            ${textArea(`item:${s.key}:${it.id}:text`, it.text, { placeholder: "What needs to happen", rows: 2, fmt: false })}
            <div class="item-tools">
              <button type="button" data-move="-1" data-tiered data-sec="${esc(s.key)}" data-id="${esc(it.id)}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
              <button type="button" data-move="1" data-tiered data-sec="${esc(s.key)}" data-id="${esc(it.id)}" ${i === items.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
              <button type="button" data-remove data-sec="${esc(s.key)}" data-id="${esc(it.id)}" aria-label="Remove">✕</button>
            </div>
          </div>`).join("");
        // Each priority level can hold as many items as needed
        inner += `<div class="btn-row" style="margin:4px 0 14px"><button type="button" class="secondary small" data-addprio="${t.key}" data-sec="${esc(s.key)}">+ ${items.length ? "Add another" : `Add ${esc(t.label)}`}</button></div>`;
      }
      // Any level, including Priority 3 to 5
      inner += `<div class="add-level"><label for="lvl_${esc(s.key)}">Add to priority level</label>
        <div class="btn-row"><select id="lvl_${esc(s.key)}" data-level-for="${esc(s.key)}">${R.TIERS.map((x) => `<option value="${x.key}">${esc(x.label)}</option>`).join("")}</select>
        <button type="button" class="secondary small" data-addlevel data-sec="${esc(s.key)}">+ Add</button></div></div>`;
    }
    return `<div class="card sec-card" id="sec_${esc(s.key)}"><h2>${esc(s.title)}</h2>${s.help ? `<p class="sec-help">${esc(s.help)}</p>` : ""}${inner}</div>`;
  }

  // Punch list (estate inspections): one compact row per task, tap to edit.
  // Items are grouped by inspection date; open items can come over from last month.
  const firstLine = (t) => String(t || "").split("\n").map((l) => l.replace(/^\s*[-•*]\s+/, "").replace(/\*\*/g, "").trim()).find(Boolean) || "";
  const newPunchItem = (date) => ({ id: uid(), photo: null, date, text: "", note: "", tier: "", assigned: "", status: "open", approval: "no", carried: "" });
  // Location of a punch list item (where its photo was taken)
  const wantsLoc = (secKey) => { const sec = state.report.sections.find((x) => x.key === secKey); return !!sec && sec.kind === "punchlist"; };
  let locDeniedShown = false;
  function setLoc(it, loc) {
    if (loc && loc.denied) {
      if (!locDeniedShown) { locDeniedShown = true; setTimeout(() => toast("Location is turned off for this site, so the photo has no map pin. Allow location in the browser settings to add one.", true), 1500); }
      return;
    }
    if (Geo.has(loc)) it.loc = loc;
  }
  // The location arrives after the photo (the phone may still be asking
  // for permission), so the photo is never held up by it
  async function attachLoc(it, locP) {
    const loc = await Promise.race([locP, new Promise((r) => setTimeout(() => r(null), 30000))]);
    setLoc(it, loc);
    if (!Geo.has(it.loc) || !state.report) return;
    scheduleSave();
    const typing = document.activeElement && /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName);
    if (!typing && $(`[data-pid="${CSS.escape(it.id)}"]`)) await redraw();
  }
  const locNote = (loc) => (loc.src === "photo" ? "(from the photo)" : loc.acc ? `(within about ${loc.acc} m)` : "");
  function punchEditor(s, c, urls) {
    const r = state.report;
    const items = c.items || [];
    const k = esc(s.key);
    const hide = state.punchHideDone;
    const names = [...new Set(items.map((i) => String(i.assigned || "").trim()).filter(Boolean))].sort();
    const groups = [];
    for (const it of items) {
      let g = groups.find((x) => x.date === (it.date || ""));
      if (!g) groups.push((g = { date: it.date || "", items: [] }));
      g.items.push(it);
    }
    groups.sort((a, b) => (a.date ? (b.date ? a.date.localeCompare(b.date) : -1) : 1));
    const opt = (list, v) => list.map(([val, l]) => `<option value="${esc(val)}" ${val === (v || "") ? "selected" : ""}>${esc(l)}</option>`).join("");
    const TIER_OPTS = [["", "No priority"], ...R.TIERS.map((t) => [t.key, t.label])];
    const STATUS_OPTS = R.STATUSES.map((x) => [x.key, x.label]);
    const done = items.filter((i) => i.status === "done").length;

    let html = `<div class="punch-tools">
        <div class="field"><label for="pdate_${k}">Inspection date for new items</label><input id="pdate_${k}" type="date" data-path="secf:${k}:newDate" value="${esc(c.newDate || r.report_date)}"></div>
        <div class="btn-row">
          <button type="button" class="secondary small" data-carry data-sec="${k}">Bring over open items from last punch list</button>
          ${done ? `<button type="button" class="ghost small" data-hidedone>${hide ? `Show ${done} complete` : `Hide ${done} complete`}</button>` : ""}
        </div>
        ${items.length ? `<p class="small muted" style="margin:6px 0 0">${esc(R.punchCounts(items))}</p>` : ""}
      </div>`;
    for (const g of groups) {
      const shown = g.items.filter((it) => !(hide && it.status === "done"));
      html += `<div class="tier-label">${esc(g.date ? `Inspection ${R.niceDate(g.date)}` : "No inspection date")} · ${g.items.length} item${g.items.length === 1 ? "" : "s"}</div>`;
      html += shown.map((it) => {
        const i = g.items.indexOf(it);
        const id = esc(it.id);
        const st = it.status || "open";
        return `<details class="punch-item st-${esc(st)}" data-pid="${id}" ${state.punchOpen.has(it.id) ? "open" : ""}>
          <summary>
            <span class="ps-thumb">${it.photo ? `<img src="${esc(urls[it.photo.id] || "")}" alt="">` : ""}</span>
            <span class="ps-main"><span class="ps-text">${esc(firstLine(it.text) || "New item")}</span>
              <span class="ps-meta">${esc([R.tierShort(it.tier), it.assigned, it.approval === "yes" ? "Approval needed" : "", it.carried ? `From ${R.shortDate(it.carried)}` : "", Geo.has(it.loc) ? "📍" : ""].filter(Boolean).join(" · "))}</span></span>
            <button type="button" class="ps-status" data-cycle data-sec="${k}" data-id="${id}" title="Tap to change status">${esc(R.statusLabel(st))}</button>
          </summary>
          <div class="punch-body">
            <div class="photo-box small-box">
              ${it.photo ? `<img src="${esc(urls[it.photo.id] || "")}" alt="">` : `<span class="small muted">Photo (optional)</span>`}
              <div class="btn-row">
                ${useWebcam()
                  ? `<button type="button" data-webcam data-sec="${k}" data-id="${id}">${it.photo ? "Retake" : "Camera"}</button>`
                  : `<label class="btn"><input type="file" accept="image/*" capture="environment" data-photo data-sec="${k}" data-id="${id}">${it.photo ? "Retake" : "Camera"}</label>`}
                <label class="btn secondary"><input type="file" accept="image/*" data-photo data-sec="${k}" data-id="${id}">${useWebcam() ? "Upload photo" : "Library"}</label>
              </div>
              ${it.photo ? `<button type="button" class="ghost small" data-nophoto data-sec="${k}" data-id="${id}">No photo</button>` : ""}
              <div class="loc-row">${Geo.has(it.loc)
                ? `📍 <a href="${esc(Geo.mapUrl(it.loc))}" target="_blank" rel="noopener">Open in Maps</a> <span class="muted">${esc(locNote(it.loc))}</span>
                   <button type="button" class="ghost small" data-lochere data-sec="${k}" data-id="${id}">Update</button><button type="button" class="ghost small" data-locclear data-sec="${k}" data-id="${id}">Remove</button>`
                : `<button type="button" class="secondary small" data-lochere data-sec="${k}" data-id="${id}">📍 Use my location</button>`}</div>
            </div>
            <div>
              ${textArea(`item:${s.key}:${it.id}:text`, it.text, { placeholder: "What needs to be done", rows: 2, label: "Task" })}
              ${textArea(`item:${s.key}:${it.id}:note`, it.note, { placeholder: "Optional notes", rows: 2, label: "Notes", fmt: false })}
              <div class="punch-grid">
                <div class="field"><label>Priority</label><select data-path="item:${k}:${id}:tier" data-redraw>${opt(TIER_OPTS, it.tier)}</select></div>
                <div class="field"><label>Status</label><select data-path="item:${k}:${id}:status" data-redraw>${opt(STATUS_OPTS, st)}</select></div>
                <div class="field"><label>Assigned to</label><input data-path="item:${k}:${id}:assigned" data-redraw value="${esc(it.assigned || "")}" list="pnames_${k}" placeholder="Name or team"></div>
                <div class="field"><label>Approval</label><select data-path="item:${k}:${id}:approval" data-redraw>${opt([["no", "Not needed"], ["yes", "Needed"]], it.approval || "no")}</select></div>
                <div class="field"><label>Inspection date</label><input type="date" data-path="item:${k}:${id}:date" data-redraw value="${esc(it.date || "")}"></div>
              </div>
              <div class="item-tools" style="justify-content:flex-end">
                <button type="button" data-move="-1" data-bydate data-sec="${k}" data-id="${id}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
                <button type="button" data-move="1" data-bydate data-sec="${k}" data-id="${id}" ${i === g.items.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
                <button type="button" data-remove data-sec="${k}" data-id="${id}" aria-label="Remove">✕</button>
              </div>
            </div>
          </div>
        </details>`;
      }).join("");
    }
    html += `<datalist id="pnames_${k}">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
    html += `<div class="btn-row" style="margin-top:12px"><button type="button" data-addpunch data-sec="${k}">+ Add item</button>
      <label class="btn secondary" style="margin:0">Add several photos<input type="file" accept="image/*" multiple data-multi data-sec="${k}" style="display:none"></label></div>`;
    return html;
  }

  // Copy the open (not complete) items from this client's last punch list.
  // Photos are copied into this report so each report keeps its own.
  async function carryOver(secKey) {
    const r = state.report;
    if (!r.client_name) { toast("Pick the client first.", true); return; }
    const list = (await S.listReports())
      .filter((x) => x.id !== r.id && x.client_name === r.client_name && x.type_name === r.type_name)
      .sort((a, b) => ((b.report_date || "") + b.updated_at).localeCompare((a.report_date || "") + a.updated_at));
    const earlier = list.filter((x) => !r.report_date || (x.report_date || "") <= r.report_date);
    const last = earlier[0] || list[0];
    if (!last) { toast(`No earlier ${r.type_name} for ${r.client_name} yet.`, true); return; }
    const prev = await S.getReport(last.id);
    const mine = sectionItems(secKey);
    const have = new Set(mine.map((i) => i.from).filter(Boolean));
    const open = [];
    for (const sec of prev.sections || []) {
      if (sec.kind !== "punchlist") continue;
      for (const it of ((prev.content || {})[sec.key] || {}).items || []) {
        if (it.status === "done" || !(it.photo || String(it.text || it.note || "").trim())) continue;
        if (have.has(it.from || it.id)) continue;
        open.push(it);
      }
    }
    if (!open.length) { toast(`Everything on the ${R.niceDate(prev.report_date)} punch list is complete or already here.`); return; }
    if (!(await confirmBox("Bring over open items?", `${open.length} item${open.length === 1 ? " is" : "s are"} still open or in progress on the ${R.niceDate(prev.report_date)} punch list. They'll be added here with their photos, priority, assigned to and status, marked as carried over.`, "Bring them over"))) return;
    toast(`Bringing over ${open.length} item${open.length === 1 ? "" : "s"}…`);
    for (const it of open) {
      let photo = null;
      if (it.photo) {
        try {
          const url = await S.photoUrl(it.photo);
          if (url) photo = { ...(await S.uploadPhoto(r.id, await (await fetch(url)).blob())), w: it.photo.w, h: it.photo.h };
        } catch (e) { /* keep the item without its photo */ }
      }
      mine.push({ ...newPunchItem(it.date || prev.report_date), ...it, id: uid(), photo, from: it.from || it.id, carried: it.carried || it.date || prev.report_date });
    }
    scheduleSave(); await redraw();
    toast(`Brought over ${open.length} open item${open.length === 1 ? "" : "s"}.`);
  }

  function sectionItems(key) { return state.report.content[key].items; }

  async function redraw() {
    const y = window.scrollY;
    await drawEditor();
    window.scrollTo(0, y);
  }

  // Enter on a bullet line starts the next bullet, like Word. Enter on an
  // empty bullet ends the list. Shift+Enter makes a plain new line.
  function bulletEnter(e) {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    const ta = e.target, v = ta.value, s = ta.selectionStart, end = ta.selectionEnd;
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    const m = v.slice(ls, s).match(/^(\s*)-\s/);
    if (!m) return;
    e.preventDefault();
    if (!v.slice(ls, s).slice(m[0].length).trim() && !v.slice(end).split("\n")[0].trim()) {
      // Empty bullet: take the dash away and stop the list
      ta.value = v.slice(0, ls) + v.slice(end);
      ta.setSelectionRange(ls, ls);
    } else {
      const ins = "\n" + m[1] + "- ";
      ta.value = v.slice(0, s) + ins + v.slice(end);
      ta.setSelectionRange(s + ins.length, s + ins.length);
    }
    ta.dispatchEvent(new Event("input"));
  }

  function bindEditor() {
    const r = state.report;
    $$("[data-path]").forEach((el) => {
      el.oninput = el.onchange = () => { setPath(r, el.dataset.path, el.value); scheduleSave(); };
      if (el.tagName === "TEXTAREA") el.onkeydown = bulletEnter;
      // Punch list: the collapsed row follows the task text; other fields redraw when done
      const pi = el.closest(".punch-item");
      if (pi && /:text$/.test(el.dataset.path)) el.oninput = () => { setPath(r, el.dataset.path, el.value); scheduleSave(); $(".ps-text", pi).textContent = firstLine(el.value) || "New item"; };
      if (el.dataset.redraw !== undefined) el.onchange = async () => { setPath(r, el.dataset.path, el.value); scheduleSave(); await redraw(); };
    });
    $$(".punch-item").forEach((d) => (d.ontoggle = () => { if (d.open) state.punchOpen.add(d.dataset.pid); else state.punchOpen.delete(d.dataset.pid); }));
    $$("[data-cycle]").forEach((b) => (b.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      const it = sectionItems(b.dataset.sec).find((x) => x.id === b.dataset.id);
      const order = R.STATUSES.map((x) => x.key);
      it.status = order[(order.indexOf(it.status || "open") + 1) % order.length];
      scheduleSave(); await redraw();
    }));
    $$("[data-lochere]").forEach((b) => (b.onclick = async () => {
      b.disabled = true; toast("Finding your location…");
      const loc = await Geo.deviceLocation();
      const it = sectionItems(b.dataset.sec).find((x) => x.id === b.dataset.id);
      if (loc && loc.denied) { toast("Location is turned off for this site. Allow it in the browser settings to add a map pin.", true); b.disabled = false; return; }
      if (!Geo.has(loc)) { toast("Couldn't get a location. Try again outdoors.", true); b.disabled = false; return; }
      it.loc = loc; scheduleSave(); await redraw(); toast("Location saved.");
    }));
    $$("[data-locclear]").forEach((b) => (b.onclick = async () => {
      delete sectionItems(b.dataset.sec).find((x) => x.id === b.dataset.id).loc;
      scheduleSave(); await redraw();
    }));
    $$("[data-addpunch]").forEach((b) => (b.onclick = async () => {
      const c = r.content[b.dataset.sec];
      const it = newPunchItem(c.newDate || r.report_date);
      c.items.push(it);
      state.punchOpen.add(it.id);
      scheduleSave(); await redraw();
      const ta = $(`textarea[data-path="item:${CSS.escape(b.dataset.sec)}:${CSS.escape(it.id)}:text"]`);
      if (ta) { ta.focus(); ta.scrollIntoView({ block: "center" }); }
    }));
    $$("[data-carry]").forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await carryOver(b.dataset.sec); } catch (e) { fail(e); }
      b.disabled = false;
    }));
    const hd = $("[data-hidedone]");
    if (hd) hd.onclick = async () => { state.punchHideDone = !state.punchHideDone; await redraw(); };
    const tsel = $("#typeSel");
    if (tsel) tsel.onchange = async () => {
      const t = state.types.find((x) => x.id === tsel.value);
      if (hasAnyContent(r)) { toast("Remove notes, photos and priorities before switching type.", true); return; }
      r.type_id = t.id; r.type_name = t.name; r.sections = JSON.parse(JSON.stringify(t.sections));
      r.content = emptyContent(r.sections);
      scheduleSave(); await redraw();
    };
    // Client search (RC-09): only existing clients
    const cs = $("#clientSearch");
    if (cs) {
      const results = $("#clientResults");
      cs.oninput = () => {
        const q = cs.value.trim().toLowerCase();
        if (q.length < 2) { results.innerHTML = ""; return; }
        const hits = state.clients.filter((c) => c.active !== false && (c.name.toLowerCase().includes(q) || (c.properties || []).some((p) => p.toLowerCase().includes(q)))).slice(0, 30);
        results.innerHTML = `<div class="results">${hits.map((c) => `<button type="button" data-client="${c.id}">${esc(c.name)}${(c.properties || []).length > 1 ? ` <span class="small muted">(${c.properties.length} properties)</span>` : ""}</button>`).join("") || `<div class="none">No client with that name.${isAdmin() ? "" : " Ask an admin to add them."}</div>`}
          ${isAdmin() ? `<button type="button" data-newclient>+ Add “${esc(cs.value.trim())}” as a new client</button>` : ""}</div>`;
        $$("[data-client]", results).forEach((b) => (b.onclick = () => pickClient(Number(b.dataset.client))));
        const nc = $("[data-newclient]", results);
        if (nc) nc.onclick = async () => {
          try {
            const name = cs.value.trim();
            const c = await S.addClient({ name, properties: [name] });
            state.clients.push(c); state.clients.sort((a, b) => a.name.localeCompare(b.name));
            pickClient(c.id);
          } catch (e) { fail(e); }
        };
      };
      cs.focus();
    }
    const cc = $("#clearClient");
    if (cc) cc.onclick = async () => { r.client_id = null; r.client_name = ""; scheduleSave(); await redraw(); };

    // Formatting buttons (RC-10)
    $$("[data-fmt]").forEach((b) => (b.onclick = () => {
      const ta = $(`textarea[data-path="${CSS.escape(b.dataset.for)}"]`);
      const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
      if (b.dataset.fmt === "bold") {
        const sel = v.slice(s, e) || "bold text";
        ta.value = v.slice(0, s) + "**" + sel + "**" + v.slice(e);
        ta.setSelectionRange(s + 2, s + 2 + sel.length);
      } else {
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        const had = v.slice(ls).match(/^\s*-\s/);
        ta.value = had ? v.slice(0, ls) + v.slice(ls + had[0].length) : v.slice(0, ls) + "- " + v.slice(ls);
        const pos = had ? Math.max(ls, s - had[0].length) : s + 2;
        ta.setSelectionRange(pos, pos);
      }
      ta.focus(); ta.dispatchEvent(new Event("input"));
    }));

    // Lists
    $$("[data-add]").forEach((b) => (b.onclick = async () => {
      const sec = r.sections.find((s) => s.key === b.dataset.sec);
      sectionItems(sec.key).push(sec.kind === "photos" ? { id: uid(), photo: null, note: "" } : { id: uid(), photo: null, text: "", recommendation: "" });
      scheduleSave(); await redraw();
      const last = $$(`#sec_${CSS.escape(sec.key)} .item`).pop();
      if (last) last.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    $$("[data-addlevel]").forEach((b) => (b.onclick = async () => {
      const tier = $(`select[data-level-for="${CSS.escape(b.dataset.sec)}"]`).value;
      sectionItems(b.dataset.sec).push({ id: uid(), tier, text: "" });
      scheduleSave(); await redraw();
      const ta = $(`textarea[data-path="item:${CSS.escape(b.dataset.sec)}:${CSS.escape(sectionItems(b.dataset.sec).slice(-1)[0].id)}:text"]`);
      if (ta) { ta.focus(); ta.scrollIntoView({ block: "center" }); }
    }));
    $$("[data-addprio]").forEach((b) => (b.onclick = async () => {
      sectionItems(b.dataset.sec).push({ id: uid(), tier: b.dataset.addprio, text: "" });
      scheduleSave(); await redraw();
      const ta = $(`textarea[data-path="item:${CSS.escape(b.dataset.sec)}:${CSS.escape(sectionItems(b.dataset.sec).slice(-1)[0].id)}:text"]`);
      if (ta) ta.focus();
    }));
    $$("[data-remove]").forEach((b) => (b.onclick = async () => {
      const items = sectionItems(b.dataset.sec);
      const it = items.find((i) => i.id === b.dataset.id);
      const has = it.photo || String(it.text || it.note || it.recommendation || "").trim();
      if (has && !(await confirmBox("Remove this?", "This removes it from the report.", "Remove", true))) return;
      items.splice(items.indexOf(it), 1);
      scheduleSave(); await redraw();
    }));
    // Reorder (RC-13). Priorities move within their own tier.
    $$("[data-move]").forEach((b) => (b.onclick = async () => {
      const items = sectionItems(b.dataset.sec);
      const i = items.findIndex((x) => x.id === b.dataset.id);
      const dir = Number(b.dataset.move);
      let j = i + dir;
      const same = b.dataset.tiered !== undefined ? "tier" : b.dataset.bydate !== undefined ? "date" : null;
      if (same) {
        const v = items[i][same];
        while (j >= 0 && j < items.length && items[j][same] !== v) j += dir;
      }
      if (j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      scheduleSave(); await redraw();
    }));
    $$("[data-tier]").forEach((s) => (s.onchange = async () => {
      sectionItems(s.dataset.sec).find((x) => x.id === s.dataset.id).tier = s.value;
      scheduleSave(); await redraw();
    }));
    // Photos (RC-12, RC-14)
    $$("[data-photo]").forEach((inp) => (inp.onchange = async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      try {
        toast("Adding photo…");
        const it = sectionItems(inp.dataset.sec).find((x) => x.id === inp.dataset.id);
        const locP = wantsLoc(inp.dataset.sec) ? Geo.forPhoto(file, inp.hasAttribute("capture")) : null;
        it.photo = await addPhoto(file);
        scheduleSave(); await redraw();
        toast("Photo added.");
        if (locP) attachLoc(it, locP);
      } catch (e) { fail(e); }
    }));
    $$("[data-webcam]").forEach((b) => (b.onclick = async () => {
      const file = await webcamShot();
      if (!file) return;
      try {
        toast("Adding photo…");
        const it = sectionItems(b.dataset.sec).find((x) => x.id === b.dataset.id);
        const locP = wantsLoc(b.dataset.sec) ? Geo.forPhoto(file, true) : null;
        it.photo = await addPhoto(file);
        scheduleSave(); await redraw();
        toast("Photo added.");
        if (locP) attachLoc(it, locP);
      } catch (e) { fail(e); }
    }));
    $$("[data-multi]").forEach((inp) => (inp.onchange = async () => {
      const files = Array.from(inp.files || []).sort((a, b) => a.lastModified - b.lastModified); // in the order taken
      if (!files.length) return;
      try {
        toast(`Adding ${files.length} photo${files.length > 1 ? "s" : ""}…`);
        const sec = r.sections.find((x) => x.key === inp.dataset.sec);
        const c = r.content[sec.key];
        for (const f of files) {
          if (sec.kind !== "punchlist") { sectionItems(sec.key).push({ id: uid(), photo: await addPhoto(f), note: "" }); continue; }
          const it = newPunchItem(c.newDate || r.report_date);
          const locP = Geo.forPhoto(f, false);
          it.photo = await addPhoto(f);
          sectionItems(sec.key).push(it);
          attachLoc(it, locP);
        }
        scheduleSave(); await redraw();
        toast("Photos added.");
      } catch (e) { fail(e); }
    }));
    $$("[data-nophoto]").forEach((b) => (b.onclick = async () => {
      sectionItems(b.dataset.sec).find((x) => x.id === b.dataset.id).photo = null;
      scheduleSave(); await redraw();
    }));
    // Dictation (RC-17)
    $$("[data-mic]").forEach((b) => (b.onclick = () => toggleDictation(b)));
    if (dict) markMic(dict.path, true);

    $("#previewBtn").onclick = $("#previewBtn2").onclick = async () => {
      if (!r.client_id && !r.client_name && !r.property) { toast("Pick the client first.", true); return; }
      await flushSave();
      location.hash = "#/review/" + r.id;
    };
    // Made-up content and photos for trying layouts and exports (demo mode and admins)
    const sb = $("#sampleBtn");
    if (sb) sb.onclick = async () => {
      if ((hasAnyContent(r) || r.client_id) && !(await confirmBox("Fill with sample data?", "This replaces the client, notes, photos and priorities in this report with made-up sample content.", "Fill it in"))) return;
      sb.disabled = true; sb.textContent = "Filling in…";
      try {
        const c = await HHSample.fill(r, state.clients, (blob) => S.uploadPhoto(r.id, blob), uid);
        if (c) await pickClient(c.id); else { scheduleSave(); await redraw(); }
        toast("Sample data added. Everything can still be edited.");
      } catch (e) { fail(e); sb.disabled = false; sb.textContent = "Fill with sample data"; }
    };
    $("#delBtn").onclick = async () => {
      if (!(await confirmBox("Delete this draft?", "The draft and its photos will be removed. This can't be undone.", "Delete", true))) return;
      try { clearTimeout(state.saveTimer); state.dirty = false; await S.deleteReport(r.id); state.report = null; toast("Draft deleted."); go("dashboard"); } catch (e) { fail(e); }
    };
  }

  // QuickBooks can hold several addresses in one field; the report needs one
  const firstEmail = (s) => (String(s || "").match(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/) || [""])[0];

  async function pickClient(id) {
    const r = state.report;
    const c = state.clients.find((x) => x.id === id);
    r.client_id = c.id;
    r.client_name = c.name;
    r.property = (c.properties && c.properties[0]) || c.name;
    // Contact from the customer list, then this client's last report, then the client name.
    // Both fields stay editable.
    let prev = null;
    try {
      const last = (await S.listReports()).filter((x) => x.client_name === c.name && x.id !== r.id)[0];
      if (last) prev = await S.getReport(last.id);
    } catch (e) { /* not important */ }
    r.contact_name = c.contact_name || (prev && prev.contact_name) || c.name;
    r.contact_email = firstEmail(c.contact_email) || (prev && prev.contact_email) || "";
    if (!r.community && prev) r.community = prev.community || "";
    scheduleSave(); await redraw();
  }

  // Shrink phone photos so files stay small enough to email (RC-14)
  async function addPhoto(file) {
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't a photo this browser can open (HEIC photos: use the camera button or share as JPEG)."));
      i.src = url;
    });
    const MAX = 1600;
    const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.82));
    const ref = await S.uploadPhoto(state.report.id, blob);
    return { ...ref, w, h };
  }

  // --- Camera on a computer -----------------------------------------
  // Phones and tablets open their own camera from the file button
  // (capture="environment"). Computers ignore that and show a file
  // picker, so there the Camera button opens the webcam in a window.
  const useWebcam = () => !(window.matchMedia && matchMedia("(pointer: coarse)").matches) && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  async function webcamShot() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      toast(/NotAllowed|Permission/i.test(e.name + e.message) ? "The browser blocked the camera. Allow camera access for this site, or use Upload photo." : "No camera found on this computer. Use Upload photo instead.", true);
      return null;
    }
    return new Promise((resolve) => {
      const { m, close } = modal(`<h2>Take a photo</h2>
        <video autoplay playsinline muted style="width:100%;border-radius:8px;background:#000"></video>
        <div class="btn-row" style="justify-content:flex-end;margin-top:12px"><button class="secondary" data-no>Cancel</button><button data-snap>Take photo</button></div>`);
      const video = $("video", m);
      video.srcObject = stream;
      let done = false, watch = null;
      const finish = (file) => { if (done) return; done = true; stream.getTracks().forEach((t) => t.stop()); clearInterval(watch); close(); resolve(file); };
      // Closed by clicking outside: turn the camera off
      watch = setInterval(() => { if (!m.isConnected) finish(null); }, 400);
      $("[data-no]", m).onclick = () => finish(null);
      $("[data-snap]", m).onclick = () => {
        const c = document.createElement("canvas");
        c.width = video.videoWidth; c.height = video.videoHeight;
        if (!c.width) return;
        c.getContext("2d").drawImage(video, 0, 0);
        c.toBlob((blob) => finish(new File([blob], "camera.jpg", { type: "image/jpeg" })), "image/jpeg", 0.9);
      };
    });
  }

  // --- Dictation (RC-17, RC-18) ----------------------------------------
  // One dictation at a time. "dict" is the running one; events from an older
  // one are ignored, so a session that never reports its end (iPhone Safari
  // does this) can't block the microphone for the next field.
  let dict = null;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function markMic(path, on) {
    $$("[data-mic]").forEach((b) => b.classList.toggle("listening", !!on && b.dataset.mic === path));
  }
  function endDictation(d) {
    if (!d) return;
    if (dict === d) { dict = null; markMic(null, false); }
    try { d.rec.onresult = d.rec.onerror = d.rec.onend = null; d.rec.abort(); } catch (e) { /* already ended */ }
  }
  function applyTerms(text) {
    let out = text;
    for (const t of state.settings.dictation_terms || []) {
      if (!t.heard || !t.write) continue;
      out = out.replace(new RegExp("\\b" + t.heard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + "\\b", "gi"), t.write);
    }
    return out;
  }
  function toggleDictation(btn) {
    const path = btn.dataset.mic;
    if (dict && isIOS && Date.now() - dict.started > 15000) endDictation(dict); // iPhone stops listening on its own
    if (dict) {
      const d = dict;
      if (d.path === path) {
        // Stop: keep what was just said, then make sure it is really finished
        // iPhone ignores stop and keeps the microphone, so let it go right away there
        if (isIOS) { endDictation(d); return; }
        dict = null; markMic(null, false);
        try { d.rec.stop(); } catch (e) { /* ended */ }
        setTimeout(() => endDictation(d), 2000);
        return;
      }
      // A different box: drop the old one and start here right away
      endDictation(d);
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Dictation isn't available in this browser. Use Chrome or Safari, or the microphone on your phone's keyboard.", true); return; }
    if (!navigator.onLine) { toast("Dictation needs an internet connection on this device. You can still use your keyboard's microphone.", true); return; }
    const rec = new SR();
    const d = { rec, path, started: Date.now() };
    rec.lang = "en-US";
    // iPhone Safari is unreliable with continuous listening: one phrase per tap there
    rec.continuous = !isIOS;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      let said = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (!ev.results[i].isFinal) continue;
        said += ev.results[i][0].transcript;
      }
      said = applyTerms(said.trim());
      if (!said) return;
      // Find the box again each time: the screen may have been redrawn
      const ta = $(`textarea[data-path="${CSS.escape(path)}"]`);
      const cur = ta ? ta.value : (state.report ? getPath(state.report, path) : "");
      const next = cur + (cur && !/\s$/.test(cur) ? " " : "") + said;
      if (ta) { ta.value = next; ta.dispatchEvent(new Event("input")); }
      else if (state.report) { setPath(state.report, path, next); scheduleSave(); }
      // iPhone: the phrase is in, so close this session now. Safari often never
      // says it has ended, which used to leave the microphone stuck.
      if (!rec.continuous) endDictation(d);
    };
    rec.onerror = (e) => {
      if (dict === d) { dict = null; markMic(null, false); }
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast(isIOS ? "Dictation is blocked. On iPhone, turn on Siri & Dictation in Settings and allow the microphone for this site, or use the microphone on the keyboard." : "Allow microphone access to dictate.", true);
      else if (e.error === "network") toast("Dictation needs an internet connection.", true);
      else if (e.error === "audio-capture") toast("The microphone is busy or missing. Wait a second and tap again.", true);
      else if (e.error === "no-speech") toast("Didn't catch that. Tap the microphone and try again.", true);
    };
    rec.onend = () => { if (dict === d) { dict = null; markMic(null, false); } };
    dict = d;
    markMic(path, true);
    try {
      rec.start();
      toast(isIOS ? "Listening… say one phrase. Tap the microphone again for the next one." : "Listening… tap the microphone again to stop.");
    } catch (e) {
      endDictation(d);
      toast(isIOS ? "Couldn't start the microphone. Try again, or use the microphone on the keyboard." : "Couldn't start the microphone. Try again in a moment.", true);
    }
  }

  // =====================================================================
  // Review screen: Edit / Word / PDF / Send (RC-20 to RC-28)
  // =====================================================================
  async function renderReview(id) {
    const r = await S.getReport(id);
    state.report = r;
    if (r.status === "draft") { r.status = "review"; await S.saveReport(r); }
    const urls = {};
    for (const s of r.sections) for (const it of ((r.content[s.key] || {}).items || [])) if (it.photo) urls[it.photo.id] = await S.photoUrl(it.photo);
    const sends = await S.listSends(r.id);
    const polished = r.content._polish && Object.keys(r.content._polish).length;
    const sent = r.status === "sent";
    $("#view").innerHTML = `
      <div class="toolbar">
        <div><span class="eyebrow">${esc(r.type_name)}</span> ${statusBadge(r.status)}${r.version > 1 ? ` <span class="small muted">version ${r.version}</span>` : ""}</div>
        <div class="btn-row">
          <button class="secondary" id="editBtn" type="button">${sent ? "Edit (new version)" : "← Edit"}</button>
          ${state.settings.ai_polish_enabled && !sent ? `<button class="secondary" id="polishBtn" type="button">✨ Polish Copy</button>` : ""}
          ${polished && !sent ? `<button class="secondary" id="unpolishBtn" type="button">Undo polish</button>` : ""}
          <button class="secondary" id="docxBtn" type="button">Word</button>
          <button class="secondary" id="pdfBtn" type="button">PDF</button>
          ${sent ? `<button id="resendBtn" type="button" class="secondary">Send again</button>` : `<button id="sendBtn" type="button">Send</button>`}
        </div>
      </div>
      ${sent ? `<div class="notice">Sent ${esc(new Date(r.sent_at).toLocaleString())} to ${esc(r.sent_to)}. Sent reports are locked so we keep exactly what the client received. Editing makes a new version.</div>` : ""}
      <div class="preview-wrap">${R.reportHtml(r, (p) => urls[p.id] || "")}</div>
      ${sends.length ? `<div class="card" style="margin-top:20px"><h2>Send history</h2>${sends.map((s) => `<div class="small" style="padding:6px 0;border-top:1px solid var(--line)">Version ${s.version} sent to <b>${esc(s.sent_to)}</b> on ${esc(new Date(s.sent_at).toLocaleString())}${s.sent_by_name ? ` by ${esc(s.sent_by_name)}` : ""}</div>`).join("")}</div>` : ""}`;

    $("#editBtn").onclick = async () => {
      if (sent) {
        if (!(await confirmBox("Edit a sent report?", `This makes version ${r.version + 1}. The client keeps what they already received, and the new version needs to be sent again.`, "Make new version"))) return;
        r.version += 1; r.status = "draft";
        await S.saveReport(r);
      }
      location.hash = "#/report/" + r.id;
    };
    $("#docxBtn").onclick = () => exportFile(r, "docx");
    $("#pdfBtn").onclick = () => exportFile(r, "pdf");
    if ($("#sendBtn")) $("#sendBtn").onclick = () => openSend(r);
    if ($("#resendBtn")) $("#resendBtn").onclick = () => openSend(r);
    if ($("#polishBtn")) $("#polishBtn").onclick = () => runPolish(r);
    if ($("#unpolishBtn")) $("#unpolishBtn").onclick = () => undoPolish(r);
  }

  async function exportFile(r, kind) {
    try {
      toast(kind === "pdf" ? "Making the PDF…" : "Making the Word file…");
      const photos = await X.loadPhotos(r, S.photoUrl);
      const blob = kind === "pdf" ? await X.buildPdf(r, photos) : await X.buildDocx(r, photos);
      X.download(blob, `${R.fileBase(r)}.${kind}`);
      toast("Downloaded " + R.fileBase(r) + "." + kind);
    } catch (e) { fail(e); }
  }

  // --- AI polish (RC-19) ---------------------------------------------------
  function textFields(r) {
    const out = [];
    for (const s of r.sections) {
      const c = r.content[s.key] || {};
      if (s.kind === "notes" && String(c.text || "").trim()) out.push({ id: `sec:${s.key}:text`, section: s.title, label: s.title, text: c.text });
      for (const [n, it] of (c.items || []).entries()) {
        for (const f of ["text", "recommendation", "note"]) {
          if (String(it[f] || "").trim()) out.push({ id: `item:${s.key}:${it.id}:${f}`, section: s.title, label: `${s.title} ${n + 1} · ${f === "text" ? (s.kind === "priorities" ? "Priority" : s.kind === "punchlist" ? "Task" : "Observation") : f[0].toUpperCase() + f.slice(1)}`, text: it[f] });
        }
      }
    }
    return out;
  }
  async function runPolish(r) {
    const fields = textFields(r);
    if (!fields.length) { toast("There's no text to polish yet.", true); return; }
    const { m, close } = modal(`<h2>Polish Copy</h2><p class="muted">Cleaning up grammar and tone. Facts, plant names, numbers, timing and treatments stay exactly as written…</p>`, { wide: true });
    let out;
    try { out = await S.polish(fields.map((f) => ({ id: f.id, text: f.text }))); } catch (e) { close(); fail(e); return; }
    const byId = new Map(out.map((o) => [o.id, o.text]));
    const changed = fields.filter((f) => byId.has(f.id) && byId.get(f.id).trim() !== f.text.trim());
    if (!changed.length) { close(); toast("Your wording already reads well. Nothing to change."); return; }
    m.innerHTML = `
      <h2>Polish Copy</h2>
      <p class="small muted">Tick what you want to keep. Facts are never changed. If a suggestion changes a number or name, it is left out automatically.${S.mode === "demo" ? " <b>Demo mode:</b> this only tidies spacing, capitals and full stops." : ""}</p>
      ${changed.map((f) => `
        <div class="cmp">
          <label class="cmp-head"><input type="checkbox" data-keep="${esc(f.id)}" checked> ${esc(f.label)}</label>
          <div><div class="small" style="font-weight:600">Your words</div><div class="before">${esc(f.text)}</div></div>
          <div><div class="small" style="font-weight:600;color:var(--green)">Polished</div><div class="after">${esc(byId.get(f.id))}</div></div>
        </div>`).join("")}
      <div class="btn-row" style="justify-content:flex-end"><button class="secondary" data-cancel>Cancel</button><button data-apply>Use ticked changes</button></div>`;
    $("[data-cancel]", m).onclick = close;
    $("[data-apply]", m).onclick = async () => {
      r.content._polish = r.content._polish || {};
      for (const cb of $$("[data-keep]", m)) {
        if (!cb.checked) continue;
        const f = changed.find((x) => x.id === cb.dataset.keep);
        if (!(f.id in r.content._polish)) r.content._polish[f.id] = f.text; // keep the original for Undo
        setPath(r, f.id, byId.get(f.id));
      }
      try { await S.saveReport(r); close(); toast("Polished wording applied."); renderReview(r.id); } catch (e) { fail(e); }
    };
  }
  async function undoPolish(r) {
    const orig = r.content._polish || {};
    const ids = Object.keys(orig);
    const fields = new Map(textFields(r).map((f) => [f.id, f]));
    const { m, close } = modal(`
      <h2>Undo polish</h2>
      <p class="small muted">Tick the sections to put back to your original words.</p>
      ${ids.map((id) => `<div class="cmp"><label class="cmp-head"><input type="checkbox" data-undo="${esc(id)}" checked> ${esc((fields.get(id) || {}).label || id)}</label>
        <div><div class="small" style="font-weight:600">Now</div><div class="before">${esc(getPath(r, id))}</div></div>
        <div><div class="small" style="font-weight:600">Your original</div><div class="after">${esc(orig[id])}</div></div></div>`).join("")}
      <div class="btn-row" style="justify-content:flex-end"><button class="secondary" data-cancel>Cancel</button><button data-apply>Put back ticked</button></div>`, { wide: true });
    $("[data-cancel]", m).onclick = close;
    $("[data-apply]", m).onclick = async () => {
      for (const cb of $$("[data-undo]", m)) if (cb.checked) { setPath(r, cb.dataset.undo, orig[cb.dataset.undo]); delete orig[cb.dataset.undo]; }
      try { await S.saveReport(r); close(); toast("Original wording restored."); renderReview(r.id); } catch (e) { fail(e); }
    };
  }

  // --- Send to client (RC-26, RC-27) --------------------------------------
  function emailText(r, message) {
    const first = String(r.contact_name || "").trim().split(/\s+/)[0];
    const sig = R.signatureLines(r.consultant).join("\n");
    return `Subject: Property Report · ${r.property || r.client_name}\n\n${first ? `Hi ${first},` : "Hello,"}\n\nYour ${r.type_name} for ${r.property || r.client_name} is ready.\n\n${message ? message + "\n\n" : ""}[ View your report ]  (opens in your browser, with Download and Print)\n\n${sig}`;
  }
  function openSend(r) {
    const { m, close } = modal(`
      <h2>Send report</h2>
      <div class="field"><label for="sTo">Client email <span class="req">*</span></label><input id="sTo" type="email" value="${esc(r.contact_email)}"></div>
      <div class="field"><label for="sName">Greet them as</label><input id="sName" value="${esc(r.contact_name)}"></div>
      ${textArea("send:message", "", { placeholder: "A personal note (optional)", rows: 3, fmt: false, label: "Personal message" })}
      <p class="small" style="font-weight:600;margin-bottom:4px">What they'll get</p>
      <div class="email-preview" id="sPrev"></div>
      <p class="hint">Replies go to ${esc(r.consultant.email || "you")}.${S.mode === "demo" ? " Demo mode: nothing is emailed; you'll get the client link to try." : ""}</p>
      <div id="sErr" class="error-text"></div>
      <div class="btn-row" style="justify-content:flex-end;margin-top:12px"><button class="secondary" data-cancel>Cancel</button><button data-send>Send Report</button></div>`);
    const msg = $("textarea", m);
    const upd = () => { $("#sPrev", m).textContent = emailText({ ...r, contact_name: $("#sName", m).value }, msg.value.trim()); };
    msg.oninput = upd; $("#sName", m).oninput = upd; upd();
    $("[data-mic]", m).onclick = (e) => toggleDictation(e.currentTarget);
    $("[data-cancel]", m).onclick = close;
    $("[data-send]", m).onclick = async (ev) => {
      const to = $("#sTo", m).value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { $("#sErr", m).textContent = "Enter a valid email address."; return; }
      const btn = ev.currentTarget;
      btn.disabled = true; btn.textContent = "Sending…";
      try {
        r.contact_email = to;
        r.contact_name = $("#sName", m).value.trim();
        await S.saveReport(r);
        // The client's copy: a PDF plus the report with photos built in
        const photos = await X.loadPhotos(r, S.photoUrl);
        const pdf = await X.buildPdf(r, photos);
        const snap = JSON.parse(JSON.stringify(r));
        delete snap.content._polish;
        for (const s of snap.sections) if (s.kind === "punchlist" && snap.content[s.key]) {
          const map = await X.mapImage(snap.content[s.key].items);
          if (map) snap.content[s.key].mapImage = map.dataUrl;
        }
        for (const s of snap.sections) for (const it of ((snap.content[s.key] || {}).items || [])) {
          if (it.photo && photos.get(it.photo.id)) it.photo = { id: it.photo.id, w: it.photo.w, h: it.photo.h, dataUrl: photos.get(it.photo.id).dataUrl };
        }
        const json = new Blob([JSON.stringify({ report: snap, file_name: R.fileBase(r), sent_at: new Date().toISOString() })], { type: "application/json" });
        const link = await S.shareReport(r, [["report.pdf", pdf, "application/pdf"], ["report.json", json, "application/json"], [`version-${r.version}.pdf`, pdf, "application/pdf"]]);
        await S.sendReport({ report: r, to, message: msg.value.trim() });
        close();
        const { m: m2, close: c2 } = modal(`<h2>Report sent</h2>
          <p>${S.mode === "demo" ? "In demo mode nothing is emailed, but" : "The email is on its way to"} <b>${esc(to)}</b>${S.mode === "demo" ? " would get this link:" : ". Their link:"}</p>
          <p><a href="${esc(link)}" target="_blank" rel="noopener">Open what the client sees</a></p>
          <div class="btn-row" style="justify-content:flex-end"><button data-ok>Done</button></div>`);
        $("[data-ok]", m2).onclick = () => { c2(); renderReview(r.id); };
      } catch (e) {
        btn.disabled = false; btn.textContent = "Send Report";
        $("#sErr", m).textContent = S.friendlyError(e);
      }
    };
  }

  // =====================================================================
  // Profile (RC-04)
  // =====================================================================
  function renderProfile(firstTime) {
    const p = state.me;
    $("#view").innerHTML = `
      <div class="page-head"><div><p class="eyebrow">${firstTime ? "Welcome" : "Your details"}</p><h1>Profile</h1></div></div>
      ${firstTime ? `<div class="notice">Before your first report, please add your name, title and credentials. They appear as your signature on every report.</div>` : ""}
      <div class="card">
        <div class="grid2">
          <div class="field"><label for="pName">Name <span class="req">*</span></label><input id="pName" value="${esc(p.full_name)}"></div>
          <div class="field"><label for="pEmail">Email</label><input id="pEmail" value="${esc(p.email)}" disabled><div class="hint">Clients' replies come to this address.</div></div>
          <div class="field"><label for="pTitle">Title <span class="req">*</span></label><input id="pTitle" value="${esc(p.title || "")}" placeholder="e.g. Horticulture Consultant"></div>
          <div class="field"><label for="pCred">Credentials</label><input id="pCred" value="${esc(p.credentials || "")}" placeholder="e.g. ISA Certified Arborist"></div>
          <div class="field"><label for="pPhone">Phone (optional)</label><input id="pPhone" value="${esc(p.phone || "")}"></div>
        </div>
        <p class="small" style="font-weight:600;margin-bottom:6px">Your signature on reports</p>
        <div class="sig-preview" id="sigPrev"></div>
        <div id="pErr" class="error-text"></div>
        <div class="btn-row" style="margin-top:16px"><button id="pSave">Save profile</button></div>
      </div>`;
    const vals = () => ({ full_name: $("#pName").value.trim(), title: $("#pTitle").value.trim(), credentials: $("#pCred").value.trim(), phone: $("#pPhone").value.trim() });
    const prev = () => {
      const v = vals();
      $("#sigPrev").innerHTML = R.signatureLines({ name: v.full_name, title: v.title, credentials: v.credentials, email: p.email, phone: v.phone }).map((l, i) => `<div class="${i === 0 ? "n" : ""}">${esc(l)}</div>`).join("");
    };
    $$("#view input").forEach((i) => (i.oninput = prev)); prev();
    $("#pSave").onclick = async () => {
      const v = vals();
      if (!v.full_name || !v.title) { $("#pErr").textContent = "Please add your name and title."; return; }
      try {
        await S.updateMyProfile(v);
        Object.assign(state.me, v);
        $("#whoName").textContent = v.full_name;
        toast("Profile saved. New reports will use it.");
        if (firstTime) go("dashboard");
      } catch (e) { fail(e); }
    };
  }

  // =====================================================================
  // Team: invite-only access (RC-02)
  // =====================================================================
  // =====================================================================
  // Clients: add one, or paste many from a spreadsheet
  // =====================================================================
  // Reads pasted rows: tab separated (copied from a spreadsheet) or commas.
  // Columns: Client name, Contact name, Contact email, Property (all but the name optional).
  function parseClientRows(text) {
    const rows = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const cells = raw.includes("\t") ? raw.split("\t") : csvCells(raw);
      const [name, contact_name, contact_email, property] = cells.map((x) => String(x || "").trim());
      if (!name || /^(client|customer|name)( name)?$/i.test(name)) continue; // skip a header row
      rows.push({ name, contact_name: contact_name || "", contact_email: firstEmail(contact_email), properties: [property || name] });
    }
    return rows;
  }
  function csvCells(line) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  async function renderClients() {
    state.clients = await S.listClients();
    const q = state.clientQuery || "";
    const list = state.clients.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || String(c.contact_name || "").toLowerCase().includes(q.toLowerCase()));
    $("#view").innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Admin</p><h1>Clients</h1></div></div>
      <div class="card">
        <h2>Add a client</h2>
        <p class="small muted">Clients are shared with the Time Tracker, so a new client shows up there too. To update the whole list from QuickBooks, use Lists → Clients in the <a href="${esc((window.HH_CONFIG && window.HH_CONFIG.TIME_TRACKER_URL) || "https://harmony-horticulture.github.io/time-tracker/")}" target="_blank" rel="noopener">Time Tracker</a>.</p>
        <div class="grid4">
          <div class="field"><label for="ncName">Client name</label><input id="ncName" placeholder="e.g. Smith Residence"></div>
          <div class="field"><label for="ncContact">Contact name</label><input id="ncContact"></div>
          <div class="field"><label for="ncEmail">Contact email</label><input id="ncEmail" type="email"></div>
          <div class="field"><label for="ncProp">Property (optional)</label><input id="ncProp" placeholder="Same as client name"></div>
        </div>
        <button type="button" id="ncAdd">Add client</button>
      </div>
      <div class="card">
        <h2>Add many at once</h2>
        <p class="small muted">Copy rows from a spreadsheet and paste them here, or type one client per line with commas. Columns in this order: <b>Client name, Contact name, Contact email, Property</b>. Only the name is required. Names already in the list are skipped.</p>
        <textarea id="bulkRows" rows="6" placeholder="Smith Residence, Jane Smith, jane@example.com&#10;Lopez Estate, Carlos Lopez, carlos@example.com, Lopez Estate - Guest House"></textarea>
        <div class="btn-row" style="margin-top:10px"><button type="button" class="secondary" id="bulkCheck">Check</button><button type="button" id="bulkAdd">Add these clients</button></div>
        <div id="bulkOut" class="small" style="margin-top:8px"></div>
      </div>
      <div class="card">
        <h2>All clients <span class="small muted">(${state.clients.length})</span></h2>
        <input id="clQuery" placeholder="Search clients" value="${esc(q)}" style="margin-bottom:10px">
        <div class="rlist">${list.slice(0, 300).map((c) => `<div class="row"><div><div class="t">${esc(c.name)}${c.active === false ? ' <span class="small muted">(inactive)</span>' : ""}</div>
          <div class="m">${esc([c.contact_name, c.contact_email].filter(Boolean).join(" · ") || "No contact yet")}</div></div></div>`).join("") || `<p class="small muted">No clients match.</p>`}</div>
        ${list.length > 300 ? `<p class="small muted">Showing the first 300. Search to narrow it down.</p>` : ""}
      </div>`;
    const qi = $("#clQuery");
    qi.oninput = () => { clearTimeout(state.clientQT); state.clientQT = setTimeout(async () => { state.clientQuery = qi.value; await renderClients(); const n = $("#clQuery"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    $("#ncAdd").onclick = async () => {
      const name = $("#ncName").value.trim();
      if (!name) { toast("Enter the client name.", true); return; }
      if (state.clients.some((c) => [c.name, c.qb_name].some((x) => x && x.toLowerCase() === name.toLowerCase()))) { toast("There's already a client with that name.", true); return; }
      const email = $("#ncEmail").value.trim();
      if (email && !firstEmail(email)) { toast("That email doesn't look right.", true); return; }
      try {
        await S.addClient({ name, contact_name: $("#ncContact").value.trim(), contact_email: firstEmail(email), properties: [$("#ncProp").value.trim() || name] });
        toast(`${name} added.`); await renderClients();
      } catch (e) { fail(e); }
    };
    const check = () => {
      const rows = parseClientRows($("#bulkRows").value);
      const have = new Set(state.clients.flatMap((c) => [c.name, c.qb_name].filter(Boolean).map((x) => x.toLowerCase())));
      const seen = new Set();
      const fresh = [], skipped = [];
      for (const r of rows) {
        const k = r.name.toLowerCase();
        if (have.has(k) || seen.has(k)) skipped.push(r.name); else { seen.add(k); fresh.push(r); }
      }
      $("#bulkOut").innerHTML = rows.length
        ? `<b>${fresh.length}</b> new client${fresh.length === 1 ? "" : "s"} to add${skipped.length ? `, ${skipped.length} skipped because the name is already there (${esc(skipped.slice(0, 5).join(", "))}${skipped.length > 5 ? "…" : ""})` : ""}.
           ${fresh.slice(0, 5).map((r) => `<div class="muted">${esc(r.name)}${r.contact_name ? " · " + esc(r.contact_name) : ""}${r.contact_email ? " · " + esc(r.contact_email) : ""}</div>`).join("")}${fresh.length > 5 ? `<div class="muted">and ${fresh.length - 5} more</div>` : ""}`
        : "Nothing to add yet.";
      return fresh;
    };
    $("#bulkCheck").onclick = () => check();
    $("#bulkAdd").onclick = async () => {
      const fresh = check();
      if (!fresh.length) return;
      if (!(await confirmBox("Add these clients?", `${fresh.length} new client${fresh.length === 1 ? "" : "s"} will be added. They also show up in the Time Tracker.`, "Add them"))) return;
      try { await S.addClients(fresh); toast(`${fresh.length} client${fresh.length === 1 ? "" : "s"} added.`); await renderClients(); } catch (e) { fail(e); }
    };
  }

  async function renderTeam() {
    const [people, invites] = await Promise.all([S.listPeople(), S.listInvitations()]);
    $("#view").innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Admin</p><h1>Team</h1></div></div>
      <div class="card">
        <h2>Invite someone</h2>
        <p class="small muted">They get an email with a link to set their password, then fill in their profile. Only invited people can get in. The same login works in the Time Tracker.</p>
        <div class="grid4">
          <div class="field"><label for="ivName">Name</label><input id="ivName"></div>
          <div class="field"><label for="ivEmail">Email</label><input id="ivEmail" type="email"></div>
          <div class="field"><label for="ivRole">Role</label><select id="ivRole"><option value="consultant">Consultant</option><option value="technician">Technician</option><option value="admin">Admin</option></select></div>
          <div class="field" style="padding-top:28px"><button type="button" id="ivSend" style="width:100%">Send invitation</button></div>
        </div>
        ${invites.length ? `<p class="small"><b>Waiting to accept:</b> ${invites.map((i) => `${esc(i.full_name || i.email)} (${esc(i.email)}, ${esc(i.role)})`).join("; ")}</p>` : ""}
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Title</th><th>Role</th><th>Active</th></tr></thead>
        <tbody>${people.map((p) => `<tr>
          <td>${esc(p.full_name)}</td><td>${esc(p.email)}</td><td>${esc([p.title, p.credentials].filter(Boolean).join(", "))}</td>
          <td><select data-role="${esc(p.id)}" ${p.id === state.me.id ? "disabled" : ""}><option value="consultant" ${p.role === "consultant" ? "selected" : ""}>Consultant</option><option value="technician" ${p.role === "technician" ? "selected" : ""}>Technician</option><option value="admin" ${p.role === "admin" ? "selected" : ""}>Admin</option></select></td>
          <td><input type="checkbox" data-active="${esc(p.id)}" ${p.active ? "checked" : ""} ${p.id === state.me.id ? "disabled" : ""}></td></tr>`).join("")}</tbody>
      </table></div></div>`;
    $("#ivSend").onclick = async () => {
      const email = $("#ivEmail").value.trim(), full_name = $("#ivName").value.trim(), role = $("#ivRole").value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("Enter a valid email.", true); return; }
      try { await S.invite({ email, full_name, role }); toast(S.mode === "demo" ? `${full_name || email} added (demo mode skips the email).` : `Invitation sent to ${email}.`); renderTeam(); } catch (e) { fail(e); }
    };
    $$("[data-role]").forEach((s) => (s.onchange = async () => { try { await S.updatePerson(s.dataset.role, { role: s.value }); toast("Role updated."); } catch (e) { fail(e); } }));
    $$("[data-active]").forEach((c) => (c.onchange = async () => { try { await S.updatePerson(c.dataset.active, { active: c.checked }); toast(c.checked ? "Access turned on." : "Access turned off."); } catch (e) { fail(e); } }));
  }

  // =====================================================================
  // Settings: AI polish switch, dictation words, report types (RC-08, RC-18, RC-19)
  // =====================================================================
  async function renderSettings() {
    state.settings = await S.getSettings();
    state.types = await S.listReportTypes();
    const st = state.settings;
    $("#view").innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Admin</p><h1>Settings</h1></div></div>
      <div class="card">
        <h2>AI polish</h2>
        <p class="small muted">Adds a “Polish Copy” button on the review screen that tidies grammar and tone. It is told never to add, remove or change facts, diagnoses, treatments, timing or quantities, and any suggestion that changes a number is dropped. Consultants see every change and can keep, edit or undo it. It's off until you decide you're comfortable with it.</p>
        <label class="check"><input type="checkbox" id="aiOn" ${st.ai_polish_enabled ? "checked" : ""}> Turn on AI polish</label>
      </div>
      <div class="card">
        <h2>Dictation word list</h2>
        <p class="small muted">Fixes for words dictation often gets wrong. One per line: what it hears, then <b>=&gt;</b>, then how to write it.</p>
        <textarea id="terms" rows="5" placeholder="acer palmer tum => Acer palmatum">${esc((st.dictation_terms || []).map((t) => `${t.heard} => ${t.write}`).join("\n"))}</textarea>
        <div class="btn-row" style="margin-top:10px"><button id="termsSave" type="button">Save word list</button></div>
      </div>
      <div class="card">
        <h2>Punch list map</h2>
        <p class="small muted">Shows a satellite map with numbered pins at the top of punch lists. Paste the Mapbox public token here (it starts with <b>pk.</b>, from account.mapbox.com). Leave it empty to turn the map off.</p>
        <input id="mapToken" placeholder="pk.…" value="${esc(st.map_token || "")}" autocomplete="off" spellcheck="false">
        <div class="btn-row" style="margin-top:10px"><button id="mapSave" type="button">Save map key</button></div>
      </div>
      <div class="card">
        <h2>Report types</h2>
        <p class="small muted">Changes apply to new reports only. Reports already started keep their sections.</p>
        <div id="typeList">${state.types.map((t) => `
          <div class="rlist"><div class="row" data-edittype="${esc(t.id)}"><div><div class="t">${esc(t.name)}${t.active === false ? ' <span class="small muted">(hidden)</span>' : ""}</div><div class="m">${t.sections.map((s) => esc(s.title)).join(" · ")}</div></div><button class="secondary small" type="button">Edit</button></div></div>`).join("")}</div>
        <div class="btn-row" style="margin-top:10px"><button id="addType" type="button">+ Add report type</button></div>
      </div>`;
    $("#aiOn").onchange = async () => {
      try { await S.saveSettings({ ai_polish_enabled: $("#aiOn").checked }); state.settings.ai_polish_enabled = $("#aiOn").checked; toast($("#aiOn").checked ? "AI polish is on." : "AI polish is off."); } catch (e) { fail(e); }
    };
    $("#mapSave").onclick = async () => {
      const v = $("#mapToken").value.trim();
      if (v && !/^pk\.[A-Za-z0-9._-]{20,}$/.test(v)) { toast("That doesn't look like a Mapbox public token. It starts with pk.", true); return; }
      try { await S.saveSettings({ map_token: v }); state.settings.map_token = v; R.setMapToken(v); toast(v ? "Map key saved. Punch lists now show the map." : "Map turned off."); } catch (e) { fail(e); }
    };
    $("#termsSave").onclick = async () => {
      const terms = $("#terms").value.split("\n").map((l) => l.split("=>").map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1]).map(([heard, write]) => ({ heard, write }));
      try { await S.saveSettings({ dictation_terms: terms }); state.settings.dictation_terms = terms; toast("Word list saved."); } catch (e) { fail(e); }
    };
    $$("[data-edittype]").forEach((row) => (row.onclick = () => editType(state.types.find((t) => t.id === row.dataset.edittype))));
    $("#addType").onclick = () => editType({ name: "", description: "", sort_order: state.types.length + 1, active: true, sections: [{ key: "", title: "Overview", kind: "notes", help: "" }] });
  }

  function editType(t) {
    t = JSON.parse(JSON.stringify(t));
    const KINDS = [["notes", "Notes"], ["observations", "Observations (photo + recommendation)"], ["photos", "Photos with notes"], ["priorities", "Priorities (3 tiers)"], ["punchlist", "Punch list (compact table: photo, task, priority, assigned to, status)"]];
    const { m, close } = modal(`<div id="te"></div>`, { wide: true });
    const draw = () => {
      $("#te", m).innerHTML = `
        <h2>${t.id ? "Edit report type" : "New report type"}</h2>
        <div class="field"><label for="tName">Name</label><input id="tName" value="${esc(t.name)}"></div>
        <div class="field"><label for="tDesc">Short description</label><input id="tDesc" value="${esc(t.description || "")}"></div>
        <p class="small" style="font-weight:600">Sections, in order</p>
        ${t.sections.map((s, i) => `<div class="sec-edit">
          <input data-stitle="${i}" value="${esc(s.title)}" placeholder="Section title">
          <select data-skind="${i}">${KINDS.map(([k, l]) => `<option value="${k}" ${s.kind === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
          <div class="item-tools"><button type="button" data-sup="${i}" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" data-sdown="${i}" ${i === t.sections.length - 1 ? "disabled" : ""}>↓</button><button type="button" data-sdel="${i}">✕</button></div>
        </div>`).join("")}
        <button type="button" class="secondary small" id="sAdd">+ Add section</button>
        <label class="check" style="margin-top:14px;display:flex"><input type="checkbox" id="tActive" ${t.active !== false ? "checked" : ""}> Show in the New Report list</label>
        <div id="tErr" class="error-text"></div>
        <div class="btn-row" style="justify-content:flex-end;margin-top:12px"><button class="secondary" data-cancel>Cancel</button><button data-save>Save</button></div>`;
      const sync = () => {
        t.name = $("#tName", m).value; t.description = $("#tDesc", m).value; t.active = $("#tActive", m).checked;
        $$("[data-stitle]", m).forEach((el) => (t.sections[el.dataset.stitle].title = el.value));
        $$("[data-skind]", m).forEach((el) => (t.sections[el.dataset.skind].kind = el.value));
      };
      $("#sAdd", m).onclick = () => { sync(); t.sections.push({ key: "", title: "", kind: "notes", help: "" }); draw(); };
      $$("[data-sdel]", m).forEach((b) => (b.onclick = () => { sync(); t.sections.splice(Number(b.dataset.sdel), 1); draw(); }));
      $$("[data-sup]", m).forEach((b) => (b.onclick = () => { sync(); const i = Number(b.dataset.sup); [t.sections[i - 1], t.sections[i]] = [t.sections[i], t.sections[i - 1]]; draw(); }));
      $$("[data-sdown]", m).forEach((b) => (b.onclick = () => { sync(); const i = Number(b.dataset.sdown); [t.sections[i + 1], t.sections[i]] = [t.sections[i], t.sections[i + 1]]; draw(); }));
      $("[data-cancel]", m).onclick = close;
      $("[data-save]", m).onclick = async () => {
        sync();
        t.name = t.name.trim();
        t.sections = t.sections.filter((s) => s.title.trim());
        if (!t.name) { $("#tErr", m).textContent = "Give the report type a name."; return; }
        if (!t.sections.length) { $("#tErr", m).textContent = "Add at least one section."; return; }
        t.sections.forEach((s) => {
          let k = s.key || s.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "section";
          while (used.has(k)) k += "_2";
          used.add(k); s.key = k;
        });
        try { await S.saveReportType(t); close(); toast("Report type saved."); renderSettings(); } catch (e) { $("#tErr", m).textContent = S.friendlyError(e); }
      };
    };
    draw();
  }

  // =====================================================================
  // Start up
  // =====================================================================
  async function boot() {
    try {
      const me = await S.getCurrentProfile();
      if (!me) { state.me = null; renderSignIn(); return; }
      if (!me.active) { await S.signOut(); renderSignIn("Your access has been turned off. Ask an admin."); return; }
      if (me.needs_password) { renderSetPassword(); return; }
      state.me = me;
      const [clients, types, settings] = await Promise.all([S.listClients(), S.listReportTypes(), S.getSettings()]);
      state.clients = clients; state.types = types; state.settings = settings;
      R.setMapToken(settings.map_token);
      renderShell();
      onRoute();
    } catch (e) {
      fail(e);
      renderSignIn();
    }
  }

  S.onAuthChange((event) => {
    if (event === "SIGNED_OUT") { state.me = null; renderSignIn(); }
    else if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY" || event === "USER_UPDATED") { if (!state.me || event !== "SIGNED_IN") boot(); }
  });
  $("#signOutBtn").onclick = $("#signOutBtnMobile").onclick = async () => { await flushSave(); await S.signOut(); location.hash = ""; };
  $("#resetDemoBtn").onclick = async () => {
    if (!(await confirmBox("Reset demo data?", "This puts the sample reports back and removes anything you made in demo mode.", "Reset"))) return;
    state.report = null; state.dirty = false;
    await S.resetDemo(); await boot(); go("dashboard");
  };
  boot();
})();
