// seedArt.js — drawn illustrations for the synthetic demo cases (no real photos are used).
// Each scene is a small SVG returned as a data: URI, so it works offline and in the audit ledger.

const W = 640;
const H = 480;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const defs = `
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcdcf0"/><stop offset="1" stop-color="#eef6fb"/></linearGradient>
  <radialGradient id="vig" cx="0.5" cy="0.45" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/></radialGradient>
  <linearGradient id="binShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/></linearGradient>
</defs>`;

/* ---------- backdrops ---------- */
function windows(x, y, cols, rows, w, h, gap, color) {
  let s = "";
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      s += `<rect x="${x + c * (w + gap)}" y="${y + r * (h + gap)}" width="${w}" height="${h}" rx="2" fill="${color}"/>`;
  return s;
}

function backdrop(kind) {
  let s = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  if (kind === "park") {
    s += `<rect y="300" width="${W}" height="180" fill="#97c26f"/>`;
    s += `<path d="M0 360 L640 345 L640 430 L0 450 Z" fill="#d9ccb0"/>`;
    s += `<path d="M0 360 L640 345" stroke="#bfae8c" stroke-width="3"/>`;
  } else if (kind === "street") {
    s += `<rect x="0" y="120" width="150" height="210" fill="#d7c7ad"/>${windows(16, 140, 4, 4, 22, 26, 12, "#8fb3c9")}`;
    s += `<rect x="150" y="80" width="170" height="250" fill="#c9b8a0"/>${windows(166, 100, 4, 5, 26, 28, 12, "#9cbfd3")}`;
    s += `<rect x="320" y="150" width="140" height="180" fill="#e2d3bb"/>${windows(334, 168, 3, 3, 30, 30, 14, "#8fb3c9")}`;
    s += `<rect x="460" y="100" width="180" height="230" fill="#cdbca3"/>${windows(476, 118, 4, 4, 26, 30, 14, "#9cbfd3")}`;
    s += `<rect y="330" width="${W}" height="80" fill="#c8c1b5"/>`;
    for (let x = 0; x < W; x += 48) s += `<line x1="${x}" y1="330" x2="${x - 18}" y2="410" stroke="#b3aca0" stroke-width="2"/>`;
    s += `<rect y="406" width="${W}" height="8" fill="#9f978a"/><rect y="414" width="${W}" height="66" fill="#7f858c"/>`;
    for (let x = 20; x < W; x += 110) s += `<rect x="${x}" y="445" width="60" height="6" fill="#e9e9e9"/>`;
  } else if (kind === "block") {
    s += `<rect x="0" y="40" width="${W}" height="290" fill="#e6d8c0"/>`;
    s += windows(30, 70, 6, 3, 60, 50, 42, "#9cbfd3");
    s += `<rect x="0" y="300" width="${W}" height="30" fill="#cdbfa6"/>`;
    s += `<rect y="330" width="${W}" height="150" fill="#bdb6aa"/>`;
    for (let x = 0; x < W; x += 64) s += `<line x1="${x}" y1="330" x2="${x}" y2="480" stroke="#aaa397" stroke-width="2"/>`;
    s += `<line x1="0" y1="400" x2="${W}" y2="400" stroke="#aaa397" stroke-width="2"/>`;
  } else if (kind === "lane") {
    s += `<rect x="0" y="170" width="${W}" height="170" fill="#c27b5c"/>`;
    for (let y = 180; y < 340; y += 18) for (let x = (y / 18) % 2 ? 0 : 20; x < W; x += 40)
      s += `<rect x="${x}" y="${y}" width="36" height="14" fill="#b56d4f"/>`;
    s += `<rect x="0" y="160" width="${W}" height="14" fill="#a99d8e"/>`;
    s += `<rect y="340" width="${W}" height="140" fill="#a8a196"/>`;
    s += `<path d="M120 480 L250 340 L390 340 L520 480 Z" fill="#b8b1a5"/>`;
  }
  return s;
}

/* ---------- props ---------- */
function tree(x, base, scale = 1) {
  const k = scale;
  return `<rect x="${x - 9 * k}" y="${base - 120 * k}" width="${18 * k}" height="${120 * k}" fill="#7a5638"/>
  <circle cx="${x}" cy="${base - 150 * k}" r="${62 * k}" fill="#4f8f3f"/>
  <circle cx="${x - 45 * k}" cy="${base - 120 * k}" r="${42 * k}" fill="#5a9c48"/>
  <circle cx="${x + 45 * k}" cy="${base - 125 * k}" r="${44 * k}" fill="#468636"/>`;
}

function parkGate(x) {
  return `<rect x="${x}" y="150" width="34" height="200" fill="#a99f90"/><rect x="${x + 200}" y="150" width="34" height="200" fill="#a99f90"/>
  <rect x="${x - 6}" y="140" width="46" height="16" fill="#8f8577"/><rect x="${x + 194}" y="140" width="46" height="16" fill="#8f8577"/>
  <rect x="${x + 20}" y="160" width="194" height="34" rx="4" fill="#3f6e4a"/>
  <text x="${x + 117}" y="184" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#fff" text-anchor="middle">SECTOR 14 PARK</text>
  ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${x + 44 + i * 20}" y="210" width="5" height="140" fill="#5d5d5d"/>`).join("")}
  <rect x="${x + 34}" y="240" width="166" height="5" fill="#5d5d5d"/>`;
}

function shelter(x) {
  return `<rect x="${x}" y="190" width="8" height="160" fill="#6b7680"/><rect x="${x + 232}" y="190" width="8" height="160" fill="#6b7680"/>
  <rect x="${x - 14}" y="176" width="268" height="20" rx="3" fill="#2f5d7c"/>
  <rect x="${x + 12}" y="200" width="216" height="110" fill="#cfe3ee" opacity="0.55"/>
  <rect x="${x + 30}" y="300" width="180" height="10" fill="#7a5638"/><rect x="${x + 40}" y="310" width="6" height="40" fill="#555"/><rect x="${x + 194}" y="310" width="6" height="40" fill="#555"/>
  <circle cx="${x + 270}" cy="200" r="18" fill="#1f5fa8"/><rect x="${x + 267}" y="218" width="6" height="132" fill="#6b7680"/>
  <text x="${x + 270}" y="206" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="#fff" text-anchor="middle">BUS</text>`;
}

function houseGate(x) {
  return `<rect x="${x}" y="200" width="40" height="150" fill="#d8cdbb"/><rect x="${x + 190}" y="200" width="40" height="150" fill="#d8cdbb"/>
  <rect x="${x + 40}" y="215" width="150" height="135" fill="none" stroke="#2f3b45" stroke-width="5"/>
  ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${x + 52 + i * 20}" y="215" width="4" height="135" fill="#2f3b45"/>`).join("")}
  <rect x="${x + 6}" y="228" width="28" height="18" fill="#fff"/><text x="${x + 20}" y="242" font-family="Arial, sans-serif" font-size="12" font-weight="bold" fill="#333" text-anchor="middle">212</text>`;
}

function bag(cx, cy, r, color) {
  return `<g><ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.86}" fill="${color}"/>
  <ellipse cx="${cx - r * 0.35}" cy="${cy - r * 0.35}" rx="${r * 0.28}" ry="${r * 0.18}" fill="#fff" opacity="0.18"/>
  <path d="M${cx - r * 0.18} ${cy - r * 0.8} L${cx} ${cy - r * 1.15} L${cx + r * 0.18} ${cy - r * 0.8} Z" fill="${color}"/></g>`;
}

const BAG_COLORS = ["#2a2a2a", "#3b4a66", "#4a4a4a", "#245f86", "#d9d9d9", "#2f2f3a"];

function litter(cx, cy, spreadX, spreadY, n, rand) {
  const cols = ["#ffffff", "#f2e6c8", "#d94a3a", "#3a8f5a", "#e8c547", "#5aa0d0", "#8a6b4a"];
  let s = "";
  for (let i = 0; i < n; i++) {
    const x = cx + (rand() - 0.5) * spreadX;
    const y = cy + (rand() - 0.5) * spreadY;
    const rot = Math.round(rand() * 180);
    const c = cols[Math.floor(rand() * cols.length)];
    const kind = rand();
    if (kind < 0.45) s += `<rect x="${x}" y="${y}" width="${14 + rand() * 10}" height="${9 + rand() * 6}" fill="${c}" stroke="#00000022" transform="rotate(${rot} ${x} ${y})"/>`;
    else if (kind < 0.75) s += `<rect x="${x}" y="${y}" width="7" height="20" rx="3" fill="${c}" transform="rotate(${rot} ${x} ${y})"/>`;
    else s += `<ellipse cx="${x}" cy="${y}" rx="${8 + rand() * 5}" ry="${5 + rand() * 3}" fill="${c}"/>`;
  }
  return s;
}

function bin(x, base, opts = {}) {
  const { color = "#2f7d4f", overflow = 0, lid = "closed", rand = rng(1), label = true, shine = false } = opts;
  const w = 120;
  const h = 150;
  const top = base - h;
  let s = "";
  // overflow pile behind lid
  if (overflow) {
    for (let i = 0; i < 6 + overflow * 3; i++) {
      s += bag(x + 15 + rand() * 90, top - 8 - rand() * (14 + overflow * 10), 18 + rand() * 12, BAG_COLORS[Math.floor(rand() * BAG_COLORS.length)]);
    }
    s += litter(x + 60, top - 20, 110, 30, 10, rand);
  }
  // body
  s += `<path d="M${x} ${top} L${x + w} ${top} L${x + w - 10} ${base} L${x + 10} ${base} Z" fill="${color}"/>`;
  s += `<path d="M${x} ${top} L${x + w} ${top} L${x + w - 10} ${base} L${x + 10} ${base} Z" fill="url(#binShade)"/>`;
  s += `<rect x="${x + 22}" y="${top + 20}" width="4" height="${h - 34}" fill="#000" opacity="0.12"/><rect x="${x + 94}" y="${top + 20}" width="4" height="${h - 34}" fill="#000" opacity="0.12"/>`;
  if (label) s += `<circle cx="${x + 60}" cy="${top + 62}" r="20" fill="#fff" opacity="0.9"/><path d="M${x + 52} ${top + 54} h16 l-2 18 h-12 z" fill="${color}"/><rect x="${x + 50}" y="${top + 50}" width="20" height="4" fill="${color}"/>`;
  if (shine) s += `<path d="M${x + 12} ${top + 10} L${x + 30} ${top + 10} L${x + 26} ${base - 12} L${x + 16} ${base - 12} Z" fill="#fff" opacity="0.25"/>`;
  // wheels
  s += `<circle cx="${x + 22}" cy="${base + 4}" r="11" fill="#222"/><circle cx="${x + w - 22}" cy="${base + 4}" r="11" fill="#222"/>`;
  // lid
  if (lid === "closed") s += `<rect x="${x - 6}" y="${top - 12}" width="${w + 12}" height="14" rx="4" fill="${color}"/><rect x="${x - 6}" y="${top - 12}" width="${w + 12}" height="14" rx="4" fill="#000" opacity="0.15"/>`;
  else if (lid === "open") s += `<rect x="${x - 6}" y="${top - 70}" width="14" height="${w * 0.6}" rx="4" fill="${color}" transform="rotate(-12 ${x} ${top})"/>`;
  else if (lid === "tilted") s += `<rect x="${x + 6}" y="${top - 32}" width="${w}" height="14" rx="4" fill="${color}" transform="rotate(-18 ${x + 6} ${top - 20})"/>`;
  else if (lid === "broken") {
    s += `<path d="M${x - 6} ${top - 12} L${x + 50} ${top - 12} L${x + 40} ${top + 2} L${x - 6} ${top + 2} Z" fill="${color}"/>`;
    s += `<path d="M${x + 58} ${top - 28} L${x + 126} ${top - 40} L${x + 128} ${top - 26} L${x + 62} ${top - 14} Z" fill="${color}" opacity="0.9"/>`;
    s += `<path d="M${x + 48} ${top - 12} l6 6 l-4 6" stroke="#1d3d29" stroke-width="2" fill="none"/>`;
  }
  return s;
}

function debris(x, base, rand) {
  let s = `<ellipse cx="${x + 120}" cy="${base + 6}" rx="150" ry="22" fill="#9a8f80" opacity="0.6"/>`;
  for (let i = 0; i < 18; i++) {
    const px = x + rand() * 240;
    const py = base - rand() * 60;
    const c = rand() < 0.5 ? "#c8643c" : rand() < 0.5 ? "#9a9590" : "#d8d2c6";
    const sz = 16 + rand() * 22;
    s += `<polygon points="${px},${py} ${px + sz},${py - sz * 0.3} ${px + sz * 0.8},${py + sz * 0.5} ${px + sz * 0.1},${py + sz * 0.4}" fill="${c}" stroke="#0000002a"/>`;
  }
  for (let i = 0; i < 3; i++) {
    const bx = x + 30 + i * 70 + rand() * 10;
    s += `<rect x="${bx}" y="${base - 70 - rand() * 14}" width="62" height="40" rx="6" fill="#d9c9a3" stroke="#b5a37c" stroke-width="2" transform="rotate(${-10 + rand() * 20} ${bx + 30} ${base - 50})"/>`;
    s += `<rect x="${bx + 8}" y="${base - 58}" width="46" height="8" fill="#9b8a64" transform="rotate(${-6 + rand() * 12} ${bx + 30} ${base - 50})"/>`;
  }
  return s;
}

/* ---------- scenes ---------- */
const SCENES = {
  overflowPark: () => {
    const r = rng(11);
    return backdrop("park") + tree(90, 320) + parkGate(330) + bin(170, 400, { overflow: 3, lid: "open", rand: r }) + litter(250, 425, 200, 30, 16, r);
  },
  busBags: () => {
    const r = rng(21);
    let s = backdrop("street") + shelter(330) + bin(60, 395, { overflow: 2, lid: "tilted", rand: r }) + bin(190, 395, { color: "#2a5f9e", overflow: 2, lid: "open", rand: r });
    for (let i = 0; i < 7; i++) s += bag(300 + r() * 120, 380 + r() * 18, 20 + r() * 10, BAG_COLORS[Math.floor(r() * BAG_COLORS.length)]);
    return s + litter(240, 395, 280, 20, 14, r);
  },
  busClean: () => backdrop("street") + shelter(330) + bin(60, 395, { shine: true }) + bin(190, 395, { color: "#2a5f9e", shine: true }),
  blockOverflow: () => {
    const r = rng(31);
    return backdrop("block") + bin(250, 410, { overflow: 3, lid: "open", rand: r }) + litter(310, 430, 420, 60, 26, r);
  },
  blockEmptyBin: () => {
    // close-up of the emptied bin only
    let s = `<rect width="${W}" height="${H}" fill="#e6d8c0"/><rect y="330" width="${W}" height="150" fill="#bdb6aa"/>`;
    s += `<g transform="translate(-200,-260) scale(1.9)">${bin(200, 400, { lid: "open", shine: true })}</g>`;
    return s;
  },
  blockLooseWaste: () => {
    const r = rng(41);
    return backdrop("block") + bin(250, 410, { lid: "open", shine: true }) + litter(150, 440, 220, 50, 22, r) + litter(470, 440, 200, 50, 20, r) +
      bag(120, 430, 24, "#2a2a2a") + bag(520, 432, 22, "#3b4a66");
  },
  debrisFootpath: (seed = 51) => {
    const r = rng(seed);
    return backdrop("street") + tree(560, 340, 0.8) + debris(150, 390, r) + litter(380, 395, 120, 20, 8, r);
  },
  debrisStill: () => SCENES.debrisFootpath(57),
  cornerBin: () => backdrop("lane") + bin(440, 420, { shine: true }) + `<rect x="60" y="300" width="120" height="70" fill="#9b8c76"/><text x="120" y="342" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#fff" text-anchor="middle">LANE 3</text>`,
  gateBags: () => {
    const r = rng(61);
    let s = backdrop("lane") + houseGate(200);
    for (let i = 0; i < 5; i++) s += bag(150 + r() * 120, 380 + r() * 20, 22 + r() * 8, BAG_COLORS[Math.floor(r() * BAG_COLORS.length)]);
    return s + litter(220, 400, 200, 30, 10, r);
  },
  laneClean: () => backdrop("lane") + houseGate(200),
  brokenLid: () => {
    const r = rng(71);
    return backdrop("street") + bin(250, 395, { overflow: 2, lid: "broken", rand: r }) + litter(300, 400, 360, 26, 18, r) +
      `<path d="M420 270 q14 -10 28 0 q-14 6 -28 0" fill="#222"/><path d="M180 250 q14 -10 28 0 q-14 6 -28 0" fill="#222"/>`;
  },
  openDump: () => {
    const r = rng(81);
    let s = backdrop("park") + tree(520, 330) + tree(90, 320, 0.8);
    for (let i = 0; i < 16; i++) s += bag(170 + r() * 260, 360 + r() * 50, 20 + r() * 12, BAG_COLORS[Math.floor(r() * BAG_COLORS.length)]);
    return s + litter(300, 400, 380, 60, 30, r);
  },
  openClean: () => backdrop("park") + tree(520, 330) + tree(90, 320, 0.8) +
    `<rect x="296" y="250" width="8" height="140" fill="#6b5a46"/><rect x="230" y="220" width="140" height="56" rx="6" fill="#fff" stroke="#c0392b" stroke-width="4"/>
     <text x="300" y="244" font-family="Arial, sans-serif" font-size="15" font-weight="bold" fill="#c0392b" text-anchor="middle">NO DUMPING</text>
     <text x="300" y="264" font-family="Arial, sans-serif" font-size="11" fill="#333" text-anchor="middle">Fine ₹500</text>`,
  drainBlocked: () => {
    const r = rng(91);
    let s = backdrop("street") + `<rect x="0" y="392" width="${W}" height="30" fill="#5a4a32"/><rect x="0" y="392" width="${W}" height="6" fill="#463a28"/>`;
    s += `<path d="M0 404 Q160 396 320 404 T640 404 L640 422 L0 422 Z" fill="#7a6a3e" opacity="0.9"/>`;
    s += litter(320, 405, 600, 14, 30, r);
    for (let i = 0; i < 5; i++) s += bag(80 + r() * 480, 398 + r() * 6, 14 + r() * 6, BAG_COLORS[Math.floor(r() * BAG_COLORS.length)]);
    return s + `<ellipse cx="320" cy="440" rx="240" ry="16" fill="#6f6a50" opacity="0.55"/>`;
  },
  drainClear: () => {
    let s = backdrop("street") + `<rect x="0" y="392" width="${W}" height="30" fill="#4b4f55"/><rect x="0" y="392" width="${W}" height="6" fill="#3b3f44"/>`;
    s += `<path d="M0 414 Q160 410 320 414 T640 414 L640 420 L0 420 Z" fill="#6fa3c7" opacity="0.8"/>`;
    for (let x = 30; x < W; x += 120) s += `<rect x="${x}" y="390" width="70" height="8" fill="#2f3337"/>${[0, 1, 2, 3, 4, 5].map((k) => `<rect x="${x + 4 + k * 11}" y="390" width="4" height="8" fill="#6b7076"/>`).join("")}`;
    return s;
  },
  litteredStreet: () => {
    const r = rng(101);
    let s = backdrop("street") + tree(590, 335, 0.7);
    s += litter(320, 370, 600, 60, 60, r);
    for (let i = 0; i < 4; i++) s += bag(100 + r() * 440, 385 + r() * 10, 14 + r() * 6, BAG_COLORS[Math.floor(r() * BAG_COLORS.length)]);
    return s;
  },
  sweptStreet: () => backdrop("street") + tree(590, 335, 0.7) +
    `<rect x="120" y="250" width="6" height="140" fill="#7a5638" transform="rotate(18 123 320)"/><path d="M150 380 l40 8 l-6 18 l-48 -6 z" fill="#c9a24a" transform="rotate(18 160 390)"/>`,
  newBin: () => backdrop("street") + bin(250, 395, { color: "#1f8a4c", shine: true }) +
    `<rect x="380" y="300" width="120" height="34" rx="6" fill="#ffffff" opacity="0.9"/><text x="440" y="322" font-family="Arial, sans-serif" font-size="13" font-weight="bold" fill="#1f8a4c" text-anchor="middle">NEW BIN</text>`,
};

const cache = {};
/** Returns a data: URI for a named scene. */
export function scene(name) {
  if (!cache[name]) {
    const inner = SCENES[name] ? SCENES[name]() : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${defs}${inner}<rect width="${W}" height="${H}" fill="url(#vig)"/></svg>`;
    cache[name] = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
  return cache[name];
}

export const SCENE_NAMES = Object.keys(SCENES);
