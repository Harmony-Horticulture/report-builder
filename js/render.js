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

  window.Report = { TIERS, esc, parseRich, richHtml, plain, niceDate, fileBase, sectionHasContent, groupPriorities, signatureLines, reportHtml };
})();
