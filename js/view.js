// =====================================================================
// What the client opens from their email (RC-27). No login: the link
// holds a long random code, so nobody can reach another client's report
// by changing the address.
// =====================================================================
(function () {
  const R = window.Report, S = window.Store, X = window.Exports;
  const params = new URLSearchParams(location.search);
  const token = params.get("r") || params.get("demo") || "";
  const body = document.getElementById("vBody");
  const actions = document.getElementById("vActions");
  const notFound = () => {
    body.innerHTML = `<div class="vmsg"><h1>Report not found</h1><p class="muted">This link may be incomplete. Please use the full link from your email, or reply to that email and we'll send it again.</p></div>`;
  };
  if (!/^[0-9a-f-]{36}$/i.test(token)) return notFound();

  function show(report, photoUrl, pdfHref, pdfMake) {
    document.title = `${report.type_name} · ${report.property || report.client_name} · Harmony Horticulture`;
    body.innerHTML = R.reportHtml(report, photoUrl);
    const name = R.fileBase(report) + ".pdf";
    actions.innerHTML = `<a class="dl" id="vDl" href="${R.esc(pdfHref || "#")}" download="${R.esc(name)}">Download PDF</a><button class="pr" type="button" id="vPrint">Print</button>`;
    document.getElementById("vPrint").onclick = () => window.print();
    if (pdfMake) {
      document.getElementById("vDl").onclick = async (e) => {
        e.preventDefault();
        X.download(await pdfMake(), name);
      };
    }
  }

  (async () => {
    try {
      if (params.get("demo") && S.mode === "demo") {
        // Demo mode: the report lives in this browser
        const r = S.demoSharedReport(token);
        if (!r) return notFound();
        const urls = {};
        for (const s of r.sections) for (const it of ((r.content[s.key] || {}).items || [])) if (it.photo) urls[it.photo.id] = await S.photoUrl(it.photo);
        show(r, (p) => urls[p.id] || "", null, async () => X.buildPdf(r, await X.loadPhotos(r, S.photoUrl)));
        return;
      }
      if (S.mode !== "live") return notFound();
      const res = await fetch(S.sharedFileUrl(token, "report.json"), { cache: "no-store" });
      if (!res.ok) return notFound();
      const data = await res.json();
      show(data.report, (p) => p.dataUrl || "", S.sharedFileUrl(token, "report.pdf"), null);
    } catch (e) {
      console.error(e);
      notFound();
    }
  })();
})();
