// =====================================================================
// Data layer. The rest of the app only talks to `Store`, which is either
// the live Supabase database or a demo copy kept in this browser.
// =====================================================================
(function () {
  const cfg = window.HH_CONFIG || {};
  const LIVE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        });
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // The report types we start with (admins can change them in Settings).
  const DEFAULT_TYPES = [
    {
      name: "Monthly Property Care Report",
      description: "Monthly visit: overview, observations with photos and recommendations, priorities and follow-up.",
      sort_order: 1,
      sections: [
        { key: "overview", title: "Overview", kind: "notes", help: "A short summary of the visit and the overall health of the property." },
        { key: "observations", title: "Observations", kind: "observations", help: "What you saw, with an optional photo and a recommendation for each." },
        { key: "priorities", title: "Priorities", kind: "priorities", help: "What needs to happen, grouped Priority 1, Priority 2 and Future/ongoing." },
        { key: "followup", title: "Follow-up", kind: "notes", help: "Next visit, open questions and anything the client needs to do." },
      ],
    },
    {
      name: "Site Visit Photo Report",
      description: "Quick photo report: snap a photo and add a short note for each.",
      sort_order: 2,
      sections: [
        { key: "summary", title: "Visit Summary", kind: "notes", help: "Optional: one or two sentences about the visit." },
        { key: "photos", title: "Site Photos", kind: "photos", help: "Add a photo and a short note for each thing you want to show." },
        { key: "next", title: "Next Steps", kind: "priorities", help: "Optional: what should happen next." },
      ],
    },
    {
      name: "Punch List",
      description: "Estate punch list: a compact table of tasks with photo, priority, who it's assigned to and status, by inspection date. Can start from last month's open items.",
      sort_order: 3,
      sections: [
        { key: "summary", title: "Visit Summary", kind: "notes", help: "Optional: a few sentences about this month's inspections." },
        { key: "punch", title: "Punch List", kind: "punchlist", help: "One line per task. Tap an item to edit it." },
        { key: "followup", title: "Follow-up", kind: "notes", help: "Optional: next inspection and anything the client needs to approve." },
      ],
    },
  ];

  function friendlyError(err) {
    if (!err) return "Something went wrong.";
    const msg = err.message || String(err);
    if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
    if (/Invalid login credentials/i.test(msg)) return "That email and password don't match.";
    if (/duplicate key/i.test(msg)) return "That name is already used.";
    if (/Failed to fetch|NetworkError/i.test(msg)) return "Can't reach the server. Check your connection and try again.";
    return msg;
  }

  // -------------------------------------------------------------------
  // Live (Supabase)
  // -------------------------------------------------------------------
  function makeLiveStore() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    let recovery = false;
    const urlCache = new Map();

    async function check(res) {
      if (res.error) throw new Error(friendlyError(res.error));
      return res.data;
    }
    const appUrl = () => window.location.origin + window.location.pathname.replace(/[^/]*$/, "");
    const redirectTo = () => appUrl();
    async function myId() {
      const { data } = await sb.auth.getSession();
      return data.session ? data.session.user.id : null;
    }

    async function fetchAll(buildQuery) {
      const size = 1000;
      let from = 0;
      let out = [];
      for (;;) {
        const data = await check(await buildQuery().range(from, from + size - 1));
        out = out.concat(data);
        if (data.length < size) return out;
        from += size;
      }
    }

    async function callFunction(name, body) {
      const { data, error } = await sb.functions.invoke(name, { body });
      if (error) {
        let msg = error.message;
        try {
          const j = await error.context.json();
          if (j && j.error) msg = j.error;
        } catch (e) { /* keep the generic message */ }
        if (/Failed to send a request|not found/i.test(msg)) {
          msg = `The "${name}" email/AI helper isn't set up in Supabase yet. See docs/SETUP.md.`;
        }
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    }

    return {
      mode: "live",
      appUrl,
      onAuthChange(cb) {
        sb.auth.onAuthStateChange((event) => {
          if (event === "PASSWORD_RECOVERY") recovery = true;
          setTimeout(() => cb(event), 0);
        });
      },
      async getCurrentProfile() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return null;
        const user = data.session.user;
        const profile = await check(await sb.from("profiles").select("*").eq("id", user.id).maybeSingle());
        if (!profile) return null;
        profile.needs_password = recovery || !(user.user_metadata && user.user_metadata.password_set);
        return profile;
      },
      async signIn(email, password) {
        await check(await sb.auth.signInWithPassword({ email: email.trim(), password }));
      },
      async signOut() { await sb.auth.signOut(); },
      async sendPasswordReset(email) {
        await check(await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() }));
      },
      async setPassword(password) {
        await check(await sb.auth.updateUser({ password, data: { password_set: true } }));
        recovery = false;
      },
      async updateMyProfile(p) {
        await check(await sb.rpc("update_my_report_profile", {
          p_full_name: p.full_name, p_title: p.title, p_credentials: p.credentials, p_phone: p.phone,
        }));
      },

      // People (admin)
      async listPeople() {
        const rows = await check(await sb.rpc("report_people"));
        return rows.sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
      },
      async listInvitations() {
        return check(await sb.from("invitations").select("*").is("accepted_at", null).order("invited_at"));
      },
      async invite({ email, full_name, role }) {
        email = email.trim().toLowerCase();
        const id = await myId();
        await check(await sb.from("invitations").upsert({ email, full_name, role, invited_by: id, invited_at: new Date().toISOString() }));
        await check(await sb.auth.signInWithOtp({
          email, options: { shouldCreateUser: true, emailRedirectTo: redirectTo(), data: { full_name } },
        }));
      },
      async updatePerson(id, patch) {
        await check(await sb.from("profiles").update(patch).eq("id", id));
      },

      // Clients
      async listClients() {
        return fetchAll(() => sb.from("clients").select("*").order("name"));
      },
      async addClient({ name, properties }) {
        return check(await sb.from("clients").insert({ name, properties }).select("*").single());
      },

      // Report types
      async listReportTypes() {
        return check(await sb.from("report_types").select("*").order("sort_order").order("name"));
      },
      async saveReportType(t) {
        const row = { name: t.name, description: t.description || "", sections: t.sections, sort_order: t.sort_order || 0, active: t.active !== false, updated_at: new Date().toISOString() };
        if (t.id) await check(await sb.from("report_types").update(row).eq("id", t.id));
        else await check(await sb.from("report_types").insert(row));
      },

      // Settings
      async getSettings() {
        const row = await check(await sb.from("report_settings").select("*").eq("id", 1).maybeSingle());
        return row || { ai_polish_enabled: false, dictation_terms: [] };
      },
      async saveSettings(s) {
        await check(await sb.from("report_settings").update({ ...s, updated_at: new Date().toISOString() }).eq("id", 1));
      },

      // Reports
      async listReports() {
        return fetchAll(() =>
          sb.from("reports")
            .select("id,user_id,type_name,client_name,property,community,report_date,status,version,consultant,updated_at,sent_at,sent_to")
            .order("updated_at", { ascending: false })
        );
      },
      async getReport(id) {
        return check(await sb.from("reports").select("*").eq("id", id).single());
      },
      async createReport(r) {
        const row = { ...r };
        delete row.id;
        return check(await sb.from("reports").insert(row).select("*").single());
      },
      async saveReport(r) {
        const patch = {
          type_id: r.type_id, type_name: r.type_name, sections: r.sections,
          client_id: r.client_id, client_name: r.client_name, property: r.property, community: r.community,
          contact_name: r.contact_name, contact_email: r.contact_email, report_date: r.report_date,
          consultant: r.consultant, content: r.content, status: r.status, version: r.version,
        };
        return check(await sb.from("reports").update(patch).eq("id", r.id).select("updated_at").single());
      },
      async deleteReport(id) {
        const data = await check(await sb.from("reports").delete().eq("id", id).select("id"));
        if (!data.length) throw new Error("Sent reports can't be deleted.");
      },
      async listSends(reportId) {
        return check(await sb.from("report_sends").select("*").eq("report_id", reportId).order("sent_at", { ascending: false }));
      },

      // Photos
      async uploadPhoto(reportId, blob) {
        const id = uid();
        const path = `${reportId}/${id}.jpg`;
        await check(await sb.storage.from("report-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false }));
        urlCache.set(path, URL.createObjectURL(blob));
        return { id, path };
      },
      async photoUrl(photo) {
        if (!photo || !photo.path) return "";
        if (urlCache.has(photo.path)) return urlCache.get(photo.path);
        const { data, error } = await sb.storage.from("report-photos").download(photo.path);
        if (error) return "";
        const url = URL.createObjectURL(data);
        urlCache.set(photo.path, url);
        return url;
      },

      // Share and send (RC-26, RC-27)
      async shareReport(report, files) {
        let token = report.share_token;
        if (!token) {
          token = uid();
          await check(await sb.from("reports").update({ share_token: token }).eq("id", report.id));
          report.share_token = token;
        }
        const bucket = sb.storage.from("shared-reports");
        for (const [name, blob, type] of files) {
          await check(await bucket.upload(`${token}/${name}`, blob, { contentType: type, upsert: true, cacheControl: "60" }));
        }
        return `${appUrl()}view.html?r=${token}`;
      },
      async sendReport({ report, to, message }) {
        return callFunction("send-report", { report_id: report.id, to, message, app_url: appUrl() });
      },
      sharedFileUrl(token, name) {
        return `${cfg.SUPABASE_URL}/storage/v1/object/public/shared-reports/${token}/${name}`;
      },

      // AI polish (RC-19)
      async polish(fields) {
        const data = await callFunction("polish-report", { fields });
        return data.fields;
      },
      friendlyError,
    };
  }

  // -------------------------------------------------------------------
  // Demo (this browser only). Photos go in IndexedDB because they are
  // too big for localStorage.
  // -------------------------------------------------------------------
  function makeDemoStore() {
    const KEY = "hh_reports_demo_v1";
    const SESSION = "hh_reports_demo_session";
    const listeners = [];
    const notify = (e) => listeners.forEach((cb) => setTimeout(() => cb(e), 0));
    const appUrl = () => window.location.origin + window.location.pathname.replace(/[^/]*$/, "");

    // --- tiny IndexedDB photo store
    let dbp = null;
    function idb() {
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open("hh_reports_demo_photos", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("photos");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbp;
    }
    async function idbOp(mode, fn) {
      const d = await idb();
      return new Promise((resolve, reject) => {
        const tx = d.transaction("photos", mode);
        const req = fn(tx.objectStore("photos"));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      });
    }
    const putBlob = (key, blob) => idbOp("readwrite", (s) => s.put(blob, key));
    const getBlob = (key) => idbOp("readonly", (s) => s.get(key));
    const clearBlobs = () => idbOp("readwrite", (s) => s.clear());
    const urlCache = new Map();

    function seed() {
      const people = [
        { id: "u-admin", email: "krista@example.com", full_name: "Krista", role: "admin", title: "Plant Health Consultant", credentials: "ISA Certified Arborist", phone: "", active: true },
        { id: "u-kristen", email: "kristen@example.com", full_name: "Kristen Moore", role: "consultant", title: "Horticulture Consultant", credentials: "ISA Certified Arborist", phone: "", active: true },
        { id: "u-robbie", email: "robbie@example.com", full_name: "Robbie Stephens", role: "consultant", title: "", credentials: "", phone: "", active: true },
      ];
      const types = DEFAULT_TYPES.map((t) => ({ id: uid(), active: true, updated_at: new Date().toISOString(), ...JSON.parse(JSON.stringify(t)) }));
      return {
        people, invitations: [],
        clientsV2: true,
        clients: (window.HH_DEMO_CLIENTS || []).slice(),
        types,
        settings: { ai_polish_enabled: false, dictation_terms: [{ heard: "acer palmer tum", write: "Acer palmatum" }, { heard: "drip zone", write: "drip zone" }] },
        reports: [], sends: [], seeded_samples: false,
      };
    }

    let db;
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db) db = seed();
    // Demo data saved before the customer list update: bring in the new
    // customers and their contacts, and drop the old title
    if (!db.clientsV2) {
      const byName = new Map(db.clients.map((c) => [c.name.toLowerCase(), c]));
      let next = Math.max(0, ...db.clients.map((c) => c.id)) + 1;
      (window.HH_DEMO_CLIENTS || []).forEach((n) => {
        const c = byName.get(n.name.toLowerCase());
        if (c) Object.assign(c, { contact_name: c.contact_name || n.contact_name, contact_email: c.contact_email || n.contact_email });
        else db.clients.push({ ...n, id: next++ });
      });
      const k = db.people.find((p) => p.id === "u-admin");
      if (k && k.title === "Owner, Plant Health Consultant") k.title = "Plant Health Consultant";
      db.clientsV2 = true;
    }
    const save = () => {
      try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn("Demo data could not be saved", e); }
    };
    save();
    let currentId = null;
    try { currentId = localStorage.getItem(SESSION); } catch (e) { /* ignore */ }
    const me = () => db.people.find((p) => p.id === currentId) || null;
    const isAdmin = () => !!(me() && me().role === "admin");
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const canSee = (r) => isAdmin() || (me() && r.user_id === me().id);

    // Sample photos drawn on a canvas so the demo has something to show
    function samplePhoto(label, hue, w, h) {
      return new Promise((resolve) => {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const g = c.getContext("2d");
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, `hsl(${hue + 160}, 45%, 78%)`);
        grad.addColorStop(0.55, `hsl(${hue}, 40%, 55%)`);
        grad.addColorStop(1, `hsl(${hue - 10}, 45%, 30%)`);
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 60; i++) {
          g.fillStyle = `hsla(${hue + (i % 5) * 6}, 50%, ${25 + (i % 7) * 5}%, 0.55)`;
          const x = (i * 97) % w, y = h * 0.5 + ((i * 53) % (h * 0.5));
          g.beginPath(); g.ellipse(x, y, 20 + (i % 4) * 14, 10 + (i % 3) * 8, (i % 6) / 3, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.font = `600 ${Math.round(w / 22)}px Montserrat, Arial, sans-serif`;
        g.fillText(label, w * 0.05, h * 0.12);
        c.toBlob((b) => resolve(b), "image/jpeg", 0.82);
      });
    }

    async function addSampleReports() {
      if (db.seeded_samples) return;
      db.seeded_samples = true;
      const t1 = db.types[0], t2 = db.types[1];
      const kristen = db.people[1];
      const today = new Date();
      const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return isoDate(d); };
      const cons = (p) => ({ name: p.full_name, title: p.title, credentials: p.credentials, email: p.email, phone: p.phone || "" });
      const ph = async (rid, label, hue, w, h) => {
        const id = uid(); const key = `${rid}/${id}.jpg`;
        await putBlob(key, await samplePhoto(label, hue, w, h));
        return { id, path: key, w, h };
      };
      const r1 = uid(), r2 = uid();
      const content1 = {
        overview: { text: "The property is in **good overall health** after the October overseed. Irrigation is running on the fall schedule.\n- Turf is filling in well along the front entry\n- Two citrus show early signs of iron chlorosis" },
        observations: { items: [
          { id: uid(), photo: await ph(r1, "Sample photo: citrus leaves", 95, 1600, 1200), text: "Yellowing between the veins on new growth of the two Valencia orange trees by the pool.", recommendation: "Apply chelated iron at the label rate this month and check the drip emitters at both trees." },
          { id: uid(), photo: await ph(r1, "Sample photo: palm (tall)", 60, 900, 1600), text: "Fronds on the Mexican fan palm are hanging low over the walkway.", recommendation: "Schedule a palm trim before the holiday party so the walkway is clear." },
          { id: uid(), photo: null, text: "Mulch is thin in the east bed and soil is exposed.", recommendation: "Add 2 to 3 inches of mulch, keeping it 6 inches from trunks." },
        ] },
        priorities: { items: [
          { id: uid(), tier: "p1", text: "Chelated iron for the two Valencia orange trees" },
          { id: uid(), tier: "p2", text: "Palm trim over the walkway" },
          { id: uid(), tier: "future", text: "Re-mulch the east bed in spring" },
        ] },
        followup: { text: "Next visit in four weeks. Please let us know if the gate code changes." },
      };
      db.reports.push({
        id: r1, user_id: kristen.id, type_id: t1.id, type_name: t1.name, sections: clone(t1.sections),
        client_id: 4, client_name: "Adelson Residence", property: "Adelson Residence", community: "",
        contact_name: "Dana Adelson", contact_email: "dana@example.com", report_date: daysAgo(1),
        consultant: cons(kristen), content: content1, status: "review", version: 1, share_token: null,
        sent_at: null, sent_to: null, created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date(Date.now() - 3600000).toISOString(),
      });
      const content2 = {
        summary: { text: "Walked the common areas with the HOA board." },
        photos: { items: [
          { id: uid(), photo: await ph(r2, "Sample photo: entry bed", 110, 1600, 1067), note: "Entry bed is thriving. Lantana and salvia in full bloom." },
          { id: uid(), photo: await ph(r2, "Sample photo: dry wash", 35, 1600, 1200), note: "Erosion starting where the wash meets the sidewalk." },
        ] },
        next: { items: [{ id: uid(), tier: "p1", text: "Add rip rap where the wash meets the sidewalk" }] },
      };
      db.reports.push({
        id: r2, user_id: "u-admin", type_id: t2.id, type_name: t2.name, sections: clone(t2.sections),
        client_id: 13, client_name: "Aviano Community Association", property: "Aviano Community Association", community: "Aviano",
        contact_name: "Pat Rivera", contact_email: "board@example.com", report_date: daysAgo(3),
        consultant: cons(db.people[0]), content: content2, status: "draft", version: 1, share_token: null,
        sent_at: null, sent_to: null, created_at: new Date(Date.now() - 3 * 86400000).toISOString(), updated_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      });
      save();
    }

    return {
      mode: "demo",
      appUrl,
      demoPeople: () => db.people.filter((p) => p.active),
      onAuthChange(cb) { listeners.push(cb); },
      async getCurrentProfile() {
        const p = me();
        if (!p || !p.active) return null;
        await addSampleReports();
        return { ...p, needs_password: false };
      },
      async signInAs(id) {
        currentId = id;
        try { localStorage.setItem(SESSION, id); } catch (e) { /* ignore */ }
        notify("SIGNED_IN");
      },
      async signIn(email) {
        const p = db.people.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase());
        if (!p) throw new Error(friendlyError({ message: "Invalid login credentials" }));
        return this.signInAs(p.id);
      },
      async signOut() {
        currentId = null;
        try { localStorage.removeItem(SESSION); } catch (e) { /* ignore */ }
        notify("SIGNED_OUT");
      },
      async sendPasswordReset() {},
      async setPassword() {},
      async resetDemo() {
        await clearBlobs();
        urlCache.clear();
        db = seed(); save();
        await addSampleReports();
      },
      async updateMyProfile(p) {
        const m = me();
        Object.assign(m, { full_name: p.full_name.trim(), title: p.title.trim(), credentials: p.credentials.trim(), phone: (p.phone || "").trim() });
        save();
      },
      async listPeople() { return clone(db.people).sort((a, b) => a.full_name.localeCompare(b.full_name)); },
      async listInvitations() { return clone(db.invitations); },
      async invite({ email, full_name, role }) {
        if (!isAdmin()) throw new Error("You don't have permission to do that.");
        email = email.trim().toLowerCase();
        if (db.people.some((p) => p.email === email)) throw new Error("That person already has an account.");
        // In demo mode the invite is accepted right away so you can try signing in as them.
        db.people.push({ id: "u-" + uid().slice(0, 8), email, full_name, role, title: "", credentials: "", phone: "", active: true });
        save();
      },
      async updatePerson(id, patch) {
        if (!isAdmin()) throw new Error("You don't have permission to do that.");
        Object.assign(db.people.find((p) => p.id === id), patch); save();
      },
      async listClients() { return clone(db.clients).sort((a, b) => a.name.localeCompare(b.name)); },
      async addClient({ name, properties }) {
        if (!isAdmin()) throw new Error("You don't have permission to do that.");
        if (db.clients.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error("That name is already used.");
        const c = { id: Math.max(0, ...db.clients.map((x) => x.id)) + 1, name, properties, active: true };
        db.clients.push(c); save(); return clone(c);
      },
      async listReportTypes() { return clone(db.types).sort((a, b) => a.sort_order - b.sort_order); },
      async saveReportType(t) {
        if (!isAdmin()) throw new Error("You don't have permission to do that.");
        if (db.types.some((x) => x.name.toLowerCase() === t.name.toLowerCase() && x.id !== t.id)) throw new Error("That name is already used.");
        if (t.id) Object.assign(db.types.find((x) => x.id === t.id), clone(t), { updated_at: new Date().toISOString() });
        else db.types.push({ ...clone(t), id: uid(), active: true, updated_at: new Date().toISOString() });
        save();
      },
      async getSettings() { return clone(db.settings); },
      async saveSettings(s) {
        if (!isAdmin()) throw new Error("You don't have permission to do that.");
        Object.assign(db.settings, clone(s)); save();
      },
      async listReports() {
        return clone(db.reports.filter(canSee)).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      },
      async getReport(id) {
        const r = db.reports.find((x) => x.id === id);
        if (!r || !canSee(r)) throw new Error("Report not found.");
        return clone(r);
      },
      async createReport(r) {
        const now = new Date().toISOString();
        const row = { ...clone(r), id: r.id || uid(), user_id: me().id, status: "draft", version: 1, share_token: null, sent_at: null, sent_to: null, created_at: now, updated_at: now };
        db.reports.push(row); save();
        return clone(row);
      },
      async saveReport(r) {
        const i = db.reports.findIndex((x) => x.id === r.id);
        if (i < 0 || !canSee(db.reports[i])) throw new Error("You don't have permission to do that.");
        const keep = db.reports[i];
        db.reports[i] = { ...clone(r), user_id: keep.user_id, share_token: keep.share_token, sent_at: keep.sent_at, sent_to: keep.sent_to, created_at: keep.created_at, updated_at: new Date().toISOString() };
        save();
        return { updated_at: db.reports[i].updated_at };
      },
      async deleteReport(id) {
        const r = db.reports.find((x) => x.id === id);
        if (!r || !(isAdmin() || (r.user_id === me().id && r.status !== "sent"))) throw new Error("Sent reports can't be deleted.");
        db.reports = db.reports.filter((x) => x.id !== id); save();
      },
      async listSends(reportId) {
        return clone(db.sends.filter((s) => s.report_id === reportId)).sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
      },
      async uploadPhoto(reportId, blob) {
        const id = uid(); const path = `${reportId}/${id}.jpg`;
        await putBlob(path, blob);
        urlCache.set(path, URL.createObjectURL(blob));
        return { id, path };
      },
      async photoUrl(photo) {
        if (!photo || !photo.path) return "";
        if (urlCache.has(photo.path)) return urlCache.get(photo.path);
        const blob = await getBlob(photo.path);
        if (!blob) return "";
        const url = URL.createObjectURL(blob);
        urlCache.set(photo.path, url);
        return url;
      },
      // Demo: the client view reads the report straight from this browser.
      async shareReport(report) {
        const r = db.reports.find((x) => x.id === report.id);
        if (!r.share_token) { r.share_token = uid(); save(); }
        report.share_token = r.share_token;
        return `${appUrl()}view.html?demo=${r.share_token}`;
      },
      async sendReport({ report, to, message }) {
        const r = db.reports.find((x) => x.id === report.id);
        const now = new Date().toISOString();
        db.sends.push({ id: uid(), report_id: r.id, version: r.version, sent_by: me().id, sent_by_name: me().full_name, sent_to: to, message, sent_at: now });
        Object.assign(r, { status: "sent", sent_at: now, sent_to: to });
        save();
        return { ok: true, demo: true };
      },
      demoSharedReport(token) {
        const r = db.reports.find((x) => x.share_token === token);
        return r ? clone(r) : null;
      },
      // Demo stand-in for AI polish: tidies spacing, capital letters and
      // full stops only. It never touches words, so facts can't change.
      async polish(fields) {
        await new Promise((r) => setTimeout(r, 500));
        return fields.map((f) => ({ id: f.id, text: demoTidy(f.text) }));
      },
      friendlyError,
    };
  }

  function demoTidy(text) {
    return String(text || "")
      .split("\n")
      .map((line) => {
        const m = line.match(/^(\s*-\s+)?(.*)$/);
        let body = m[2].replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
        if (!body) return m[1] ? m[1] : "";
        body = body.replace(/(^|[.!?]\s+)([a-z])/g, (s, a, b) => a + b.toUpperCase());
        body = body.replace(/\bi\b/g, "I");
        if (!m[1] && !/[.!?:]$/.test(body.replace(/\*+$/, ""))) body += ".";
        return (m[1] || "") + body;
      })
      .join("\n");
  }

  window.Store = LIVE ? makeLiveStore() : makeDemoStore();
  window.Store.DEFAULT_TYPES = DEFAULT_TYPES;
  window.Store.isoDate = isoDate;
})();
