// =====================================================================
// Lets the app be added to a phone's home screen and open quickly.
// Always tries the internet first, so updates show up right away; the
// saved copy is only used when there is no connection.
// Supabase (logins, reports, photos) is never stored here.
// =====================================================================
const CACHE = "hh-reports-v32";
const SHELL = [
  "./", "index.html", "css/app.css", "css/report.css",
  "js/config.js", "js/demo-clients.js", "js/store.js", "js/render.js", "js/exports.js", "js/sample-data.js", "js/geo.js", "js/app.js",
  "leads.html", "css/leads.css", "js/leads.js", "lead-report.html", "css/lead-report.css", "js/lead-report.js",
  "dashboard.html", "css/dashboard.css", "js/dashboard.js",
  "sops.html", "css/sops.css", "js/sops.js", "js/sop-doc.js",
  "vendor/supabase.min.js", "assets/logo.png", "assets/logo-reversed.png", "assets/mark.png", "assets/mark-reversed.png",
  "assets/icon-192.png", "manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    // "no-cache" asks GitHub Pages whether the file changed, instead of
    // using the browser's 10-minute copy, so updates show up right away
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")))
  );
});
