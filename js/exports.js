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
      ["Consultant", [r.consultant && r.consultant.name, r.consultant && r.consultant.title].filter(Boolean).join(", ")],
      ["Date", R.niceDate(r.report_date)],
    ].filter(([, v]) => v && String(v).trim());
  }

  function visibleItems(sec, c) {
    return (c.items || []).filter((it) => it.photo || String(it.text || it.note || it.recommendation || "").trim());
  }

  // =====================================================================
  // Word
  // =====================================================================
  async function buildDocx(report, photos) {
    const d = window.docx;
    const FONT = "Montserrat";
    const none = { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
    const white = { style: d.BorderStyle.SINGLE, size: 6, color: "FFFFFF" };
    const whiteBorders = { top: white, bottom: white, left: white, right: white, insideHorizontal: white, insideVertical: white };
    const PAGE_W = 12240, MARGIN = 1080, CONTENT_W = PAGE_W - 2 * MARGIN; // twips

    const runs = (rr, opts = {}) => rr.map((r) => new d.TextRun({ text: r.text, bold: r.bold || opts.bold, color: opts.color, size: opts.size, font: FONT }));
    function rich(text, opts = {}) {
      return R.parseRich(text).map((b) =>
        b.type === "li"
          ? new d.Paragraph({ numbering: { reference: "hh-bullets", level: 0 }, spacing: { after: 60 }, children: runs(b.runs, opts) })
          : new d.Paragraph({ spacing: { after: 120 }, children: runs(b.runs, opts) })
      );
    }
    const label = (t) => new d.Paragraph({ spacing: { before: 60, after: 40 }, children: [new d.TextRun({ text: t, bold: true, color: BROWN, font: FONT })] });
    const img = (p, maxWpx, maxHpx) => {
      const s = fit(p.w, p.h, maxWpx, maxHpx);
      const type = /^data:image\/png/.test(p.dataUrl) ? "png" : "jpg";
      return new d.Paragraph({ children: [new d.ImageRun({ type, data: dataUrlToBytes(p.dataUrl), transformation: { width: Math.round(s.w), height: Math.round(s.h) } })] });
    };

    const children = [];
    // Title block
    children.push(new d.Paragraph({ spacing: { before: 120, after: 60 }, children: [new d.TextRun({ text: report.type_name.toUpperCase(), font: "Montserrat Light", size: 44, color: BROWN, characterSpacing: 20 })] }));
    children.push(new d.Paragraph({ spacing: { after: 240 }, children: [new d.TextRun({ text: String(report.property || report.client_name || "").toUpperCase(), bold: true, size: 20, color: PINK, font: FONT, characterSpacing: 30 })] }));

    // Header info table: Earth Brown labels, light gray values
    const hr = headerRows(report);
    if (hr.length) {
      const LW = 2200;
      children.push(new d.Table({
        width: { size: CONTENT_W, type: d.WidthType.DXA }, columnWidths: [LW, CONTENT_W - LW], borders: whiteBorders,
        rows: hr.map(([k, v]) => new d.TableRow({ children: [
          new d.TableCell({ width: { size: LW, type: d.WidthType.DXA }, shading: { fill: BROWN, type: d.ShadingType.CLEAR, color: "auto" }, margins: { top: 80, bottom: 80, left: 140, right: 140 }, children: [new d.Paragraph({ children: [new d.TextRun({ text: k + ":", bold: true, color: "FFFFFF", font: FONT })] })] }),
          new d.TableCell({ width: { size: CONTENT_W - LW, type: d.WidthType.DXA }, shading: { fill: PANEL, type: d.ShadingType.CLEAR, color: "auto" }, margins: { top: 80, bottom: 80, left: 140, right: 140 }, children: [new d.Paragraph({ children: [new d.TextRun({ text: v, font: FONT })] })] }),
        ] })),
      }));
    }

    for (const sec of report.sections || []) {
      const c = (report.content || {})[sec.key];
      if (!R.sectionHasContent(sec, c)) continue;
      children.push(new d.Paragraph({
        keepNext: true, spacing: { before: 360, after: 160 },
        border: { bottom: { color: LEAF, space: 4, style: d.BorderStyle.SINGLE, size: 12 } },
        children: [new d.TextRun({ text: sec.title.toUpperCase(), font: "Montserrat Light", size: 28, color: BROWN, characterSpacing: 20 })],
      }));
      if (sec.kind === "notes") children.push(...rich(c.text));

      if (sec.kind === "observations" || sec.kind === "photos") {
        const PHOTO_COL = sec.kind === "photos" ? 4900 : 4300;
        for (const it of visibleItems(sec, c)) {
          const p = it.photo ? photos.get(it.photo.id) : null;
          const textParas = [];
          if (sec.kind === "observations") {
            if (String(it.text || "").trim()) textParas.push(label("Observation:"), ...rich(it.text));
            if (String(it.recommendation || "").trim()) textParas.push(label("Recommendation:"), ...rich(it.recommendation));
          } else if (String(it.note || "").trim()) textParas.push(...rich(it.note));
          if (!textParas.length) textParas.push(new d.Paragraph({ children: [] }));
          if (p) {
            const maxW = Math.floor((PHOTO_COL - 200) / 15); // twips to px (15 twips per px)
            children.push(new d.Table({
              width: { size: CONTENT_W, type: d.WidthType.DXA }, columnWidths: [PHOTO_COL, CONTENT_W - PHOTO_COL], borders: noBorders,
              rows: [new d.TableRow({ cantSplit: true, children: [
                new d.TableCell({ width: { size: PHOTO_COL, type: d.WidthType.DXA }, margins: { top: 60, bottom: 60, left: 0, right: 200 }, children: [img(p, maxW, sec.kind === "photos" ? 340 : 300)] }),
                new d.TableCell({ width: { size: CONTENT_W - PHOTO_COL, type: d.WidthType.DXA }, margins: { top: 60, bottom: 60, left: 100, right: 0 }, children: textParas }),
              ] })],
            }));
          } else {
            children.push(...textParas);
          }
          children.push(new d.Paragraph({ spacing: { after: 120 }, border: { bottom: { color: "E2E2E2", space: 4, style: d.BorderStyle.SINGLE, size: 4 } }, children: [] }));
        }
      }

      if (sec.kind === "priorities") {
        const TW = 2600;
        const head = new d.TableRow({ tableHeader: true, children: ["Priority", "What needs to happen"].map((t, i) =>
          new d.TableCell({ width: { size: i ? CONTENT_W - TW : TW, type: d.WidthType.DXA }, shading: { fill: BROWN, type: d.ShadingType.CLEAR, color: "auto" }, margins: { top: 80, bottom: 80, left: 140, right: 140 },
            children: [new d.Paragraph({ children: [new d.TextRun({ text: t, bold: true, color: "FFFFFF", font: FONT })] })] })) });
        const rows = [head];
        for (const g of R.groupPriorities(c.items)) {
          g.items.forEach((it, i) => {
            const cells = [];
            if (i === 0) cells.push(new d.TableCell({ rowSpan: g.items.length, width: { size: TW, type: d.WidthType.DXA }, shading: { fill: PANEL, type: d.ShadingType.CLEAR, color: "auto" }, margins: { top: 80, bottom: 80, left: 140, right: 140 },
              children: [new d.Paragraph({ children: [new d.TextRun({ text: g.label, bold: true, color: BROWN, font: FONT })] }), new d.Paragraph({ children: [new d.TextRun({ text: g.sub, size: 18, color: GRAY, font: FONT })] })] }));
            cells.push(new d.TableCell({ width: { size: CONTENT_W - TW, type: d.WidthType.DXA }, shading: { fill: PANEL, type: d.ShadingType.CLEAR, color: "auto" }, margins: { top: 80, bottom: 40, left: 140, right: 140 }, children: rich(it.text) }));
            rows.push(new d.TableRow({ cantSplit: true, children: cells }));
          });
        }
        children.push(new d.Table({ width: { size: CONTENT_W, type: d.WidthType.DXA }, columnWidths: [TW, CONTENT_W - TW], borders: whiteBorders, rows }));
      }
    }

    // Signature (RC-04)
    const sig = R.signatureLines(report.consultant);
    if (sig.length) {
      children.push(new d.Paragraph({ spacing: { before: 480, after: 60 }, keepNext: true, children: [new d.TextRun({ text: "Prepared by:", bold: true, color: BROWN, font: FONT })] }));
      sig.forEach((l, i) => children.push(new d.Paragraph({ keepNext: i < sig.length - 1, spacing: { after: 20 }, children: [new d.TextRun({ text: l, bold: i === 0, font: FONT, color: i === 0 ? TEXT : GRAY })] })));
    }

    const logoUrl = await logo();
    const firstHeader = new d.Header({ children: [new d.Paragraph({ children: [new d.ImageRun({ type: "png", data: dataUrlToBytes(logoUrl), transformation: { width: 150, height: Math.round(150 * 620 / 844) } })] })] });
    const footer = new d.Footer({ children: [new d.Paragraph({
      tabStops: [{ type: d.TabStopType.RIGHT, position: CONTENT_W }],
      border: { top: { color: LEAF, space: 6, style: d.BorderStyle.SINGLE, size: 6 } },
      children: [
        new d.TextRun({ text: "Harmony Horticulture", size: 16, color: GRAY, font: FONT }),
        new d.TextRun({ children: ["\tPage ", d.PageNumber.CURRENT, " of ", d.PageNumber.TOTAL_PAGES], size: 16, color: GRAY, font: FONT }),
      ],
    })] });

    const doc = new d.Document({
      creator: "Harmony Horticulture",
      title: `${report.type_name} - ${report.property || report.client_name}`,
      styles: { default: { document: { run: { font: FONT, size: 21, color: TEXT }, paragraph: { spacing: { line: 288, lineRule: d.LineRuleType.AUTO } } } } },
      numbering: { config: [{ reference: "hh-bullets", levels: [{ level: 0, format: d.LevelFormat.BULLET, text: "•", alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } }, run: { color: GREEN } } }] }] },
      sections: [{
        properties: { titlePage: true, page: { size: { width: PAGE_W, height: 15840 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 500, footer: 500 } } },
        headers: { first: firstHeader, default: new d.Header({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [new d.TextRun({ text: String(report.property || report.client_name || "").toUpperCase(), size: 16, color: PINK, bold: true, font: FONT })] })] }) },
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
