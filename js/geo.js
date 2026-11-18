// =====================================================================
// Where a photo was taken. First the location saved inside the photo
// (often removed by phones when a photo goes to a website), then the
// phone's current location when the photo was just taken.
// A location is { lat, lng, acc (meters, if known), src: "photo" | "device" }.
// =====================================================================
(function () {
  // Read GPS from a JPEG's EXIF block. Returns null if there is none.
  async function exifGps(file) {
    try {
      if (!file || !/jpe?g/i.test(file.type || file.name || "")) return null;
      const buf = await file.slice(0, 256 * 1024).arrayBuffer();
      const v = new DataView(buf);
      if (v.getUint16(0) !== 0xffd8) return null;
      let p = 2;
      while (p + 4 < v.byteLength) {
        const marker = v.getUint16(p), size = v.getUint16(p + 2);
        if (marker === 0xffe1 && v.getUint32(p + 4) === 0x45786966) return readTiff(v, p + 10); // "Exif"
        if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
        p += 2 + size;
      }
    } catch (e) { /* unreadable: no location */ }
    return null;
  }
  function readTiff(v, t) {
    const le = v.getUint16(t) === 0x4949;
    const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
    const entries = (ifd) => { const n = u16(ifd), out = {}; for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; out[u16(e)] = e; } return out; };
    const ifd0 = entries(u32(4));
    if (!ifd0[0x8825]) return null;
    const gps = entries(u32(ifd0[0x8825] + 8));
    if (!gps[2] || !gps[4]) return null;
    const ref = (tag) => (gps[tag] ? String.fromCharCode(v.getUint8(t + gps[tag] + 8)) : "");
    const dms = (tag) => {
      const o = u32(gps[tag] + 8);
      const r = (k) => u32(o + k * 8) / (u32(o + k * 8 + 4) || 1);
      return r(0) + r(1) / 60 + r(2) / 3600;
    };
    let lat = dms(2), lng = dms(4);
    if (ref(1) === "S") lat = -lat;
    if (ref(3) === "W") lng = -lng;
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: round(lat), lng: round(lng), src: "photo" };
  }
  const round = (x) => Math.round(x * 1e6) / 1e6;

  // The phone's location right now (asks for permission the first time)
  function deviceLocation(timeout = 12000) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: round(pos.coords.latitude), lng: round(pos.coords.longitude), acc: Math.round(pos.coords.accuracy || 0), src: "device" }),
        (err) => resolve(err && err.code === 1 ? { denied: true } : null),
        { enableHighAccuracy: true, timeout, maximumAge: 60000 }
      );
    });
  }

  // Location for a photo: the photo's own tag, or the phone's location when
  // the photo was taken in the last 10 minutes (so it was taken right here).
  async function forPhoto(file, justTaken) {
    const tag = await exifGps(file);
    if (tag) return tag;
    const fresh = justTaken || (file && file.lastModified && Date.now() - file.lastModified < 10 * 60 * 1000);
    return fresh ? deviceLocation() : null;
  }

  const mapUrl = (loc) => (loc && isFinite(loc.lat) ? `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}` : "");
  const has = (loc) => !!(loc && isFinite(loc.lat) && isFinite(loc.lng));

  window.Geo = { exifGps, deviceLocation, forPhoto, mapUrl, has };
})();
