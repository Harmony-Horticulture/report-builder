// =====================================================================
// Branded Word (.docx) and PDF files (RC-21, RC-22, RC-23).
// Both are built in the browser from the same report data.
// photos is a Map: photo.id -> { dataUrl, w, h }
// =====================================================================
(function () {
  const R = window.Report;
  const BROWN = "5F351B", PINK = "F065A5", GREEN = "009344", LEAF = "8AC641";
  const TEXT = "1A1A1A", GRAY = "595959", PANEL = "F2F2F2";

  // --- shared loaders ---------------------------------------------------
  const cache = {};
  async function fetchAsDataUrl(url) {
    const blob = await (await fetch(url)).blob();
    return blobToDataUrl(blob);
  }
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  function dataUrlToBytes(dataUrl) {
    const b64 = dataUrl.split(",")[1];
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function imageSize(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 4, h: 3 });
      img.src = dataUrl;
    });
  }
  async function logo() {
    if (!cache.logo) cache.logo = await fetchAsDataUrl("assets/logo.png");
    return cache.logo;
  }
  // Fit inside a box, never stretching (keeps the photo's proportions)
  function fit(w, h, maxW, maxH) {
    const s = Math.min(maxW / w, maxH / h, 1e9);
    return { w: w * s, h: h * s };
  }

  // Collect every photo in the report as a data URL with its size
  async function loadPhotos(report, photoUrl) {
    const map = new Map();
    for (const sec of report.sections || []) {
      const c = (report.content || {})[sec.key];
      if (!c || !c.items) continue;
      for (const it of c.items) {
        if (!it.photo) continue;
        let dataUrl = it.photo.dataUrl;
        if (!dataUrl) {
          const url = await photoUrl(it.photo);
          if (!url) continue;
          dataUrl = await fetchAsDataUrl(url);
        }
        const size = it.photo.w && it.photo.h ? { w: it.photo.w, h: it.photo.h } : await imageSize(dataUrl);
        map.set(it.photo.id, { dataUrl, ...size });
      }
    }
    return map;
  }

  function headerRows(r) {
    return [
      ["Property", r.property || r.client_name],
      ["Community", r.community],
      ["Contact", r.contact_name],
      ["Consultant", (r.consultant && r.consultant.name) || ""],
      ["Date", R.niceDate(r.report_date)],
    ].filter(([, v]) => v && String(v).trim());
  }

  function visibleItems(sec, c) {
    return (c.items || []).filter((it) => it.photo || String(it.text || it.note || it.recommendation || "").trim());
  }

  // =====================================================================
  // Word: modeled on brand/samples/sample-fall-care-checklist.docx.
  // Everything is real Word text, tables and inline pictures, with named
  // styles (Title, Subtitle, Heading 1...), so it all stays editable.
  // =====================================================================
  async function fontBytes(file) {
    cache.fontBytes = cache.fontBytes || {};
    if (!cache.fontBytes[file]) cache.fontBytes[file] = new Uint8Array(await (await fetch("fonts/" + file)).arrayBuffer());
    return cache.fontBytes[file];
  }

  async function buildDocx(report, photos, opts = {}) {
    const d = window.docx;
    const FONT = "Montserrat", LIGHT = "Montserrat Light";
    const PAGE_W = 12240, PAGE_H = 15840, SIDE = 1224, CONTENT_W = PAGE_W - 2 * SIDE; // twips (1/1440 in)
    const PX = 15; // twips per picture pixel
    const none = { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
    const gap = { style: d.BorderStyle.SINGLE, size: 12, color: "FFFFFF" };
    const gapBorders = { top: gap, bottom: gap, left: gap, right: gap, insideHorizontal: gap, insideVertical: gap };
    const rule = (color = LEAF, size = 8) => ({ bottom: { style: d.BorderStyle.SINGLE, size, color, space: 4 } });
    const shade = (fill) => ({ fill, type: d.ShadingType.CLEAR, color: "auto" });
    const cellPad = { top: 100, bottom: 100, left: 160, right: 160 };
    const property = String(report.property || report.client_name || "");
    const cons = report.consultant || {};
    const isPhotoReport = (report.sections || []).some((s) => s.kind === "photos");
    const isPunch = (report.sections || []).some((s) => s.kind === "punchlist");

    const t = (text, o = {}) => new d.TextRun({ text, ...o });
    const runs = (rr, o = {}) => rr.map((r) => t(r.text, { bold: r.bold || o.bold, color: o.color }));
    function rich(text, o = {}) {
      return R.parseRich(text).map((b) =>
        b.type === "li"
          ? new d.Paragraph({ style: "HHBody", numbering: { reference: "hh-bullets", level: 0 }, spacing: { after: 60 }, children: runs(b.runs, o) })
          : new d.Paragraph({ style: "HHBody", children: runs(b.runs, o) })
      );
    }
    const label = (text, o = {}) => new d.Paragraph({ style: "HHLabel", keepNext: true, ...o, children: [t(text)] });
    const kicker = (text) => new d.Paragraph({ style: "HHKicker", keepNext: true, children: [t(text)] });
    function picture(p, maxW, maxH, alt) {
      const s = fit(p.w, p.h, maxW, maxH);
      return new d.Paragraph({
        spacing: { after: 0 },
        children: [new d.ImageRun({
          type: /^data:image\/png/.test(p.dataUrl) ? "png" : "jpg",
          data: dataUrlToBytes(p.dataUrl),
          transformation: { width: Math.round(s.w), height: Math.round(s.h) },
          altText: { title: alt, description: alt, name: alt },
        })],
      });
    }
    // Brown label cell + light gray body cell, like the "Peace of Mind" box in the sample
    function labelBox(rows, labelW = 2300) {
      return new d.Table({
        width: { size: CONTENT_W, type: d.WidthType.DXA }, columnWidths: [labelW, CONTENT_W - labelW],
        layout: d.TableLayoutType.FIXED, borders: gapBorders,
        rows: rows.map(([k, body]) => new d.TableRow({ cantSplit: true, children: [
          new d.TableCell({ width: { size: labelW, type: d.WidthType.DXA }, shading: shade(BROWN), margins: cellPad, verticalAlign: d.VerticalAlign.CENTER,
            children: [new d.Paragraph({ style: "HHBody", spacing: { after: 0 }, children: [t(k, { bold: true, color: "FFFFFF" })] })] }),
          new d.TableCell({ width: { size: CONTENT_W - labelW, type: d.WidthType.DXA }, shading: shade(PANEL), margins: cellPad, verticalAlign: d.VerticalAlign.CENTER,
            children: Array.isArray(body) ? body : [new d.Paragraph({ style: "HHBody", spacing: { after: 0 }, children: [t(String(body))] })] }),
        ] })),
      });
    }
    const spacer = (after = 120) => new d.Paragraph({ spacing: { before: 0, after }, children: [] });

    const children = [];
    const logoUrl = await logo();

    // Top band: logo left, report label right (as in the sample)
    const LOGO_COL = 3400;
    children.push(new d.Table({
      width: { size: CONTENT_W, type: d.WidthType.DXA }, columnWidths: [LOGO_COL, CONTENT_W - LOGO_COL],
      layout: d.TableLayoutType.FIXED, borders: noBorders,
      rows: [new d.TableRow({ children: [
        new d.TableCell({ width: { size: LOGO_COL, type: d.WidthType.DXA }, margins: { top: 0, bottom: 0, left: 0, right: 0 },
          children: [new d.Paragraph({ children: [new d.ImageRun({ type: "png", data: dataUrlToBytes(logoUrl), transformation: { width: 140, height: Math.round(140 * 620 / 844) }, altText: { title: "Harmony Horticulture", description: "Harmony Horticulture logo", name: "Logo" } })] })] }),
        new d.TableCell({ width: { size: CONTENT_W - LOGO_COL, type: d.WidthType.DXA }, margins: { top: 0, bottom: 0, left: 0, right: 0 },
          children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [t(`Client Report  |  ${R.niceDate(report.report_date)}`, { allCaps: true, size: 18, color: GRAY })] })] }),
      ] })],
    }));

    // Title, subtitle and a short welcome in the Harmony voice (editable)
    children.push(new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [t(report.type_name)] }));
    children.push(new d.Paragraph({ style: "HHSubtitle", children: [t(property)] }));
    const greet = String(report.contact_name || "").trim();
    const when = R.niceDate(report.report_date);
    children.push(new d.Paragraph({ style: "HHBody", spacing: { after: 200 }, children: [t(
      isPunch
        ? `${greet ? `Prepared for ${greet}. ` : ""}Thank you for trusting us with the care of ${property}. Below is the punch list from our inspections, with the priority, who it is assigned to and where each item stands as of ${when}.`
        : isPhotoReport
        ? `${greet ? `Prepared for ${greet}. ` : ""}Thank you for trusting us with the care of ${property}. Below are the photos and notes from our visit on ${when}, so you can see exactly what we saw and what comes next.`
        : `${greet ? `Prepared for ${greet}. ` : ""}Thank you for trusting us with the care of ${property}. This report summarizes what we observed on our visit on ${when}, with our recommendations and priorities so you know exactly what to tackle first.`
    )] }));

    const hr = headerRows(report).map(([k, v]) => [k === "Date" ? "Visit date" : k, v]);
    if (hr.length) children.push(labelBox(hr, 2300));

    for (const sec of report.sections || []) {
      const c = (report.content || {})[sec.key];
      if (!R.sectionHasContent(sec, c)) continue;
      children.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [t(sec.title)] }));

      if (sec.kind === "notes") children.push(...rich(c.text));

      if (sec.kind === "observations" || sec.kind === "photos") {
        const photoCol = sec.kind === "photos" ? 4500 : 4300;
        const maxW = Math.floor((photoCol - 240) / PX), maxH = sec.kind === "photos" ? 300 : 280;
        const items = visibleItems(sec, c);
        items.forEach((it, n) => {
          const p = it.photo ? photos.get(it.photo.id) : null;
          const name = sec.kind === "photos" ? `Photo ${n + 1}` : `Observation ${n + 1}`;
          const text = [kicker(name)];
          if (sec.kind === "observations") {
            if (String(it.text || "").trim()) text.push(label("Observation:"), ...rich(it.text));
            if (String(it.recommendation || "").trim()) text.push(label("Recommendation:", { spacing: { before: 120, after: 40 } }), ...rich(it.recommendation));
          } else if (String(it.note || "").trim()) text.push(...rich(it.note));
          const last = n === items.length - 1;
          const rowBorder = last ? none : { style: d.BorderStyle.SINGLE, size: 4, color: "E2E2E2" };
          const cells = p
            ? [
                new d.TableCell({ width: { size: photoCol, type: d.WidthType.DXA }, margins: { top: 160, bottom: 200, left: 0, right: 240 }, borders: { bottom: rowBorder, top: none, left: none, right: none },
                  children: [picture(p, maxW, maxH, `${name}, ${property}`)] }),
                new d.TableCell({ width: { size: CONTENT_W - photoCol, type: d.WidthType.DXA }, margins: { top: 160, bottom: 200, left: 0, right: 0 }, borders: { bottom: rowBorder, top: none, left: none, right: none },
                  children: text }),
              ]
            : [new d.TableCell({ columnSpan: 2, width: { size: CONTENT_W, type: d.WidthType.DXA }, margins: { top: 160, bottom: 200, left: 0, right: 0 }, borders: { bottom: rowBorder, top: none, left: none, right: none }, children: text })];
          children.push(new d.Table({
            width: { size: CONTENT_W, type: d.WidthType.DXA }, columnWidths: [photoCol, CONTENT_W - photoCol],
            layout: d.TableLayoutType.FIXED, borders: noBorders,
            rows: [new d.TableRow({ cantSplit: true, children: cells })],
          }));
        });
      }

      if (sec.kind === "punchlist") {
        // Compact table per inspection date: photo, task (with notes), priority, assigned to, status
        const COLS = [1700, CONTENT_W - 1700 - 1300 - 1300 - 1150, 1300, 1300, 1150];
        const pad = { top: 70, bottom: 70, left: 90, right: 90 };
        const small = (text, o = {}) => new d.Paragraph({ style: "HHBody", spacing: { after: 0 }, children: [t(text, { size: 17, ...o })] });
        const cell = (i, children, o = {}) => new d.TableCell({ width: { size: COLS[i], type: d.WidthType.DXA }, shading: shade(PANEL), margins: pad, children, ...o });
        const smallRich = (text, o = {}) => R.parseRich(text).map((b) => new d.Paragraph({ style: "HHBody", spacing: { after: 30 },
          ...(b.type === "li" ? { numbering: { reference: "hh-bullets", level: 0 } } : {}), children: b.runs.map((r) => t(r.text, { bold: r.bold || o.bold, size: o.size || 17, color: o.color })) }));
        const maxW = Math.floor((COLS[0] - 180) / PX), maxH = 90;
        children.push(new d.Paragraph({ style: "HHBody", children: [t(R.punchCounts(c.items), { size: 17, color: GRAY })] }));
        for (const g of R.groupPunch(c.items)) {
          children.push(kicker(g.title));
          const head = new d.TableRow({ tableHeader: true, cantSplit: true, children: ["Photo", "Item", "Priority", "Assigned", "Status"].map((h, i) =>
            new d.TableCell({ width: { size: COLS[i], type: d.WidthType.DXA }, shading: shade(BROWN), margins: pad,
              children: [small(h, { bold: true, color: "FFFFFF" })] })) });
          const rows = [head];
          g.items.forEach((it) => {
            const p = it.photo ? photos.get(it.photo.id) : null;
            const body = [];
            if (String(it.text || "").trim()) body.push(...smallRich(it.text, { size: 18, bold: true }));
            if (String(it.note || "").trim()) body.push(...smallRich(it.note, { color: GRAY }));
            const tags = R.punchTags(it);
            if (tags.length) body.push(small(tags.join("  ·  "), { size: 15, color: BROWN, italics: true }));
            if (!body.length) body.push(small(""));
            const st = it.status || "open";
            rows.push(new d.TableRow({ cantSplit: true, children: [
              cell(0, [p ? picture(p, maxW, maxH, `Punch list item, ${property}`) : small("")]),
              cell(1, body),
              cell(2, [small(R.tierShort(it.tier))]),
              cell(3, [small(it.assigned || "")]),
              cell(4, [small(R.statusLabel(st), { bold: st !== "open", color: st === "done" ? GREEN : st === "progress" ? "B26B00" : TEXT })]),
            ] }));
          });
          children.push(new d.Table({ width: { size: CONTENT_W, type: d.WidthType.DXA }, columnWidths: COLS, layout: d.TableLayoutType.FIXED, borders: gapBorders, rows }));
        }
      }

      if (sec.kind === "priorities") {
        const TW = 2500;
        const head = new d.TableRow({ tableHeader: true, cantSplit: true, children: ["Priority", "What needs to happen"].map((h, i) =>
          new d.TableCell({ width: { size: i ? CONTENT_W - TW : TW, type: d.WidthType.DXA }, shading: shade(BROWN), margins: cellPad,
            children: [new d.Paragraph({ style: "HHBody", spacing: { after: 0 }, children: [t(h, { bold: true, color: "FFFFFF" })] })] })) });
        const rows = [head];
        for (const g of R.groupPriorities(c.items)) {
          g.items.forEach((it, i) => {
            const cells = [];
            if (i === 0) cells.push(new d.TableCell({ rowSpan: g.items.length, width: { size: TW, type: d.WidthType.DXA }, shading: shade(PANEL), margins: cellPad,
              children: [
                new d.Paragraph({ style: "HHBody", spacing: { after: 0 }, children: [t(g.label, { bold: true, color: BROWN })] }),
                new d.Paragraph({ style: "HHBody", spacing: { after: 0 }, children: [t(g.sub, { size: 17, color: GRAY })] }),
              ] }));
            const body = rich(it.text);
            cells.push(new d.TableCell({ width: { size: CONTENT_W - TW, type: d.WidthType.DXA }, shading: shade(PANEL), margins: { top: 100, bottom: 40, left: 160, right: 160 }, children: body }));
            rows.push(new d.TableRow({ cantSplit: true, children: cells }));
          });
        }
        children.push(new d.Table({ width: { size: CONTENT_W, type: d.WidthType.DXA }, columnWidths: [TW, CONTENT_W - TW], layout: d.TableLayoutType.FIXED, borders: gapBorders, rows }));
      }
    }

    // Signature box (RC-04)
    const sig = R.signatureLines(cons);
    if (sig.length) {
      children.push(spacer(240));
      children.push(labelBox([["Prepared by", sig.map((l, i) => new d.Paragraph({ style: "HHBody", spacing: { after: i === sig.length - 1 ? 0 : 20 },
        children: [t(l, { bold: i === 0, color: i === 0 ? TEXT : GRAY })] }))]], 2300));
    }

    const footer = new d.Footer({ children: [new d.Paragraph({
      alignment: d.AlignmentType.CENTER,
      children: [
        t("Harmony Horticulture", { allCaps: true, size: 16, color: GRAY }),
        t("   |   Science-backed plant care and landscape stewardship   |   ", { size: 16, color: GRAY }),
        new d.TextRun({ children: ["Page ", d.PageNumber.CURRENT, " of ", d.PageNumber.TOTAL_PAGES], size: 16, color: GRAY }),
      ],
    })] });
    const laterHeader = new d.Header({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT,
      children: [t(`${property}  |  ${report.type_name}`, { allCaps: true, size: 16, color: GRAY })] })] });

    // Montserrat travels inside the file, so it looks right on computers without it
    let fonts = [];
    try { fonts = [{ name: FONT, data: await fontBytes("Montserrat_400Regular.ttf") }, { name: LIGHT, data: await fontBytes("Montserrat_300Light.ttf") }]; } catch (e) { fonts = []; }
    if (opts.embedFonts === false) fonts = [];

    const doc = new d.Document({
      creator: cons.name || "Harmony Horticulture",
      lastModifiedBy: cons.name || "Harmony Horticulture",
      title: `${report.type_name} - ${property}`,
      subject: `${report.type_name} for ${property}`,
      keywords: "Harmony Horticulture, property report",
      fonts,
      features: { updateFields: false },
      styles: {
        default: {
          document: { run: { font: FONT, size: 21, color: TEXT }, paragraph: { spacing: { after: 120, line: 276, lineRule: d.LineRuleType.AUTO } } },
          title: { run: { font: LIGHT, size: 48, allCaps: true, color: BROWN, bold: false }, paragraph: { spacing: { before: 280, after: 40 } } },
          heading1: { run: { font: LIGHT, size: 30, allCaps: true, color: BROWN, bold: false }, paragraph: { spacing: { before: 400, after: 160 }, keepNext: true, keepLines: true, border: rule(LEAF, 8) } },
        },
        paragraphStyles: [
          { id: "HHBody", name: "HH Body", basedOn: "Normal", next: "HHBody", quickFormat: true, run: { font: FONT, size: 21, color: TEXT }, paragraph: { spacing: { after: 120, line: 276, lineRule: d.LineRuleType.AUTO } } },
          { id: "HHSubtitle", name: "HH Subtitle", basedOn: "Normal", next: "HHBody", quickFormat: true, run: { font: FONT, size: 22, allCaps: true, color: PINK }, paragraph: { spacing: { after: 200 }, border: rule(LEAF, 8) } },
          { id: "HHLabel", name: "HH Label", basedOn: "Normal", next: "HHBody", quickFormat: true, run: { font: FONT, size: 22, bold: true, color: BROWN }, paragraph: { spacing: { before: 0, after: 40 }, keepNext: true } },
          { id: "HHKicker", name: "HH Item Number", basedOn: "Normal", next: "HHBody", quickFormat: true, run: { font: FONT, size: 16, bold: true, allCaps: true, color: PINK, characterSpacing: 20 }, paragraph: { spacing: { before: 0, after: 80 }, keepNext: true } },
        ],
      },
      numbering: { config: [{ reference: "hh-bullets", levels: [{ level: 0, format: d.LevelFormat.BULLET, text: "■", alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 288 } }, run: { color: GREEN, size: 14 } } }] }] },
      sections: [{
        properties: { titlePage: true, page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 864, bottom: 1008, left: SIDE, right: SIDE, header: 500, footer: 500 } } },
        headers: { first: new d.Header({ children: [new d.Paragraph({ children: [] })] }), default: laterHeader },
        footers: { first: footer, default: footer },
        children,
      }],
    });
    return d.Packer.toBlob(doc);
  }

  // =====================================================================
  // PDF
  // =====================================================================
  const FONTS = [["Montserrat_300Light.ttf", "light"], ["Montserrat_400Regular.ttf", "normal"], ["Montserrat_600SemiBold.ttf", "semibold"], ["Montserrat_700Bold.ttf", "bold"]];
  async function fontData() {
    if (!cache.fonts) {
      cache.fonts = Promise.all(FONTS.map(async ([file, style]) => {
        const buf = await (await fetch("fonts/" + file)).arrayBuffer();
        let bin = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return [file, style, btoa(bin)];
      }));
    }
    return cache.fonts;
  }
  const rgb = (hex) => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];

  async function buildPdf(report, photos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
    let F = "Montserrat";
    try {
      for (const [file, style, b64] of await fontData()) {
        doc.addFileToVFS(file, b64);
        doc.addFont(file, "Montserrat", style);
      }
    } catch (e) { F = "helvetica"; }
    const font = (style) => doc.setFont(F, F === "helvetica" ? (style === "bold" || style === "semibold" ? "bold" : "normal") : style);
    const color = (hex) => doc.setTextColor(...rgb(hex));
    const fill = (hex) => doc.setFillColor(...rgb(hex));

    const W = 612, H = 792, M = 54, BOTTOM = H - 60, CW = W - 2 * M;
    let y = M;
    const newPage = () => {
      doc.addPage();
      y = M;
      font("semibold"); doc.setFontSize(8); color(PINK);
      doc.text(String(report.property || report.client_name || "").toUpperCase(), W - M, M - 18, { align: "right", charSpace: 0.6 });
    };
    const ensure = (h) => { if (y + h > BOTTOM) newPage(); };

    // Write formatted text (bold runs, bullets) inside a column.
    // Breaks onto a new page at line level, so nothing is cut off.
    function richLines(text, width, size) {
      const out = [];
      for (const b of R.parseRich(text)) {
        const indent = b.type === "li" ? 14 : 0;
        const words = [];
        b.runs.forEach((r) => r.text.split(/(\s+)/).forEach((w) => { if (w) words.push({ text: w, bold: r.bold }); }));
        let line = [], lineW = 0;
        const measure = (w) => { font(w.bold ? "bold" : "normal"); doc.setFontSize(size); return doc.getTextWidth(w.text); };
        const flush = (last) => {
          while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
          out.push({ words: line, indent, bullet: b.type === "li" && !out.some((o) => o.blockRef === b), blockRef: b, gapAfter: last ? (b.type === "li" ? 2 : 6) : 0 });
          line = []; lineW = 0;
        };
        for (const w of words) {
          if (/^\s+$/.test(w.text) && !line.length) continue;
          const ww = measure(w);
          if (lineW + ww > width - indent && line.length) flush(false);
          if (/^\s+$/.test(w.text) && !line.length) continue;
          line.push(w); lineW += ww;
        }
        flush(true);
      }
      return out;
    }
    function writeRich(text, x, width, size = 10, lead = 14.5, textColor = TEXT) {
      for (const ln of richLines(text, width, size)) {
        ensure(lead);
        let cx = x + ln.indent;
        if (ln.bullet) { fill(GREEN); doc.circle(x + 4, y + size * 0.62, 1.8, "F"); }
        for (const w of ln.words) {
          font(w.bold ? "bold" : "normal"); doc.setFontSize(size); color(textColor);
          doc.text(w.text, cx, y + size * 0.85);
          cx += doc.getTextWidth(w.text);
        }
        y += lead + ln.gapAfter;
      }
    }
    const richHeight = (text, width, size = 10, lead = 14.5) => richLines(text, width, size).reduce((h, l) => h + lead + l.gapAfter, 0);
    function label(t, x) { ensure(16); font("bold"); doc.setFontSize(10); color(BROWN); doc.text(t, x, y + 9); y += 15; }

    // Logo, unaltered, with clear space
    const lg = await logo();
    const LW = 118, LH = LW * 620 / 844;
    doc.addImage(lg, "PNG", M, y, LW, LH);
    y += LH + 26;

    font("light"); doc.setFontSize(24); color(BROWN);
    for (const line of doc.splitTextToSize(report.type_name.toUpperCase(), CW)) { doc.text(line, M, y + 20, { charSpace: 0.6 }); y += 30; }
    font("semibold"); doc.setFontSize(10); color(PINK);
    doc.text(String(report.property || report.client_name || "").toUpperCase(), M, y + 8, { charSpace: 1 });
    y += 26;

    // Header info table
    const LBL = 110;
    for (const [k, v] of headerRows(report)) {
      font("normal"); doc.setFontSize(10);
      const lines = doc.splitTextToSize(String(v), CW - LBL - 20);
      const h = Math.max(24, lines.length * 14 + 10);
      ensure(h + 2);
      fill(BROWN); doc.rect(M, y, LBL, h, "F");
      fill(PANEL); doc.rect(M + LBL + 2, y, CW - LBL - 2, h, "F");
      font("bold"); color("FFFFFF"); doc.text(k + ":", M + 10, y + 15);
      font("normal"); color(TEXT); lines.forEach((l, i) => doc.text(l, M + LBL + 12, y + 15 + i * 14));
      y += h + 2;
    }

    for (const sec of report.sections || []) {
      const c = (report.content || {})[sec.key];
      if (!R.sectionHasContent(sec, c)) continue;
      y += 18;
      ensure(70);
      font("light"); doc.setFontSize(15); color(BROWN);
      doc.text(sec.title.toUpperCase(), M, y + 14, { charSpace: 0.6 });
      y += 22;
      doc.setDrawColor(...rgb(LEAF)); doc.setLineWidth(1.5); doc.line(M, y, M + CW, y);
      y += 12;

      if (sec.kind === "notes") writeRich(c.text, M, CW);

      if (sec.kind === "observations" || sec.kind === "photos") {
        const PW = sec.kind === "photos" ? 250 : 220, PH = sec.kind === "photos" ? 300 : 260, GAP = 16;
        for (const it of visibleItems(sec, c)) {
          const p = it.photo ? photos.get(it.photo.id) : null;
          const tx = p ? M + PW + GAP : M, tw = p ? CW - PW - GAP : CW;
          const parts = [];
          if (sec.kind === "observations") {
            if (String(it.text || "").trim()) parts.push(["Observation:", it.text]);
            if (String(it.recommendation || "").trim()) parts.push(["Recommendation:", it.recommendation]);
          } else if (String(it.note || "").trim()) parts.push([null, it.note]);
          const textH = parts.reduce((h, [l, t]) => h + (l ? 15 : 0) + richHeight(t, tw), 0);
          let size = null;
          if (p) size = fit(p.w, p.h, PW, PH);
          const blockH = Math.max(size ? size.h : 0, textH);
          // Start the block on a new page if it won't fit, so photos are never split
          if (y + Math.min(blockH, BOTTOM - M) > BOTTOM) newPage();
          const top = y;
          if (p) doc.addImage(p.dataUrl, /^data:image\/png/.test(p.dataUrl) ? "PNG" : "JPEG", M, top, size.w, size.h, undefined, "FAST");
          for (const [l, t] of parts) { if (l) label(l, tx); writeRich(t, tx, tw); }
          if (p && doc.getCurrentPageInfo().pageNumber === doc.getNumberOfPages() && y < top + size.h) y = top + size.h;
          y += 10;
          ensure(14);
          doc.setDrawColor(226, 226, 226); doc.setLineWidth(0.5); doc.line(M, y, M + CW, y);
          y += 14;
        }
      }

      if (sec.kind === "punchlist") {
        // Compact table per inspection date (same columns as Word)
        const COLS = [84, 0, 66, 70, 60], GAP = 2, PAD = 6, SZ = 8.5, LEAD = 11;
        COLS[1] = CW - COLS[0] - COLS[2] - COLS[3] - COLS[4] - 4 * GAP;
        const xs = COLS.reduce((a, w, i) => (a.push(i ? a[i - 1] + COLS[i - 1] + GAP : M), a), []);
        const PH = 64;
        const headRow = () => {
          fill(BROWN); doc.rect(M, y, CW, 18, "F");
          font("bold"); doc.setFontSize(8.5); color("FFFFFF");
          ["Photo", "Item", "Priority", "Assigned", "Status"].forEach((h, i) => doc.text(h, xs[i] + PAD, y + 12));
          y += 18 + GAP;
        };
        const cellLines = (text, w) => { font("normal"); doc.setFontSize(SZ); return doc.splitTextToSize(String(text || ""), w - 2 * PAD); };
        font("normal"); doc.setFontSize(9); color(GRAY); doc.text(R.punchCounts(c.items), M, y + 8); y += 16;
        for (const g of R.groupPunch(c.items)) {
          ensure(70);
          font("bold"); doc.setFontSize(9); color(PINK); doc.text(g.title.toUpperCase(), M, y + 9, { charSpace: 0.4 }); y += 15;
          headRow();
          for (const it of g.items) {
            const p = it.photo ? photos.get(it.photo.id) : null;
            const size = p ? fit(p.w, p.h, COLS[0] - 2 * PAD, PH) : null;
            const tw = COLS[1] - 2 * PAD;
            const tags = R.punchTags(it).join("  ·  ");
            const task = String(it.text || "").split("\n").map((l) => (/^\s*[-•*]\s/.test(l) || /\*\*/.test(l) || !l.trim() ? l : `**${l.trim()}**`)).join("\n");
            const taskH = task.trim() ? richHeight(task, tw, SZ + 0.5, LEAD) : 0;
            const noteH = String(it.note || "").trim() ? richHeight(it.note, tw, SZ, LEAD) : 0;
            const tagLines = tags ? cellLines(tags, COLS[1]) : [];
            const assignedLines = cellLines(it.assigned, COLS[3]);
            const prioLines = cellLines(R.tierShort(it.tier), COLS[2]);
            const h = Math.max(size ? size.h + 2 * PAD : 0, taskH + noteH + tagLines.length * 10 + 2 * PAD - 2, assignedLines.length * LEAD + 2 * PAD, prioLines.length * LEAD + 2 * PAD, 24);
            if (y + h > BOTTOM) { newPage(); headRow(); }
            const top = y;
            fill(PANEL); COLS.forEach((w, i) => doc.rect(xs[i], top, w, h, "F"));
            if (p) doc.addImage(p.dataUrl, /^data:image\/png/.test(p.dataUrl) ? "PNG" : "JPEG", xs[0] + PAD, top + PAD, size.w, size.h, undefined, "FAST");
            y = top + PAD - 2;
            if (taskH) writeRich(task, xs[1] + PAD, tw, SZ + 0.5, LEAD);
            if (noteH) writeRich(it.note, xs[1] + PAD, tw, SZ, LEAD, GRAY);
            if (tagLines.length) { font("normal"); doc.setFontSize(7.5); color(BROWN); tagLines.forEach((l) => { doc.text(l, xs[1] + PAD, y + 7); y += 10; }); }
            const st = it.status || "open";
            font("normal"); doc.setFontSize(SZ); color(TEXT);
            prioLines.forEach((l, i) => doc.text(l, xs[2] + PAD, top + PAD + 7 + i * LEAD));
            assignedLines.forEach((l, i) => doc.text(l, xs[3] + PAD, top + PAD + 7 + i * LEAD));
            font(st === "open" ? "normal" : "bold"); color(st === "done" ? GREEN : st === "progress" ? "B26B00" : TEXT);
            doc.text(R.statusLabel(st), xs[4] + PAD, top + PAD + 7);
            y = top + h + GAP;
          }
          y += 8;
        }
      }

      if (sec.kind === "priorities") {
        const TW = 130, PAD = 9;
        const headRow = () => {
          fill(BROWN); doc.rect(M, y, CW, 24, "F");
          font("bold"); doc.setFontSize(10); color("FFFFFF");
          doc.text("Priority", M + PAD, y + 16); doc.text("What needs to happen", M + TW + 2 + PAD, y + 16);
          y += 26;
        };
        ensure(60); headRow();
        for (const g of R.groupPriorities(c.items)) {
          g.items.forEach((it, i) => {
            const th = richHeight(it.text, CW - TW - 2 - 2 * PAD);
            const h = Math.max(i === 0 ? 34 : 22, th + 2 * PAD - 4);
            if (y + h > BOTTOM) { newPage(); headRow(); }
            fill(PANEL); doc.rect(M, y, TW, h, "F"); doc.rect(M + TW + 2, y, CW - TW - 2, h, "F");
            if (i === 0) {
              font("bold"); doc.setFontSize(10); color(BROWN); doc.text(g.label, M + PAD, y + 16);
              font("normal"); doc.setFontSize(8); color(GRAY); doc.text(g.sub, M + PAD, y + 27);
            }
            const save = y; y += PAD - 2;
            writeRich(it.text, M + TW + 2 + PAD, CW - TW - 2 - 2 * PAD);
            y = save + h + 2;
          });
        }
      }
    }

    const sig = R.signatureLines(report.consultant);
    if (sig.length) {
      y += 24; ensure(20 + sig.length * 14);
      font("bold"); doc.setFontSize(10); color(BROWN); doc.text("Prepared by:", M, y + 9); y += 18;
      sig.forEach((l, i) => { font(i === 0 ? "bold" : "normal"); color(i === 0 ? TEXT : GRAY); doc.text(l, M, y + 9); y += 14; });
    }

    // Footer on every page
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setDrawColor(...rgb(LEAF)); doc.setLineWidth(0.75); doc.line(M, H - 42, W - M, H - 42);
      font("normal"); doc.setFontSize(8); color(GRAY);
      doc.text("Harmony Horticulture", M, H - 28);
      doc.text(`Page ${i} of ${n}`, W - M, H - 28, { align: "right" });
    }
    doc.setProperties({ title: `${report.type_name} - ${report.property || report.client_name}`, author: (report.consultant && report.consultant.name) || "Harmony Horticulture", creator: "Harmony Horticulture" });
    return doc.output("blob");
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  window.Exports = { loadPhotos, buildDocx, buildPdf, download, blobToDataUrl, fetchAsDataUrl };
})();
