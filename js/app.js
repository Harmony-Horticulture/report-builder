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
  }

  function renderSignIn(message) {
    if (S.mode === "demo") {
      const people = S.demoPeople();
      showAuth(`
        <h1>Welcome</h1>
        <p class="muted small" style="text-align:center">Demo mode. Pick someone to try the app as. Nothing here is saved online or emailed.</p>
        ${people.map((p) => `<button class="primary ${p.role === "admin" ? "" : "secondary"}" data-as="${esc(p.id)}" style="margin-bottom:8px">Sign in as ${esc(p.full_name)} · ${p.role}</button>`).join("")}
        <p class="hint" style="text-align:center">Robbie hasn't filled in a profile yet, so he sees the first-time profile screen.</p>
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
      <p class="small muted" style="text-align:center">Welcome to Harmony Horticulture. Pick a password for your account (at least 8 characters).</p>
      <div class="field"><label for="np1">New password</label><input id="np1" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="np2">Type it again</label><input id="np2" type="password" autocomplete="new-password"></div>
      <div id="npErr" class="error-text"></div>
      <button class="primary" id="npSave">Save password</button>`);
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
    { route: "settings", label: "Settings", admin: true },
  ];
  function renderShell() {
    $("#loading").classList.add("hidden");
    $("#authView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    $("#whoName").textContent = state.me.full_name || state.me.email;
    $("#whoRole").textContent = state.me.role === "admin" ? "Admin" : "Consultant";
    $("#demoBanner").classList.toggle("hidden", S.mode !== "demo");
    const items = NAV.filter((n) => !n.admin || isAdmin());
    $("#sideNav").innerHTML = items.map((n, i) =>
      (n.admin && !items[i - 1].admin ? `<div class="nav-label">Admin</div>` : "") + `<button type="button" data-route="${n.route}">${n.label}</button>`).join("");
    $("#bottomNav").innerHTML = items.map((n) => `<button type="button" data-route="${n.route}">${n.label}</button>`).join("");
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
    if (p[0] === "item") { const it = ((r.content[p[1]] || {}).items || []).find((i) => i.id === p[2]); return it ? it[p[3]] || "" : ""; }
    return "";
  }
  function setPath(r, path, value) {
    const p = path.split(":");
    if (p[0] === "head") r[p[1]] = value;
    if (p[0] === "sec") { r.content[p[1]] = r.content[p[1]] || {}; r.content[p[1]].text = value; }
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
          <div class="field"><label>Consultant</label><input value="${esc([r.consultant.name, r.consultant.title].filter(Boolean).join(", "))}" disabled></div>
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
                <label class="btn"><input type="file" accept="image/*" capture="environment" data-photo data-sec="${esc(s.key)}" data-id="${esc(it.id)}">${it.photo ? "Retake" : "Camera"}</label>
                <label class="btn secondary"><input type="file" accept="image/*" data-photo data-sec="${esc(s.key)}" data-id="${esc(it.id)}">Library</label>
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
    if (s.kind === "priorities") {
      for (const t of R.TIERS) {
        const items = (c.items || []).filter((i) => (i.tier || "p1") === t.key);
        if (!items.length) continue;
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
      }
      inner += `<div class="btn-row" style="margin-top:8px">${R.TIERS.map((t) => `<button type="button" class="secondary small" data-addprio="${t.key}" data-sec="${esc(s.key)}">+ ${esc(t.label)}</button>`).join("")}</div>`;
    }
    return `<div class="card sec-card" id="sec_${esc(s.key)}"><h2>${esc(s.title)}</h2>${s.help ? `<p class="sec-help">${esc(s.help)}</p>` : ""}${inner}</div>`;
  }

  function sectionItems(key) { return state.report.content[key].items; }

  async function redraw() {
    const y = window.scrollY;
    await drawEditor();
    window.scrollTo(0, y);
  }

  function bindEditor() {
    const r = state.report;
    $$("[data-path]").forEach((el) => {
      el.oninput = el.onchange = () => { setPath(r, el.dataset.path, el.value); scheduleSave(); };
    });
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
        ta.value = /^\s*-\s/.test(v.slice(ls)) ? v.slice(0, ls) + v.slice(ls).replace(/^\s*-\s/, "") : v.slice(0, ls) + "- " + v.slice(ls);
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
      if (b.dataset.tiered !== undefined) {
        const tier = items[i].tier;
        while (j >= 0 && j < items.length && items[j].tier !== tier) j += dir;
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
        it.photo = await addPhoto(file);
        scheduleSave(); await redraw();
        toast("Photo added.");
      } catch (e) { fail(e); }
    }));
    $$("[data-multi]").forEach((inp) => (inp.onchange = async () => {
      const files = Array.from(inp.files || []).sort((a, b) => a.lastModified - b.lastModified); // in the order taken
      if (!files.length) return;
      try {
        toast(`Adding ${files.length} photo${files.length > 1 ? "s" : ""}…`);
        for (const f of files) sectionItems(inp.dataset.sec).push({ id: uid(), photo: await addPhoto(f), note: "" });
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

    $("#previewBtn").onclick = $("#previewBtn2").onclick = async () => {
      if (!r.client_id && !r.client_name && !r.property) { toast("Pick the client first.", true); return; }
      await flushSave();
      location.hash = "#/review/" + r.id;
    };
    $("#delBtn").onclick = async () => {
      if (!(await confirmBox("Delete this draft?", "The draft and its photos will be removed. This can't be undone.", "Delete", true))) return;
      try { clearTimeout(state.saveTimer); state.dirty = false; await S.deleteReport(r.id); state.report = null; toast("Draft deleted."); go("dashboard"); } catch (e) { fail(e); }
    };
  }

  async function pickClient(id) {
    const r = state.report;
    const c = state.clients.find((x) => x.id === id);
    r.client_id = c.id;
    r.client_name = c.name;
    r.property = (c.properties && c.properties[0]) || c.name;
    // Fill contact details from this client's last report
    try {
      const prev = (await S.listReports()).filter((x) => x.client_name === c.name && x.id !== r.id)[0];
      if (prev) {
        const full = await S.getReport(prev.id);
        if (!r.contact_name) r.contact_name = full.contact_name || "";
        if (!r.contact_email) r.contact_email = full.contact_email || "";
        if (!r.community) r.community = full.community || "";
      }
    } catch (e) { /* not important */ }
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

  // --- Dictation (RC-17, RC-18) ----------------------------------------
  let rec = null, recBtn = null;
  function applyTerms(text) {
    let out = text;
    for (const t of state.settings.dictation_terms || []) {
      if (!t.heard || !t.write) continue;
      out = out.replace(new RegExp("\\b" + t.heard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+") + "\\b", "gi"), t.write);
    }
    return out;
  }
  function toggleDictation(btn) {
    if (rec) { rec.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Dictation isn't available in this browser. Use Chrome or Safari, or the microphone on your phone's keyboard.", true); return; }
    if (!navigator.onLine) { toast("Dictation needs an internet connection on this device. You can still use your keyboard's microphone.", true); return; }
    const ta = $(`textarea[data-path="${CSS.escape(btn.dataset.mic)}"]`);
    rec = new SR();
    rec.lang = "en-US"; rec.continuous = true; rec.interimResults = false;
    recBtn = btn; btn.classList.add("listening");
    rec.onresult = (ev) => {
      let said = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) said += ev.results[i][0].transcript;
      said = applyTerms(said.trim());
      if (!said) return;
      ta.value = ta.value + (ta.value && !/\s$/.test(ta.value) ? " " : "") + said;
      ta.dispatchEvent(new Event("input"));
    };
    rec.onerror = (e) => { if (e.error === "not-allowed") toast("Allow microphone access to dictate.", true); else if (e.error === "network") toast("Dictation needs an internet connection.", true); };
    rec.onend = () => { if (recBtn) recBtn.classList.remove("listening"); rec = null; recBtn = null; };
    try { rec.start(); toast("Listening… tap the microphone again to stop."); } catch (e) { rec = null; btn.classList.remove("listening"); }
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
          if (String(it[f] || "").trim()) out.push({ id: `item:${s.key}:${it.id}:${f}`, section: s.title, label: `${s.title} ${n + 1} · ${f === "text" ? (s.kind === "priorities" ? "Priority" : "Observation") : f[0].toUpperCase() + f.slice(1)}`, text: it[f] });
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
          <div class="field"><label for="ivRole">Role</label><select id="ivRole"><option value="consultant">Consultant</option><option value="admin">Admin</option></select></div>
          <div class="field" style="padding-top:28px"><button type="button" id="ivSend" style="width:100%">Send invitation</button></div>
        </div>
        ${invites.length ? `<p class="small"><b>Waiting to accept:</b> ${invites.map((i) => `${esc(i.full_name || i.email)} (${esc(i.email)}, ${esc(i.role)})`).join("; ")}</p>` : ""}
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Title</th><th>Role</th><th>Active</th></tr></thead>
        <tbody>${people.map((p) => `<tr>
          <td>${esc(p.full_name)}</td><td>${esc(p.email)}</td><td>${esc([p.title, p.credentials].filter(Boolean).join(", "))}</td>
          <td><select data-role="${esc(p.id)}" ${p.id === state.me.id ? "disabled" : ""}><option value="consultant" ${p.role === "consultant" ? "selected" : ""}>Consultant</option><option value="admin" ${p.role === "admin" ? "selected" : ""}>Admin</option></select></td>
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
        <h2>Report types</h2>
        <p class="small muted">Changes apply to new reports only. Reports already started keep their sections.</p>
        <div id="typeList">${state.types.map((t) => `
          <div class="rlist"><div class="row" data-edittype="${esc(t.id)}"><div><div class="t">${esc(t.name)}${t.active === false ? ' <span class="small muted">(hidden)</span>' : ""}</div><div class="m">${t.sections.map((s) => esc(s.title)).join(" · ")}</div></div><button class="secondary small" type="button">Edit</button></div></div>`).join("")}</div>
        <div class="btn-row" style="margin-top:10px"><button id="addType" type="button">+ Add report type</button></div>
      </div>`;
    $("#aiOn").onchange = async () => {
      try { await S.saveSettings({ ai_polish_enabled: $("#aiOn").checked }); state.settings.ai_polish_enabled = $("#aiOn").checked; toast($("#aiOn").checked ? "AI polish is on." : "AI polish is off."); } catch (e) { fail(e); }
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
    const KINDS = [["notes", "Notes"], ["observations", "Observations (photo + recommendation)"], ["photos", "Photos with notes"], ["priorities", "Priorities (3 tiers)"]];
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
        const used = new Set();
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
