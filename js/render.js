// =====================================================================
// Shared report helpers: simple formatting (bold and bullets), priority
// tiers, file names and the branded on-screen report. Used by the app
// (preview) and by view.html (what the client opens).
// =====================================================================
(function () {
  const TIERS = [
    { key: "p1", label: "Priority 1", sub: "Immediate" },
    { key: "p2", label: "Priority 2", sub: "Near term" },
    { key: "p3", label: "Priority 3", sub: "Next few months" },
    { key: "p4", label: "Priority 4", sub: "This year" },
    { key: "p5", label: "Priority 5", sub: "When time allows" },
    { key: "future", label: "Future / ongoing", sub: "Plan ahead" },
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // "**bold**" and lines starting with "- " (bullets) are the only formatting.
  function parseRuns(line) {
    const runs = [];
    const parts = String(line).split(/(\*\*[^*]+\*\*)/g);
    for (const p of parts) {
      if (!p) continue;
      if (/^\*\*[^*]+\*\*$/.test(p)) runs.push({ text: p.slice(2, -2), bold: true });
      else runs.push({ text: p.replace(/\*\*/g, ""), bold: false });
    }
    return runs;
  }
  function parseRich(text) {
    const blocks = [];
    for (const raw of String(text || "").split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) continue;
      const m = line.match(/^\s*[-•*]\s+(.*)$/);
      if (m) blocks.push({ type: "li", runs: parseRuns(m[1]) });
      else blocks.push({ type: "p", runs: parseRuns(line.trim()) });
    }
    return blocks;
  }
  function richHtml(text) {
    const blocks = parseRich(text);
    let html = "";
    let inList = false;
    for (const b of blocks) {
      const inner = b.runs.map((r) => (r.bold ? `<strong>${esc(r.text)}</strong>` : esc(r.text))).join("");
      if (b.type === "li") {
        if (!inList) { html += "<ul>"; inList = true; }
        html += `<li>${inner}</li>`;
      } else {
        if (inList) { html += "</ul>"; inList = false; }
        html += `<p>${inner}</p>`;
      }
    }
    if (inList) html += "</ul>";
    return html;
  }
  const plain = (text) => parseRich(text).map((b) => (b.type === "li" ? "• " : "") + b.runs.map((r) => r.text).join("")).join("\n");

  function niceDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  function fileBase(r) {
    const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
    return [safe(r.client_name || r.property || "Client"), safe(r.type_name), r.report_date].filter(Boolean).join(" - ");
  }

  function sectionHasContent(sec, c) {
    if (!c) return false;
    if (sec.kind === "notes") return !!String(c.text || "").trim();
    return !!(c.items && c.items.some((i) => (i.photo || String(i.text || i.note || i.recommendation || "").trim())));
  }

  function groupPriorities(items) {
    return TIERS.map((t) => ({ ...t, items: (items || []).filter((i) => (i.tier || "p1") === t.key && String(i.text || "").trim()) })).filter((g) => g.items.length);
  }

  // Punch list: status, short date, groups by inspection date and a count line
  const STATUSES = [
    { key: "open", label: "Open" },
    { key: "progress", label: "In progress" },
    { key: "done", label: "Complete" },
  ];
  const statusLabel = (k) => (STATUSES.find((x) => x.key === k) || STATUSES[0]).label;
  const tierShort = (k) => { const t = TIERS.find((x) => x.key === k); return t ? t.label : ""; };
  function shortDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${m}/${d}/${String(y).slice(-2)}`;
  }
  const punchVisible = (items) => (items || []).filter((i) => i.photo || String(i.text || i.note || "").trim());
  function groupPunch(items) {
    const groups = [];
    for (const it of punchVisible(items)) {
      const key = it.date || "";
      let g = groups.find((x) => x.date === key);
      if (!g) groups.push((g = { date: key, items: [] }));
      g.items.push(it);
    }
    groups.sort((a, b) => (a.date ? (b.date ? a.date.localeCompare(b.date) : -1) : 1));
    for (const g of groups) {
      g.carried = g.items.every((i) => i.carried);
      g.title = (g.date ? `Inspection ${niceDate(g.date)}` : "Inspection date not set") + (g.carried ? " (carried over)" : "");
    }
    return groups;
  }
  function punchCounts(items) {
    const v = punchVisible(items);
    const n = (k) => v.filter((i) => (i.status || "open") === k).length;
    const parts = [`${v.length} item${v.length === 1 ? "" : "s"}`];
    for (const s of STATUSES) if (n(s.key)) parts.push(`${n(s.key)} ${s.label.toLowerCase()}`);
    return parts.join(" · ");
  }
  // The small notes under a punch item's task (approval, carried over)
  function punchTags(it) {
    const tags = [];
    if (it.approval === "yes") tags.push("Approval needed");
    if (it.carried) tags.push(`Carried over from ${shortDate(it.carried)}`);
    return tags;
  }

  // Punch list items in the order the report shows them, numbered 1, 2, 3...
  // The numbers match the pins on the overview map.
  function numberPunch(items) {
    const nums = new Map();
    let n = 0;
    for (const g of groupPunch(items)) for (const it of g.items) nums.set(it.id, ++n);
    return nums;
  }
  const PIN_COLORS = { open: "e8644a", progress: "f3a33a", done: "009344" };
  // Satellite image with a numbered pin per item that has a location.
  // Pins far from the rest (a wrong location) are left off so the map stays on the property.
  // The map key is saved by an admin in Settings (Mapbox public token)
  let mapToken = "";
  const setMapToken = (t) => { mapToken = String(t || "").trim(); };
  function overviewMap(items, w = 680, h = 360) {
    const token = mapToken;
    if (!token) return null;
    const nums = numberPunch(items);
    let pts = punchVisible(items).filter((i) => i.loc && isFinite(i.loc.lat) && isFinite(i.loc.lng)).map((i) => ({ n: nums.get(i.id), lat: +i.loc.lat, lng: +i.loc.lng, st: i.status || "open" }));
    if (!pts.length) return null;
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const cLat = med(pts.map((p) => p.lat)), cLng = med(pts.map((p) => p.lng));
    const meters = (p) => Math.hypot((p.lat - cLat) * 111320, (p.lng - cLng) * 111320 * Math.cos((cLat * Math.PI) / 180));
    const near = pts.filter((p) => meters(p) <= 1500);
    const left = pts.length - near.length;
    pts = near.sort((a, b) => b.n - a.n); // lower numbers drawn last, on top
    const fx = (x) => Number(x.toFixed(6));
    const overlay = pts.filter((p) => p.n <= 99).map((p) => `pin-s-${p.n}+${PIN_COLORS[p.st] || PIN_COLORS.open}(${fx(p.lng)},${fx(p.lat)})`).join(",");
    const view = pts.length === 1 ? `${fx(pts[0].lng)},${fx(pts[0].lat)},18` : "auto";
    const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${overlay}/${view}/${w}x${h}@2x?padding=48&access_token=${encodeURIComponent(token)}`;
    return { url, w, h, count: pts.length, left };
  }

  // Link that opens an item's spot in the phone's or computer's map app
  const mapUrl = (loc) => (loc && isFinite(loc.lat) && isFinite(loc.lng) ? `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}` : "");

  function signatureLines(cons) {
    cons = cons || {};
    return [cons.name, cons.title, cons.credentials, cons.email, cons.phone].filter((x) => x && String(x).trim());
  }

  // photoUrl(photo) returns a URL string for a photo object
  function reportHtml(r, photoUrl) {
    const content = r.content || {};
    const head = [
      ["Property", r.property || r.client_name],
      ["Community", r.community],
      ["Contact", r.contact_name],
      ["Consultant", (r.consultant && r.consultant.name) || ""],
      ["Date", niceDate(r.report_date)],
    ].filter(([, v]) => v && String(v).trim());

    let body = "";
    for (const sec of r.sections || []) {
      const c = content[sec.key];
      if (!sectionHasContent(sec, c)) continue;
      body += `<section class="rp-section"><h2>${esc(sec.title)}</h2>`;
      if (sec.kind === "notes") body += `<div class="rp-rich">${richHtml(c.text)}</div>`;
      if (sec.kind === "observations" || sec.kind === "photos") {
        for (const it of c.items) {
          const text = sec.kind === "photos" ? it.note : it.text;
          if (!it.photo && !String(text || "").trim() && !String(it.recommendation || "").trim()) continue;
          const url = it.photo ? photoUrl(it.photo) : "";
          body += `<div class="rp-obs ${url ? "" : "no-photo"}">`;
          if (url) body += `<div class="rp-photo"><img src="${esc(url)}" alt=""></div>`;
          body += `<div class="rp-obs-text">`;
          if (sec.kind === "observations") {
            if (String(it.text || "").trim()) body += `<p class="rp-label">Observation:</p><div class="rp-rich">${richHtml(it.text)}</div>`;
            if (String(it.recommendation || "").trim()) body += `<p class="rp-label">Recommendation:</p><div class="rp-rich">${richHtml(it.recommendation)}</div>`;
          } else if (String(text || "").trim()) {
            body += `<div class="rp-rich">${richHtml(text)}</div>`;
          }
          body += `</div></div>`;
        }
      }
      if (sec.kind === "punchlist") {
        body += `<p class="rp-count">${esc(punchCounts(c.items))}</p>`;
        // A sent report carries its map as a picture, so the client's link needs no map key
        const map = c.mapImage ? { url: c.mapImage } : overviewMap(c.items);
        if (map) body += `<figure class="rp-map-fig"><img src="${esc(map.url)}" alt="Map of the property with numbered pins for the punch list items" onerror="this.parentNode.style.display='none'">
          <figcaption>Pin numbers match the item numbers below. <span class="pin-key"><i style="background:#e8644a"></i>Open <i style="background:#f3a33a"></i>In progress <i style="background:#009344"></i>Complete</span></figcaption></figure>`;
        const nums = numberPunch(c.items);
        for (const g of groupPunch(c.items)) {
          body += `<h3 class="rp-h3">${esc(g.title)}</h3><table class="rp-table rp-punch"><thead><tr><th>Photo</th><th>Item</th><th>Priority</th><th>Assigned</th><th>Status</th></tr></thead><tbody>`;
          for (const it of g.items) {
            const url = it.photo ? photoUrl(it.photo) : "";
            const tags = punchTags(it);
            body += `<tr class="st-${esc(it.status || "open")}"><td class="rp-pphoto">${url ? `<img src="${esc(url)}" alt="">` : ""}</td>
              <td><span class="rp-num">${nums.get(it.id)}</span>${String(it.text || "").trim() ? `<div class="rp-rich rp-task">${richHtml(it.text)}</div>` : ""}${String(it.note || "").trim() ? `<div class="rp-rich rp-pnote">${richHtml(it.note)}</div>` : ""}${tags.map((x) => `<span class="rp-tag">${esc(x)}</span>`).join("")}${mapUrl(it.loc) ? `<a class="rp-tag rp-map" href="${esc(mapUrl(it.loc))}" target="_blank" rel="noopener">📍 View on map</a>` : ""}</td>
              <td>${esc(tierShort(it.tier))}</td><td>${esc(it.assigned || "")}</td><td class="rp-status">${esc(statusLabel(it.status))}</td></tr>`;
          }
          body += `</tbody></table>`;
        }
      }
      if (sec.kind === "priorities") {
        body += `<table class="rp-table"><thead><tr><th>Priority</th><th>What needs to happen</th></tr></thead><tbody>`;
        for (const g of groupPriorities(c.items)) {
          g.items.forEach((it, i) => {
            body += `<tr>${i === 0 ? `<td class="rp-tier" rowspan="${g.items.length}"><strong>${esc(g.label)}</strong><br><span>${esc(g.sub)}</span></td>` : ""}<td><div class="rp-rich">${richHtml(it.text)}</div></td></tr>`;
          });
        }
        body += `</tbody></table>`;
      }
      body += `</section>`;
    }

    const sig = signatureLines(r.consultant);
    return `
      <article class="rp">
        <header class="rp-head">
          <img class="rp-logo" src="assets/logo.png" alt="Harmony Horticulture">
        </header>
        <h1 class="rp-title">${esc(r.type_name)}</h1>
        <p class="rp-sub">${esc(r.property || r.client_name)}</p>
        <table class="rp-info"><tbody>
          ${head.map(([k, v]) => `<tr><th>${esc(k)}:</th><td>${esc(v)}</td></tr>`).join("")}
        </tbody></table>
        ${body || `<p class="rp-empty">Nothing added yet.</p>`}
        ${sig.length ? `<div class="rp-sig"><p class="rp-label">Prepared by:</p>${sig.map((l, i) => `<div class="${i === 0 ? "rp-sig-name" : ""}">${esc(l)}</div>`).join("")}</div>` : ""}
        <footer class="rp-foot">Harmony Horticulture</footer>
      </article>`;
  }

  window.Report = { TIERS, esc, parseRich, richHtml, plain, niceDate, fileBase, sectionHasContent, groupPriorities, signatureLines, reportHtml, STATUSES, statusLabel, tierShort, shortDate, groupPunch, punchCounts, punchTags, punchVisible, mapUrl, numberPunch, overviewMap, setMapToken };
})();
