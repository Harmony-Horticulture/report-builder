// =====================================================================
// Harmony Horticulture SOP documents: one SOP's content turned into
//   - the branded page shown in the app (html)
//   - a branded PDF (jsPDF)
//   - an editable Word file (docx)
// All three follow the layout of the SOP Template: logo, all-caps title,
// pink subtitle over a leaf-green rule, the brown and gray details table,
// numbered section headings, brown table headers and the Harmony footer.
//
// Content shape (stored in sops.content):
// { title, subtitle,
//   meta: { sop_number, version, effective_date, next_review, process_owner,
//           approved_by, applies_to, content_pillar },
//   sections: [{ title, blocks: [
//     { type: "text", text } | { type: "subhead", text } |
//     { type: "bullets", items: [text] } |
//     { type: "callout", rows: [[label, text]] } |
//     { type: "table", head: [..], rows: [[..]] } ] }],
//   revisions: [{ version, date, change, changed_by, approved_by }] }
// Text may mark bold words with **two stars**; a new line starts a new paragraph.
// =====================================================================
(function () {
  const BROWN = "5F351B", PINK = "F065A5", GREEN = "009344", LEAF = "8AC641";
  const TEXT = "1A1A1A", GRAY = "595959", PANEL = "F2F2F2", WHITE = "FFFFFF";
  const FOOTER_LINE = "Science-backed plant care and landscape stewardship";
  const META = [
    ["sop_number", "SOP Number"], ["version", "Version"],
    ["effective_date", "Effective Date"], ["next_review", "Next Review"],
    ["process_owner", "Process Owner"], ["approved_by", "Approved By"],
    ["applies_to", "Applies To"], ["content_pillar", "Content Pillar"],
  ];
  const REV_HEAD = ["Version", "Date", "Description of Change", "Changed By", "Approved By"];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // "Some **bold** words" -> [{text, bold}]
  function runs(text) {
    const out = [];
    String(text || "").split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (!part) return;
      const m = part.match(/^\*\*([^*]+)\*\*$/);
      out.push(m ? { text: m[1], bold: true } : { text: part, bold: false });
    });
    return out;
  }
  const lines = (text) => String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const plain = (text) => String(text || "").replace(/\*\*/g, "");

  // Every SOP ends with its Revision History (numbered after the last section)
  function allSections(c) {
    const secs = (c.sections || []).filter((s) => s && (s.title || (s.blocks || []).length));
    const revs = (c.revisions || []).filter((r) => r && (r.version || r.change));
    return [...secs, { title: "REVISION HISTORY", blocks: [{ type: "table", head: REV_HEAD, rows: revs.map((r) => [r.version, r.date, r.change, r.changed_by, r.approved_by]) }], revision: true }];
  }

  // Relative column widths (they add up to 1)
  function colWidths(block) {
    const head = (block.head || []).map((h) => plain(h).toLowerCase());
    const n = Math.max(head.length, ...(block.rows || []).map((r) => r.length), 1);
    if (block.type === "callout" || n === 2) return [0.27, 0.73];
    if (head[0] === "step" && n === 4) return [0.08, 0.42, 0.14, 0.36];
    if (head[0] === "version" && n === 5) return [0.1, 0.14, 0.44, 0.16, 0.16];
    const avg = [];
    for (let i = 0; i < n; i++) {
      const vals = [block.head ? block.head[i] : "", ...(block.rows || []).map((r) => r[i])].map((v) => plain(v).length);
      avg.push(Math.max(6, vals.reduce((a, b) => a + b, 0) / vals.length));
    }
    const w = avg.map((a) => Math.sqrt(a));
    const sum = w.reduce((a, b) => a + b, 0);
    let out = w.map((x) => Math.max(0.1, x / sum));
    const s2 = out.reduce((a, b) => a + b, 0);
    return out.map((x) => x / s2);
  }

  // ===================================================================
  // In the app
  // ===================================================================
  const inline = (text) => runs(text).map((r) => (r.bold ? `<strong>${esc(r.text)}</strong>` : esc(r.text))).join("");
  const paras = (text) => lines(text).map((l) => `<p>${inline(l)}</p>`).join("") || "<p></p>";

  function blockHtml(b) {
    if (b.type === "subhead") return `<p class="sd-sub">${inline(b.text)}</p>`;
    if (b.type === "bullets") return `<ul class="sd-list">${(b.items || []).filter((i) => String(i).trim()).map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`;
    if (b.type === "callout") {
      return `<table class="sd-table sd-callout"><colgroup><col style="width:27%"><col></colgroup><tbody>${(b.rows || []).map((r) => `<tr><th scope="row">${inline(r[0])}${r[0] && !/[:?]$/.test(plain(r[0])) ? ":" : ""}</th><td>${paras(r[1])}</td></tr>`).join("")}</tbody></table>`;
    }
    if (b.type === "table") {
      const w = colWidths(b);
      return `<div class="sd-scroll"><table class="sd-table"><colgroup>${w.map((x) => `<col style="width:${(x * 100).toFixed(1)}%">`).join("")}</colgroup>
        ${b.head && b.head.length ? `<thead><tr>${b.head.map((h) => `<th>${inline(plain(h))}</th>`).join("")}</tr></thead>` : ""}
        <tbody>${(b.rows || []).map((r) => `<tr>${w.map((_, i) => `<td>${paras(r[i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    return lines(b.text).map((l) => `<p class="sd-text">${inline(l)}</p>`).join("");
  }

  function html(c) {
    const m = c.meta || {};
    const metaRows = [];
    for (let i = 0; i < META.length; i += 2) {
      metaRows.push(`<tr>${[META[i], META[i + 1]].map(([k, label]) => `<th scope="row">${label}:</th><td>${esc(m[k] || "")}</td>`).join("")}</tr>`);
    }
    return `<article class="sopdoc">
      <img class="sd-logo" src="assets/logo.png" alt="Harmony Horticulture">
      <h1 class="sd-title">${esc(c.title || "")}</h1>
      ${c.subtitle ? `<p class="sd-subtitle">${esc(c.subtitle)}</p>` : `<div class="sd-rule"></div>`}
      <div class="sd-scroll"><table class="sd-table sd-meta"><colgroup><col style="width:19%"><col style="width:31%"><col style="width:19%"><col style="width:31%"></colgroup><tbody>${metaRows.join("")}</tbody></table></div>
      ${allSections(c).map((s, i) => `<section class="sd-section"><h2>${i + 1}. ${esc(s.title || "")}</h2>${(s.blocks || []).map(blockHtml).join("")}${s.revision && !(s.blocks[0].rows || []).length ? `<p class="sd-text muted">No changes recorded yet.</p>` : ""}</section>`).join("")}
    </article>`;
  }

  // ===================================================================
  // Shared file pieces
  // ===================================================================
  const cache = {};
  async function bytes(path) {
    cache[path] = cache[path] || fetch(path).then((r) => { if (!r.ok) throw new Error("Couldn't load " + path); return r.arrayBuffer(); }).then((b) => new Uint8Array(b));
    return cache[path];
  }
  function b64(u8) {
    let bin = "";
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const LOGO = { path: "assets/logo.png", w: 844, h: 620 };
  const rgb = (hex) => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];

  // ===================================================================
  // PDF
  // ===================================================================
  async function pdf(c) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
    let F = "Montserrat";
    try {
      for (const [file, style] of [["Montserrat_300Light.ttf", "light"], ["Montserrat_400Regular.ttf", "normal"], ["Montserrat_700Bold.ttf", "bold"]]) {
        doc.addFileToVFS(file, b64(await bytes("fonts/" + file)));
        doc.addFont(file, "Montserrat", style);
      }
    } catch (e) { F = "helvetica"; }
    const font = (style) => doc.setFont(F, F === "helvetica" ? (style === "bold" ? "bold" : "normal") : style);
    const color = (hex) => doc.setTextColor(...rgb(hex));
    const fill = (hex) => doc.setFillColor(...rgb(hex));
    const W = 612, H = 792, M = 54, TOP = 60, BOTTOM = H - 62, CW = W - 2 * M;
    const m = c.meta || {};
    let y = TOP;
    const newPage = () => { doc.addPage(); y = TOP; };
    const ensure = (h) => { if (y + h > BOTTOM) newPage(); };

    // Wrap rich text into lines of words: [{words:[{text,bold}], w}]
    // Montserrat has no arrow or menu-dot symbols: spell them out in the PDF
    const SAFE = { "↑": "Up", "↓": "Down", "←": "<-", "→": "->", "✕": "X", "✓": "Done", "⋮": "(three dots)", "⋯": "...", "☰": "(menu)" };
    const safe = (t) => String(t || "").replace(/[↑↓←→✕✓⋮⋯☰]/g, (ch) => SAFE[ch]);
    function wrap(text, width, size) {
      const out = [];
      for (const para of lines(safe(text))) {
        const words = [];
        runs(para).forEach((r) => r.text.split(/(\s+)/).forEach((t) => { if (t) words.push({ text: t, bold: r.bold }); }));
        let line = [], lw = 0;
        const measure = (wd) => { font(wd.bold ? "bold" : "normal"); doc.setFontSize(size); return doc.getTextWidth(wd.text); };
        for (const wd of words) {
          const ww = measure(wd);
          if (/^\s+$/.test(wd.text)) { if (line.length) { line.push(wd); lw += ww; } continue; }
          if (lw + ww > width && line.length) {
            while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
            out.push({ words: line }); line = []; lw = 0;
          }
          // A single word wider than the column: break it up
          if (ww > width) {
            let chunk = "";
            for (const ch of wd.text) { if (measure({ text: chunk + ch, bold: wd.bold }) > width && chunk) { out.push({ words: [{ text: chunk, bold: wd.bold }] }); chunk = ""; } chunk += ch; }
            line = [{ text: chunk, bold: wd.bold }]; lw = measure(line[0]);
            continue;
          }
          line.push(wd); lw += ww;
        }
        while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
        if (line.length) out.push({ words: line });
        if (out.length) out[out.length - 1].paraEnd = true;
      }
      return out;
    }
    function drawLine(l, x, yy, size, col, forceBold) {
      let cx = x;
      for (const wd of l.words) {
        font(wd.bold || forceBold ? "bold" : "normal"); doc.setFontSize(size); color(col);
        doc.text(wd.text, cx, yy);
        cx += doc.getTextWidth(wd.text);
      }
    }
    const LH = (size) => size * 1.38;

    // Paragraph text that can run across pages
    function paragraph(text, size = 9.5, col = TEXT, indent = 0, after = 6) {
      const ls = wrap(text, CW - indent, size);
      ls.forEach((l, i) => {
        ensure(LH(size));
        drawLine(l, M + indent, y + size, size, col);
        y += LH(size) + (l.paraEnd && i < ls.length - 1 ? 3 : 0);
      });
      y += after;
    }

    // Tables: brown header row (repeated on each page), gray body rows,
    // white gaps between cells, rows never split across pages
    function table(head, rows, widths, opts = {}) {
      const size = opts.size || 8.5, PAD = 5, GAP = 1.5;
      const ws = widths.map((x) => x * CW);
      const cellLines = (row, isHead) => ws.map((w, i) => {
        const t = isHead ? plain(row[i]) : row[i];
        return wrap(t, w - 2 * PAD, size);
      });
      const rowH = (ls) => Math.max(...ls.map((l) => l.length || 1)) * LH(size) + 2 * PAD;
      const drawRow = (row, isHead) => {
        const ls = cellLines(row, isHead);
        const h = rowH(ls);
        let x = M;
        ls.forEach((cl, i) => {
          const labelCol = opts.labelCols && opts.labelCols.includes(i);
          fill(isHead || labelCol ? BROWN : PANEL);
          doc.rect(x + (i ? GAP / 2 : 0), y + GAP / 2, ws[i] - (i ? GAP / 2 : 0) - (i < ws.length - 1 ? GAP / 2 : 0), h - GAP, "F");
          const textH = (cl.length || 1) * LH(size);
          let ty = y + (opts.middle || labelCol ? (h - textH) / 2 : PAD) + size;
          cl.forEach((l) => { drawLine(l, x + PAD, ty, size, isHead || labelCol ? WHITE : TEXT, isHead || labelCol); ty += LH(size); });
          x += ws[i];
        });
        y += h;
      };
      const headH = head ? rowH(cellLines(head, true)) : 0;
      if (head) { ensure(headH + rowH(cellLines(rows[0] || [], false))); drawRow(head, true); }
      rows.forEach((r) => {
        const h = rowH(cellLines(r, false));
        if (y + h > BOTTOM) { newPage(); if (head) drawRow(head, true); }
        drawRow(r, false);
      });
      y += 10;
    }

    // Page 1: logo, title, subtitle and the details table
    try {
      const lw = 92, lh = lw * LOGO.h / LOGO.w;
      doc.addImage(b64(await bytes(LOGO.path)), "PNG", M, y, lw, lh);
      y += lh + 10;
    } catch (e) { /* no logo: carry on */ }
    font("light"); doc.setFontSize(21); color(BROWN);
    doc.splitTextToSize(String(c.title || "").toUpperCase(), CW).forEach((t) => { doc.text(t, M, y + 20); y += 26; });
    y += 2;
    if (c.subtitle) {
      font("normal"); doc.setFontSize(8.5); color(PINK);
      doc.splitTextToSize(String(c.subtitle).toUpperCase(), CW).forEach((t) => { doc.text(t, M, y + 9, { charSpace: 0.3 }); y += 12; });
    }
    doc.setDrawColor(...rgb(LEAF)); doc.setLineWidth(1.2); doc.line(M, y + 4, W - M, y + 4);
    y += 16;
    const metaRows = [];
    for (let i = 0; i < META.length; i += 2) metaRows.push([META[i][1] + ":", m[META[i][0]] || "", META[i + 1][1] + ":", m[META[i + 1][0]] || ""]);
    table(null, metaRows, [0.19, 0.31, 0.19, 0.31], { labelCols: [0, 2], size: 8.5, middle: true });

    allSections(c).forEach((s, si) => {
      ensure(60);
      y += 8;
      font("light"); doc.setFontSize(13.5); color(BROWN);
      doc.text(`${si + 1}. ${String(s.title || "").toUpperCase()}`, M, y + 13);
      y += 24;
      (s.blocks || []).forEach((b) => {
        if (b.type === "subhead") { ensure(40); paragraph(b.text, 9.5, PINK, 0, 3); }
        else if (b.type === "bullets") {
          (b.items || []).filter((i) => String(i).trim()).forEach((item) => {
            const ls = wrap(item, CW - 14, 9.5);
            ls.forEach((l, i) => {
              ensure(LH(9.5));
              if (i === 0) { fill(GREEN); doc.rect(M + 2, y + 4.2, 3.6, 3.6, "F"); }
              drawLine(l, M + 14, y + 9.5, 9.5, TEXT);
              y += LH(9.5);
            });
            y += 2;
          });
          y += 4;
        } else if (b.type === "callout") table(null, (b.rows || []).map((r) => [plain(r[0]) + (r[0] && !/[:?]$/.test(plain(r[0])) ? ":" : ""), r[1]]), [0.27, 0.73], { labelCols: [0], middle: true });
        else if (b.type === "table") {
          const w = colWidths(b);
          const rows = (b.rows || []).map((r) => w.map((_, i) => r[i] || ""));
          if (s.revision && !rows.length) rows.push(["", "", "", "", ""]);
          table(b.head && b.head.length ? b.head : null, rows, w, { middle: false });
        } else paragraph(b.text);
      });
    });

    // Header and footer on every page
    const n = doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p);
      font("normal"); doc.setFontSize(6.5); color(GRAY);
      doc.text(`STANDARD OPERATING PROCEDURE   |   ${String(m.sop_number || c.title || "").toUpperCase()}`, W - M, 32, { align: "right", charSpace: 0.3 });
      const foot = `HARMONY HORTICULTURE   |   ${FOOTER_LINE}   |   Page ${p} of ${n}`;
      doc.text(foot, W / 2, H - 30, { align: "center" });
    }
    doc.setProperties({ title: `Harmony Horticulture SOP - ${titleCase(c.title)}`, subject: c.subtitle || "", author: "Harmony Horticulture", creator: "Harmony Horticulture SOPs" });
    return doc.output("blob");
  }

  // ===================================================================
  // Word
  // ===================================================================
  async function docx(c) {
    const d = window.docx;
    const FONT = "Montserrat", LIGHT = "Montserrat Light";
    const PAGE_W = 12240, PAGE_H = 15840, SIDE = 1080, CONTENT_W = PAGE_W - 2 * SIDE;
    const m = c.meta || {};
    const gap = { style: d.BorderStyle.SINGLE, size: 12, color: WHITE };
    const gapBorders = { top: gap, bottom: gap, left: gap, right: gap, insideHorizontal: gap, insideVertical: gap };
    const shade = (f) => ({ fill: f, type: d.ShadingType.CLEAR, color: "auto" });
    const pad = { top: 90, bottom: 90, left: 140, right: 140 };
    const t = (text, o = {}) => new d.TextRun({ text, ...o });
    const rich = (text, o = {}) => runs(text).map((r) => t(r.text, { bold: r.bold || o.bold, color: o.color, size: o.size }));
    const body = (text, o = {}) => lines(text).map((l) => new d.Paragraph({ style: "HHBody", ...o.p, children: rich(l, o) }));

    function cell(text, o = {}) {
      const ps = lines(text).length ? lines(text).map((l, i, all) => new d.Paragraph({ style: "HHBody", spacing: { after: i === all.length - 1 ? 0 : 60, line: 252 }, children: rich(l, { color: o.white ? WHITE : TEXT, bold: o.bold, size: 18 }) }))
        : [new d.Paragraph({ style: "HHBody", spacing: { after: 0 }, children: [] })];
      return new d.TableCell({ width: { size: o.w, type: d.WidthType.DXA }, shading: shade(o.fill), margins: pad, verticalAlign: o.middle ? d.VerticalAlign.CENTER : d.VerticalAlign.TOP, children: ps });
    }
    function table(head, rows, widths, opts = {}) {
      const ws = widths.map((x) => Math.round(x * CONTENT_W));
      const out = [];
      if (head) out.push(new d.TableRow({ tableHeader: true, cantSplit: true, children: ws.map((w, i) => cell(plain(head[i]), { w, fill: BROWN, white: true, bold: true, middle: true })) }));
      rows.forEach((r) => out.push(new d.TableRow({ cantSplit: true, children: ws.map((w, i) => {
        const label = opts.labelCols && opts.labelCols.includes(i);
        return cell(label ? plain(r[i]) : r[i], { w, fill: label ? BROWN : PANEL, white: label, bold: label, middle: opts.middle || label });
      }) })));
      return new d.Table({ width: { size: CONTENT_W, type: d.WidthType.DXA }, columnWidths: ws, layout: d.TableLayoutType.FIXED, borders: gapBorders, rows: out });
    }
    const spacer = (after = 120) => new d.Paragraph({ style: "HHBody", spacing: { after }, children: [] });

    const children = [];
    try {
      const logo = await bytes(LOGO.path);
      children.push(new d.Paragraph({ spacing: { after: 120 }, children: [new d.ImageRun({ data: logo, type: "png", transformation: { width: 124, height: Math.round(124 * LOGO.h / LOGO.w) }, altText: { title: "Harmony Horticulture", description: "Harmony Horticulture logo", name: "logo" } })] }));
    } catch (e) { /* no logo */ }
    children.push(new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [t(String(c.title || ""))] }));
    children.push(new d.Paragraph({ style: "HHSubtitle", children: [t(String(c.subtitle || ""))] }));
    const metaRows = [];
    for (let i = 0; i < META.length; i += 2) metaRows.push([META[i][1] + ":", m[META[i][0]] || "", META[i + 1][1] + ":", m[META[i + 1][0]] || ""]);
    children.push(table(null, metaRows, [0.19, 0.31, 0.19, 0.31], { labelCols: [0, 2], middle: true }));

    allSections(c).forEach((s, si) => {
      children.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [t(`${si + 1}. ${s.title || ""}`)] }));
      (s.blocks || []).forEach((b) => {
        if (b.type === "subhead") children.push(new d.Paragraph({ style: "HHSub", children: rich(b.text) }));
        else if (b.type === "bullets") (b.items || []).filter((i) => String(i).trim()).forEach((item) => children.push(new d.Paragraph({ style: "HHBody", numbering: { reference: "hh-bullets", level: 0 }, spacing: { after: 60 }, children: rich(item) })));
        else if (b.type === "callout") { children.push(table(null, (b.rows || []).map((r) => [plain(r[0]) + (r[0] && !/[:?]$/.test(plain(r[0])) ? ":" : ""), r[1]]), [0.27, 0.73], { labelCols: [0], middle: true })); children.push(spacer()); }
        else if (b.type === "table") {
          const w = colWidths(b);
          const rows = (b.rows || []).map((r) => w.map((_, i) => r[i] || ""));
          if (s.revision && !rows.length) rows.push(["", "", "", "", ""]);
          children.push(table(b.head && b.head.length ? b.head : null, rows, w));
          children.push(spacer());
        } else children.push(...body(b.text));
      });
    });

    const header = new d.Header({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [t(`Standard Operating Procedure   |   ${m.sop_number || c.title || ""}`, { allCaps: true, size: 14, color: GRAY })] })] });
    const footer = new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [
      t("Harmony Horticulture", { allCaps: true, size: 14, color: GRAY }),
      t(`   |   ${FOOTER_LINE}   |   `, { size: 14, color: GRAY }),
      new d.TextRun({ children: ["Page ", d.PageNumber.CURRENT, " of ", d.PageNumber.TOTAL_PAGES], size: 14, color: GRAY }),
    ] })] });
    let fonts = [];
    try { fonts = [{ name: FONT, data: await bytes("fonts/Montserrat_400Regular.ttf") }, { name: LIGHT, data: await bytes("fonts/Montserrat_300Light.ttf") }]; } catch (e) { fonts = []; }
    const rule = { bottom: { style: d.BorderStyle.SINGLE, size: 10, color: LEAF, space: 6 } };
    const file = new d.Document({
      creator: "Harmony Horticulture", lastModifiedBy: (c.revisions || []).slice(-1)[0]?.changed_by || "Harmony Horticulture",
      title: `Harmony Horticulture SOP - ${titleCase(c.title)}`, subject: c.subtitle || "", keywords: "Harmony Horticulture, SOP",
      fonts, features: { updateFields: false },
      styles: {
        default: {
          document: { run: { font: FONT, size: 20, color: TEXT }, paragraph: { spacing: { after: 100, line: 276, lineRule: d.LineRuleType.AUTO } } },
          title: { run: { font: LIGHT, size: 44, allCaps: true, color: BROWN, bold: false }, paragraph: { spacing: { before: 120, after: 40 } } },
          heading1: { run: { font: LIGHT, size: 28, allCaps: true, color: BROWN, bold: false }, paragraph: { spacing: { before: 320, after: 140 }, keepNext: true, keepLines: true } },
        },
        paragraphStyles: [
          { id: "HHBody", name: "HH Body", basedOn: "Normal", next: "HHBody", quickFormat: true, run: { font: FONT, size: 20, color: TEXT }, paragraph: { spacing: { after: 100, line: 276, lineRule: d.LineRuleType.AUTO } } },
          { id: "HHSubtitle", name: "HH Subtitle", basedOn: "Normal", next: "HHBody", quickFormat: true, run: { font: FONT, size: 18, allCaps: true, color: PINK }, paragraph: { spacing: { after: 240 }, border: rule } },
          { id: "HHSub", name: "HH Subheading", basedOn: "Normal", next: "HHBody", quickFormat: true, run: { font: FONT, size: 20, color: PINK }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true } },
        ],
      },
      numbering: { config: [{ reference: "hh-bullets", levels: [{ level: 0, format: d.LevelFormat.BULLET, text: "■", alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 288 } }, run: { color: GREEN, size: 14 } } }] }] },
      sections: [{
        properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 1008, bottom: 1008, left: SIDE, right: SIDE, header: 480, footer: 480 } } },
        headers: { default: header }, footers: { default: footer }, children,
      }],
    });
    return d.Packer.toBlob(file);
  }

  function titleCase(s) {
    return String(s || "").toLowerCase().replace(/\b([a-z])/g, (x) => x.toUpperCase()).replace(/\b(And|Or|Of|The|A|An|To|For|In|On)\b/g, (w, _, i) => (i ? w.toLowerCase() : w));
  }
  // "Harmony Horticulture SOP - Time Tracking and Client Reports"
  const fileBase = (c) => `Harmony Horticulture SOP - ${titleCase(c.title).replace(/[\\/:*?"<>|]+/g, "").trim()}`;

  // A fresh SOP, laid out like the SOP Template
  function blank(who) {
    return {
      title: "NEW SOP TITLE", subtitle: "ONE-LINE OUTCOME, FOR EXAMPLE CONSISTENT, SCIENCE-BACKED RESULTS EVERY TIME",
      meta: { sop_number: "", version: "1.0", effective_date: "", next_review: "Each January", process_owner: who || "", approved_by: "Kasey", applies_to: "", content_pillar: "Professionalism" },
      sections: [
        { title: "PURPOSE", blocks: [{ type: "text", text: "Why this procedure exists and what it protects." }, { type: "callout", rows: [["Why It Matters", "The result for the client and for the team."]] }] },
        { title: "SCOPE", blocks: [{ type: "subhead", text: "This SOP covers:" }, { type: "bullets", items: [""] }, { type: "subhead", text: "This SOP does not cover:" }, { type: "bullets", items: [""] }] },
        { title: "ROLES AND RESPONSIBILITIES", blocks: [{ type: "table", head: ["Role", "Responsibilities"], rows: [["", ""]] }] },
        { title: "DEFINITIONS", blocks: [{ type: "table", head: ["Term", "Meaning"], rows: [["", ""]] }] },
        { title: "WHAT YOU NEED", blocks: [{ type: "bullets", items: [""] }] },
        { title: "CONTROLS AND COMPLIANCE", blocks: [{ type: "bullets", items: [""] }] },
        { title: "PROCEDURE", blocks: [{ type: "subhead", text: "A. First part:" }, { type: "table", head: ["Step", "Action", "Owner", "Standard / Notes"], rows: [["1", "", "", ""]] }] },
        { title: "QUALITY CHECK", blocks: [{ type: "text", text: "Before you finish, confirm:" }, { type: "bullets", items: [""] }] },
        { title: "TROUBLESHOOTING", blocks: [{ type: "table", head: ["Issue", "Likely Cause", "What to Do"], rows: [["", "", ""]] }] },
        { title: "RELATED DOCUMENTS", blocks: [{ type: "bullets", items: [""] }] },
      ],
      revisions: [],
    };
  }

  window.SopDoc = { html, pdf, docx, blank, fileBase, titleCase, runs, plain, META, colWidths };
})();
