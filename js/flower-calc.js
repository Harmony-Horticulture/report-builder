// =====================================================================
// Flower season planner: the math (no screens). Same rules as the
// Harmony Horticulture Estimates workbook:
//  - plant cost typed "Pre-tax" gets tax (and the Armstrong surcharge for
//    wholesale flowers); "Tax incl." is used as typed
//  - flats needed = plants ÷ plants per flat, rounded up (or a typed override)
//  - markup by category, Multiply (cost × (1 + markup)) or
//    Divide (cost ÷ (1 − markup))
//  - soil: pots × cu ft per pot + bed sq ft × depth, in bags
// Works in the browser (window.FlowerCalc) and in Node (for tests).
// =====================================================================
(function (root) {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));

  const DEFAULT_SETTINGS = {
    tax: 0.091, surcharge: 0.045, method: "Multiply",
    markups: { "Labor": 0, "Flowers - Wholesale": 0.5, "Flowers - Retail": 0.2, "Chemicals": 0.4, "Other items": 0.3 },
    soil_per_pot: 0.6, soil_depth_in: 4, bag_cf: 1.5,
    crew: [
      { name: "Robbie", cost: null, rate: null, qb_item: "Labor - Robbie" },
      { name: "Stephanie", cost: null, rate: null, qb_item: "Labor - Stephanie" },
      { name: "Kasey", cost: null, rate: null, qb_item: "Labor" },
      { name: "Oversight", cost: null, rate: null, qb_item: "Labor" },
      { name: "Outside crew (staffing)", cost: 22.5, rate: null, qb_item: "Labor" },
    ],
    qb_items: [
      ["Labor - Robbie", "Installation labor: Robbie"], ["Labor - Stephanie", "Installation labor: Stephanie"], ["Labor", "Installation labor: crew"],
      ["Mirimichi", "Mirimichi Green soil enhancer"], ["Irrigation", "Irrigation adjustments and parts"], ["Compost", "Compost and soil amendment"],
      ["Fertilizer/MitoGrow", "Fertilizer and MitoGro"], ["Other", "Other materials"], ["Flowers - Wholesale", "Seasonal annuals"], ["Flowers - Retail", "Seasonal annuals (retail)"],
    ],
  };
  const STATUSES = ["Draft", "Sent to client", "Approved", "Ordered", "Installed", "Billed"];

  function settingsWith(s) {
    const d = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (!s) return d;
    return { ...d, ...s, markups: { ...d.markups, ...(s.markups || {}) }, crew: s.crew && s.crew.length ? s.crew : d.crew, qb_items: s.qb_items && s.qb_items.length ? s.qb_items : d.qb_items };
  }
  function markupOf(job, S, cat) {
    const own = job.markups && job.markups[cat];
    return num(own) != null ? num(own) : num(S.markups[cat]) || 0;
  }
  const priceOf = (cost, m, method) => (!cost ? 0 : method === "Divide" ? (m >= 1 ? cost : cost / (1 - m)) : cost * (1 + m));

  // One plant line -> units, cost and price
  function plantLine(p, job, S) {
    const per = Math.max(1, num(p.per_flat) || 1);
    const plants = num(p.plants) || 0;
    const auto = p.unit === "Each" ? plants : Math.ceil(plants / per);
    const units = num(p.units) != null ? num(p.units) : auto;
    const wholesale = (p.qb_item || "Flowers - Wholesale") !== "Flowers - Retail";
    const mult = p.cost_basis === "Pre-tax" ? 1 + S.tax + (wholesale ? S.surcharge : 0) : 1;
    const unitCost = (num(p.cost) || 0) * mult;
    const cost = r2(units * unitCost);
    const cat = wholesale ? "Flowers - Wholesale" : "Flowers - Retail";
    const price = r2(priceOf(cost, markupOf(job, S, cat), job.method || S.method));
    const bidPlants = p.unit === "Each" ? units : units * per;
    const ordered = num(p.ordered), used = num(p.used);
    return { units, auto, unitCost: r2(unitCost), cost, price, cat, bidPlants, extra: bidPlants - plants, leftover: ordered != null && used != null ? ordered - used : null,
      actualCost: ordered != null ? r2(ordered * unitCost) : null, missingCost: num(p.cost) == null && plants > 0 };
  }
  function laborLine(l, job, S) {
    const crew = S.crew.find((c) => c.name === l.person) || {};
    const rate = num(l.cost) != null ? num(l.cost) : num(crew.cost);
    const hours = num(l.hours) || 0;
    const cost = r2(hours * (rate || 0));
    const billRate = num(l.rate) != null ? num(l.rate) : num(crew.rate);
    const price = r2(billRate != null ? hours * billRate : priceOf(cost, markupOf(job, S, "Labor"), job.method || S.method));
    const ah = num(l.actual_hours);
    return { hours, costRate: rate, cost, price, qb_item: l.qb_item || crew.qb_item || "Labor", actualCost: ah != null ? r2(ah * (rate || 0)) : null, missingRate: rate == null && hours > 0 };
  }
  function materialLine(m, job, S) {
    const qty = num(m.qty) || 0;
    const cost = r2(qty * (num(m.cost) || 0));
    const price = r2(priceOf(cost, markupOf(job, S, m.category || "Other items"), job.method || S.method));
    const o = num(m.ordered), u = num(m.used);
    return { cost, price, actualCost: o != null ? r2(o * (num(m.cost) || 0)) : null, leftover: o != null && u != null ? o - u : null };
  }
  function soil(job, S) {
    const cf = (job.locations || []).reduce((t, l) => t + (num(l.pots) || 0) * S.soil_per_pot + (num(l.sqft) || 0) * (S.soil_depth_in / 12), 0);
    return { cf: r2(cf), bags: cf ? Math.ceil(cf / S.bag_cf) : 0 };
  }

  // Everything about one job
  function jobTotals(job, settings) {
    const S = settingsWith(settings);
    const plants = (job.plants || []).map((p) => ({ p, c: plantLine(p, job, S) }));
    const labor = (job.labor || []).map((l) => ({ l, c: laborLine(l, job, S) }));
    const materials = (job.materials || []).map((m) => ({ m, c: materialLine(m, job, S) }));
    const sum = (list, f) => r2(list.reduce((t, x) => t + (f(x) || 0), 0));
    const cost = sum(plants, (x) => x.c.cost) + sum(labor, (x) => x.c.cost) + sum(materials, (x) => x.c.cost);
    const price = sum(plants, (x) => x.c.price) + sum(labor, (x) => x.c.price) + sum(materials, (x) => x.c.price);
    // QuickBooks estimate lines, in the order of the QuickBooks items list
    const qb = new Map(S.qb_items.map(([item, desc]) => [item, { item, desc, qty: 0, amount: 0, cost: 0 }]));
    const add = (item, qty, amount, c) => { if (!qb.has(item)) qb.set(item, { item, desc: item, qty: 0, amount: 0, cost: 0 }); const q = qb.get(item); q.qty += qty; q.amount += amount; q.cost += c; };
    plants.forEach((x) => add(x.c.cat, 1, x.c.price, x.c.cost));
    labor.forEach((x) => add(x.c.qb_item, x.c.hours, x.c.price, x.c.cost));
    materials.forEach((x) => add(x.m.qb_item || "Other", 1, x.c.price, x.c.cost));
    const qbLines = [...qb.values()].filter((q) => q.amount || q.cost).map((q) => {
      const labor = /^labor/i.test(q.item);
      return { ...q, qty: labor ? r2(q.qty) : 1, rate: labor && q.qty ? r2(q.amount / q.qty) : r2(q.amount), amount: r2(q.amount), cost: r2(q.cost) };
    });
    const flats = plants.filter((x) => x.p.unit !== "Each").reduce((t, x) => t + x.c.units, 0);
    const plantCount = plants.reduce((t, x) => t + (num(x.p.plants) || 0), 0);
    const actualParts = [...plants.map((x) => x.c.actualCost), ...labor.map((x) => x.c.actualCost), ...materials.map((x) => x.c.actualCost)].filter((v) => v != null);
    return {
      S, plants, labor, materials, qbLines, soil: soil(job, S), flats, plantCount,
      hours: sum(labor, (x) => x.c.hours), cost: r2(cost), price: r2(price), profit: r2(price - cost), margin: price ? (price - cost) / price : 0,
      actualCost: actualParts.length ? r2(actualParts.reduce((a, b) => a + b, 0)) : null,
      warnings: [
        ...plants.filter((x) => x.c.missingCost).map((x) => `No cost for ${[x.p.plant, x.p.variety].filter(Boolean).join(" ")}`),
        ...labor.filter((x) => x.c.missingRate).map((x) => `No hourly cost for ${x.l.person}`),
      ],
    };
  }

  // The season's order list: every plant and material across jobs, by client
  function seasonTally(jobs, settings) {
    const S = settingsWith(settings);
    const plants = new Map(), mats = new Map();
    const clients = jobs.map((j) => j.client_name);
    jobs.forEach((j) => {
      (j.plants || []).forEach((p) => {
        const c = plantLine(p, j, S);
        const label = p.unit === "Each" ? `Each${p.size ? ` (${p.size})` : ""}` : `Flat (${p.per_flat || 1}${p.size ? ` x ${p.size}` : ""})`;
        const key = [p.plant, p.variety, p.color, label].map((x) => String(x || "").trim().toLowerCase()).join("|");
        if (!plants.has(key)) plants.set(key, { plant: p.plant, variety: p.variety, color: p.color, unit: label, per: p.unit === "Each" ? 1 : p.per_flat || 1, by: {}, units: 0, plants: 0, cost: 0 });
        const t = plants.get(key);
        t.by[j.client_name] = (t.by[j.client_name] || 0) + c.units;
        t.units += c.units; t.plants += c.bidPlants; t.cost = r2(t.cost + c.cost);
      });
      (j.materials || []).forEach((m) => {
        const key = (m.item + "|" + (m.unit || "")).toLowerCase();
        if (!mats.has(key)) mats.set(key, { item: m.item, unit: m.unit, by: {}, qty: 0, cost: 0 });
        const t = mats.get(key);
        t.by[j.client_name] = (t.by[j.client_name] || 0) + (num(m.qty) || 0);
        t.qty += num(m.qty) || 0; t.cost = r2(t.cost + materialLine(m, j, S).cost);
      });
    });
    const sortP = (a, b) => String(a.plant).localeCompare(String(b.plant)) || String(a.variety || "").localeCompare(String(b.variety || ""));
    return { clients, plants: [...plants.values()].sort(sortP), materials: [...mats.values()].sort((a, b) => String(a.item).localeCompare(String(b.item))) };
  }

  const api = { DEFAULT_SETTINGS, STATUSES, settingsWith, plantLine, laborLine, materialLine, jobTotals, seasonTally, soil };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FlowerCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
