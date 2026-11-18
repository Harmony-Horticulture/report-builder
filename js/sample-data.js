// =====================================================================
// Sample data for trying out layouts and exports. Fills a report with
// made-up but realistic landscape notes and drawn placeholder photos.
// Used by the "Fill with sample data" button (demo mode and admins).
// =====================================================================
(function () {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

  const COMMUNITIES = ["", "", "Paradise Valley Estates", "Desert Highlands", "Ahwatukee Foothills", "Arcadia", "McCormick Ranch"];

  const NOTES = {
    overview: [
      "The property is in **good overall health** heading into the cooler months. Irrigation is running on the fall schedule and new plantings are rooting in well.\n- Turf is filling in along the front entry\n- Citrus are setting fruit with good leaf color\n- A few shrubs by the pool need attention",
      "Overall the landscape looks **healthy and well kept**. We walked every bed with the owner and checked the drip system zone by zone.\n- Seasonal color is establishing\n- Two trees need structural pruning\n- Mulch is thin in the side yard",
    ],
    summary: [
      "Walked the full property with the owner. Overall the landscape is **healthy and thriving** heading into winter, with strong color in the beds and no signs of pest pressure.",
      "Quick visit to check the new plantings and the drip system. Everything is establishing well, with a few small items to take care of before the next visit.",
    ],
    followup: [
      "Next visit in four weeks. Please let us know if the gate code changes or if you notice any wet spots along the drip lines.",
      "We'll check back after the first frost to look at the bougainvillea and citrus. Call or reply to this email any time with questions.",
    ],
    other: [
      "Everything we saw today is listed below, with photos where they help. Reply any time with questions.",
    ],
  };

  const OBSERVATIONS = [
    { label: "Citrus leaves", text: "Yellowing between the veins on new growth of the two orange trees by the pool.", rec: "Apply chelated iron at the label rate this month and check the drip emitters at both trees." },
    { label: "Palm fronds", text: "Fronds on the Mexican fan palm are hanging low over the walkway.", rec: "Schedule a palm trim before the holidays so the walkway stays clear." },
    { label: "East bed mulch", text: "Mulch is thin in the east bed and bare soil is showing.", rec: "Add 2 to 3 inches of mulch, keeping it 6 inches back from trunks and stems." },
    { label: "Drip emitter", text: "One emitter on the agave bed is cracked and spraying onto the wall.", rec: "Replace the emitter and flush the line. We can do this on the next visit." },
    { label: "Mesquite canopy", text: "The mesquite canopy is dense and a few limbs cross over each other.", rec: "Thin the canopy by about 15 percent to reduce wind load before monsoon season." },
    { label: "Rose blooms", text: "Roses along the main walk are in full bloom with healthy foliage.", rec: "Deadhead spent flowers weekly to keep new blooms coming." },
    { label: "Lantana border", text: "Lantana along the driveway has some woody, bare stems at the center.", rec: "Cut back by one third in early spring to bring back full growth." },
    { label: "Turf edge", text: "Bermuda grass is creeping into the front planting bed.", rec: "Re-edge the bed line and add a steel edging strip to hold it." },
  ];

  const PHOTO_NOTES = [
    { label: "Vines on wall", note: "Vines are establishing well along the brick wall. Keep training new shoots onto the guide wires and make sure a drip emitter reaches the base of each plant." },
    { label: "Desert accent bed", note: "The desert accent bed is **thriving**. Yucca, agaves and the blooming trailing plants show strong color with no signs of stress." },
    { label: "White roses", note: "White roses are in full bloom along the main walk. Deadhead spent flowers weekly to keep new blooms coming." },
    { label: "Walkway geraniums", note: "Geraniums along the walkway are full and vibrant. A few stems are reaching onto the path:\n- Trim stems back to the bed edge\n- Keep the walkway clear for guests" },
    { label: "Succulent bed", note: "The succulent bed and center container are healthy. Mulch depth is good and the bed is free of weeds." },
    { label: "Sidewalk tree", note: "The mature tree by the sidewalk has a broad, open canopy. Check clearance over the walkway and parking area before storm season." },
  ];

  const PRIORITIES = {
    p1: ["Replace the cracked drip emitter on the agave bed", "Chelated iron for the two orange trees", "Raise the tree canopy over the walkway and parking area", "Clear fronds hanging over the front walk"],
    p2: ["Trim geranium stems back from the walkway", "Thin the mesquite canopy before monsoon season", "Re-edge the front bed and add steel edging", "Top up mulch in the east bed"],
    p3: ["Replace the two declining Texas sage by the gate", "Add a drip line to the new pots on the patio", "Refresh decomposed granite in the side yard"],
    future: ["Deadhead roses weekly through the bloom season", "Cut back lantana by one third in early spring", "Review the irrigation schedule when temperatures drop", "Plan spring color for the entry pots"],
  };

  const PUNCH = [
    { text: "Replace broken drip emitter at the front entry pots", note: "Emitter cap is missing and the pot stays dry." },
    { text: "Trim bougainvillea off the courtyard wall lights", note: "" },
    { text: "Remove dead lantana in the motor court bed" },
    { text: "Re-stake the young olive by the guest house", note: "Tie is rubbing the bark. Use a wide strap." },
    { text: "Top up decomposed granite along the pool path" },
    { text: "Clear leaves and debris from the rear drain grates" },
    { text: "Raise the mesquite canopy over the driveway to 14 feet", note: "Needs the bucket truck." },
    { text: "Replace two declining Texas sage at the gate" },
    { text: "Adjust spray heads on the side lawn, overspray onto the wall" },
    { text: "Fertilize citrus grove with the winter feeding" },
    { text: "Cut back spent salvia blooms along the walkway" },
    { text: "Install new solar timer on the fountain pump", note: "Waiting on the owner to pick the model." },
  ];
  const TEAM = ["Maintenance crew", "Irrigation tech", "Tree crew", "Harmony", "Owner"];

  // A simple drawn landscape so the photo slots aren't empty
  function photo(label, w, h) {
    return new Promise((resolve) => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      const hue = 80 + Math.floor(Math.random() * 60);
      const sky = g.createLinearGradient(0, 0, 0, h * 0.55);
      sky.addColorStop(0, "#BFDDF0"); sky.addColorStop(1, "#EAF3F7");
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      // Mountains
      g.fillStyle = "#B7A99A";
      g.beginPath(); g.moveTo(0, h * 0.5);
      for (let x = 0; x <= w; x += w / 8) g.lineTo(x, h * (0.36 + Math.random() * 0.12));
      g.lineTo(w, h * 0.55); g.lineTo(0, h * 0.55); g.fill();
      // Ground
      const ground = g.createLinearGradient(0, h * 0.5, 0, h);
      ground.addColorStop(0, "#C9A97E"); ground.addColorStop(1, "#8E6B48");
      g.fillStyle = ground; g.fillRect(0, h * 0.5, w, h * 0.5);
      // Shrubs and plants
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * w, y = h * 0.52 + Math.random() * h * 0.46, r = (w / 30) * (0.6 + Math.random() * 1.4);
        g.fillStyle = `hsl(${hue + Math.random() * 30 - 15}, ${35 + Math.random() * 25}%, ${25 + Math.random() * 20}%)`;
        g.beginPath(); g.ellipse(x, y, r * 1.3, r, 0, 0, Math.PI * 2); g.fill();
        if (Math.random() < 0.3) {
          g.fillStyle = pick(["#F065A5", "#F3C746", "#FFFFFF", "#E8644A"]);
          for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x + (Math.random() - 0.5) * r * 2, y + (Math.random() - 0.5) * r, r / 6, 0, Math.PI * 2); g.fill(); }
        }
      }
      // Label
      g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, 0, w, Math.round(h * 0.11));
      g.fillStyle = "#FFFFFF";
      g.font = `600 ${Math.round(Math.min(w, h) / 18)}px Montserrat, Arial, sans-serif`;
      g.textBaseline = "middle";
      g.fillText("Sample photo: " + label, w * 0.04, h * 0.055);
      c.toBlob((b) => resolve(b), "image/jpeg", 0.82);
    });
  }

  // Fills report.content for every section. upload(blob) saves a photo and
  // returns its reference. Returns the client to pick (or null).
  async function fill(report, clients, upload, uid) {
    const sizes = [[1600, 1200], [1600, 1067], [1000, 1400], [1600, 1200], [1200, 1600], [1600, 1000]];
    let n = 0;
    const addPhoto = async (label) => {
      const [w, h] = sizes[n++ % sizes.length];
      const ref = await upload(await photo(label, w, h));
      return { ...ref, w, h };
    };
    for (const s of report.sections) {
      if (s.kind === "notes") {
        report.content[s.key] = { text: pick(NOTES[s.key] || NOTES[/sum/i.test(s.key) ? "summary" : /follow/i.test(s.key) ? "followup" : "other"]) };
      } else if (s.kind === "observations") {
        const items = [];
        for (const o of shuffle(OBSERVATIONS).slice(0, 4)) items.push({ id: uid(), photo: await addPhoto(o.label), text: o.text, recommendation: o.rec });
        report.content[s.key] = { items };
      } else if (s.kind === "photos") {
        const items = [];
        for (const o of shuffle(PHOTO_NOTES).slice(0, 5)) items.push({ id: uid(), photo: await addPhoto(o.label), note: o.note });
        report.content[s.key] = { items };
      } else if (s.kind === "punchlist") {
        const items = [];
        const d0 = report.report_date || new Date().toISOString().slice(0, 10);
        const d1 = new Date(d0 + "T12:00:00"); d1.setDate(d1.getDate() - 13);
        const dates = [d1.toISOString().slice(0, 10), d0];
        const tiers = ["p1", "p1", "p2", "p2", "p3", "future"];
        const statuses = ["open", "open", "progress", "done"];
        let i = 0;
        for (const o of shuffle(PUNCH).slice(0, 10)) {
          items.push({ id: uid(), photo: i % 3 === 2 ? null : await addPhoto(o.text.split(" ").slice(0, 3).join(" ")), date: dates[i < 5 ? 0 : 1], text: o.text, note: o.note || "",
            tier: pick(tiers), assigned: pick(TEAM), status: pick(statuses), approval: Math.random() < 0.2 ? "yes" : "no", carried: "" });
          i++;
        }
        report.content[s.key] = { items, newDate: d0 };
      } else if (s.kind === "priorities") {
        const items = [];
        for (const [tier, k] of [["p1", 2], ["p2", 2], ["p3", 2], ["future", 2]]) for (const text of shuffle(PRIORITIES[tier]).slice(0, k)) items.push({ id: uid(), tier, text });
        report.content[s.key] = { items };
      }
    }
    report.community = pick(COMMUNITIES);
    const withContact = clients.filter((c) => c.active !== false && c.contact_name && c.contact_name !== c.name);
    return pick(withContact.length ? withContact : clients.filter((c) => c.active !== false)) || null;
  }

  window.HHSample = { fill, photo };
})();
