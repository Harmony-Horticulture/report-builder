// =====================================================================
// Lead report: the branded page a lead is sent out as when it's assigned.
//   lead-report.html?k=<token>   a real report (opens without a login)
//   lead-report.html?sample      an example with made-up data and photos
//   lead-report.html?demo=<id>   a report made on the Leads demo page
// The report is a copy of the lead made when it was assigned. Sending
// it again from the lead card updates it.
// =====================================================================
(function () {
  const cfg = window.HH_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const linkify = (t) => esc(t).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.includes("drive.google.com") ? "Open file in Google Drive" : u}</a>`);
  const para = (t) => linkify(t).replace(/\n/g, "<br>");
  const tel = (p) => String(p || "").replace(/[^\d+]/g, "");

  // ------------------------------------------------------------------
  // Where the report comes from
  // ------------------------------------------------------------------
  async function load() {
    if (params.has("sample")) return sample();
    if (params.get("demo")) {
      const db = JSON.parse(localStorage.getItem("hh-leads-demo-v1") || "{}");
      const lead = (db.leads || []).find((l) => l.id === params.get("demo"));
      const r = lead && lead.details && lead.details.report;
      if (!r) throw new Error("This demo report isn't in this browser. Assign a lead on the Leads demo page first.");
      return { ...r, photos: (r.photos || []).map((p) => ({ url: p.path, name: p.name })) };
    }
    const k = params.get("k");
    if (!k) throw new Error("This report link isn't complete. Ask whoever sent it for the link again.");
    if (!cfg.SUPABASE_URL) throw new Error("The app isn't connected yet.");
    const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/leads-inbox?report=${encodeURIComponent(k)}`, {
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.report) throw new Error(j.error || "Couldn't load the report. Try again in a minute.");
    return j.report;
  }

  // Made-up lead so you can see how a report looks
  async function sample() {
    const shots = [["Front entry", 1600, 1200], ["Citrus grove", 1600, 1067], ["Back yard palms", 1200, 1600], ["Irrigation controller", 1600, 1200], ["Rose bed", 1600, 1000], ["Side yard", 1600, 1200]];
    const photos = [];
    for (const [label, w, h] of shots) {
      const blob = await window.HHSample.photo(label, w, h);
      photos.push({ url: URL.createObjectURL(blob), name: label });
    }
    const today = new Date();
    return {
      v: 1, sample: true,
      title: "Desert Bloom Residence", contact_name: "Morgan Example", company: "",
      phone: "480-555-0142", email: "morgan@example.com", address: "1234 E Sample Ranch Rd, Scottsdale, AZ 85262",
      stage: "Intake received", channel: "Phone call", lead_date: today.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      heard_about: "Referral from a person: Taylor Sample", service: "Oversight", zone_quote: "$350",
      request: "Citrus grove looks stressed after the summer. Two queen palms in the back yard are browning from the top down, and the rose bed by the front entry hasn't bloomed this year.",
      goals: "A care plan our landscaper can follow, and to know whether the palms can be saved before the holidays.",
      next_steps: "Site visit this week. Bring soil probe and check the drip on the citrus zone.",
      note: "Hi! This one's yours. Morgan prefers texts before 10 AM. Gate code is in Property details.",
      assignee: "Krista", assigned_by: "Kasey", assigned_at: today.toISOString(),
      sections: [
        { title: "Client information", rows: [["Contact Name", "Morgan Example"], ["Property Name", "Desert Bloom Residence"], ["Phone", "480-555-0142"], ["Email", "morgan@example.com"], ["Property Manager Name", "Jordan Placeholder"], ["Property Manager Phone", "480-555-0177"]] },
        { title: "Billing information", rows: [["Service Frequency", "Oversight"], ["A/P Contact Name", "Morgan Example"], ["W9 Required?", "No"], ["COI Required?", "Yes"]] },
        { title: "Property details", rows: [["Gate Code", "#2468"], ["Pets", "One friendly dog, usually inside"], ["Controller Type", "Hunter Hydrawise"], ["Number of Controllers", "1"], ["Number of Zones", "14"], ["Parking", "Driveway is fine"], ["Living Turfgrass", "No"], ["Synthetic Turf", "Yes"]] },
        { title: "Current and past providers", rows: [["Landscape Maintenance", "Sample Landscaping Co. (weekly)"], ["Pest Control", "Quarterly"]] },
        { title: "Additional information", rows: [["Upcoming events", "Family visiting for the holidays, December 20"], ["Enhancements", "Interested in adding pollinator plants along the side yard"], ["Newsletter email", "morgan@example.com"]] },
      ],
      photos,
    };
  }

  // ------------------------------------------------------------------
  // The page
  // ------------------------------------------------------------------
  function render(r) {
    document.title = `${r.title || "Lead"} · Lead Report · Harmony Horticulture`;
    const sent = r.assigned_at ? new Date(r.assigned_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
    const glance = [["Stage", r.stage], ["Came in by", r.channel], ["Lead date", r.lead_date], ["Service", r.service], ["Zone quote", r.zone_quote], ["Heard about us", r.heard_about]].filter(([, v]) => v);
    const contact = [
      r.phone ? `<a class="lr-chip" href="tel:${esc(tel(r.phone))}"><b>Call</b>${esc(r.phone)}</a>` : "",
      r.phone ? `<a class="lr-chip" href="sms:${esc(tel(r.phone))}"><b>Text</b>${esc(r.phone)}</a>` : "",
      r.email ? `<a class="lr-chip" href="mailto:${esc(r.email)}"><b>Email</b>${esc(r.email)}</a>` : "",
      r.address ? `<a class="lr-chip" href="https://maps.google.com/?q=${encodeURIComponent(r.address)}" target="_blank" rel="noopener"><b>Map</b>${esc(r.address)}</a>` : "",
    ].join("");
    const photos = r.photos || [];
    $("#lrBody").innerHTML = `
      ${r.sample ? `<p class="lr-sample no-print">This is an example with made-up details and drawn photos, to show how a lead report looks.</p>` : ""}
      <article class="lr-page">
        <header class="lr-head">
          <div class="lr-head-top">
            <img src="assets/logo-reversed.png" alt="Harmony Horticulture" class="lr-logo">
            <div class="lr-assigned">
              <div class="lr-eyebrow">Assigned to</div>
              <div class="lr-who">${esc(r.assignee || "")}</div>
              ${r.assigned_by || sent ? `<div class="lr-by">${[r.assigned_by ? "From " + esc(r.assigned_by) : "", esc(sent)].filter(Boolean).join(" · ")}</div>` : ""}
            </div>
          </div>
          <div class="lr-eyebrow lr-kicker">Lead report</div>
          <h1>${esc(r.title || "New lead")}</h1>
          ${r.contact_name && r.contact_name !== r.title ? `<p class="lr-sub">${esc(r.contact_name)}${r.company ? " · " + esc(r.company) : ""}</p>` : ""}
        </header>

        ${glance.length ? `<section class="lr-glance">${glance.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("")}</section>` : ""}

        <div class="lr-inner">
          ${r.note ? `<section class="lr-note"><div class="lr-eyebrow">A note from ${esc(r.assigned_by || "the office")}</div><p>${para(r.note)}</p></section>` : ""}
          ${contact ? `<section><h2>Contact</h2><div class="lr-chips">${contact}</div></section>` : ""}
          ${r.request || r.goals ? `<section><h2>What they need</h2>
            ${r.request ? `<p class="lr-lede">${para(r.request)}</p>` : ""}
            ${r.goals ? `<div class="lr-goal"><span>Their goals</span><p>${para(r.goals)}</p></div>` : ""}</section>` : ""}
          ${r.next_steps ? `<section class="lr-next"><h2>Next steps</h2><p>${para(r.next_steps)}</p></section>` : ""}
          ${photos.length ? `<section><h2>Photos</h2><div class="lr-photos">${photos.map((p) => `<figure><a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="${esc(p.name || "Property photo")}" loading="lazy"></a>${p.name ? `<figcaption>${esc(p.name)}</figcaption>` : ""}</figure>`).join("")}</div></section>` : ""}
          ${(r.sections || []).filter((s) => s.rows && s.rows.length).map((s) => `<section class="lr-sec"><h2>${esc(s.title)}</h2>
            <dl>${s.rows.map(([q, a]) => `<div><dt>${esc(q)}</dt><dd>${para(a)}</dd></div>`).join("")}</dl></section>`).join("")}
        </div>
        <footer class="lr-foot">
          <div class="lr-stripe"><i></i><i></i><i></i><i></i></div>
          <p><strong>Harmony Horticulture</strong> · For our team only. Please don't forward this link outside Harmony.</p>
        </footer>
      </article>`;
    $("#lrActions").innerHTML = `<button type="button" id="lrPrint">Print or save PDF</button>`;
    $("#lrPrint").onclick = () => window.print();
  }

  load().then(render).catch((e) => {
    $("#lrBody").innerHTML = `<div class="lr-msg"><h1>Can't open this report</h1><p>${esc(e.message || e)}</p></div>`;
  });
})();
