// Draws src/assets/brand/veins.svg: glowing emerald veins on a transparent ground, the texture behind every page.
// No SVG filters (they are slow to paint); the glow is wide, faint strokes, and the strength is baked in.
// Generated (seeded, so the same every time) instead of using a photo, so it is Oxva's own and stays small.
// Run: node scripts/make-veins.js
const fs = require("fs");
const path = require("path");

const W = 1600, H = 2400, SEED = 4663;
let a = SEED >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const range = (lo, hi) => lo + rnd() * (hi - lo);

const paths = []; // { d, w }

function smooth(pts) {
  // Catmull-Rom through the points, as cubic Béziers
  let d = `M${pts[0][0].toFixed(0)} ${pts[0][1].toFixed(0)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(0)} ${c1[1].toFixed(0)} ${c2[0].toFixed(0)} ${c2[1].toFixed(0)} ${p2[0].toFixed(0)} ${p2[1].toFixed(0)}`;
  }
  return d;
}

function crack(x, y, angle, steps, width, depth) {
  const pts = [[x, y]];
  for (let i = 0; i < steps; i++) {
    angle += range(-0.38, 0.38);
    const len = range(16, 38);
    x += Math.cos(angle) * len; y += Math.sin(angle) * len;
    pts.push([x, y]);
    if (x < -80 || x > W + 80 || y < -80 || y > H + 80) break;
    if (depth < 2 && i > 2 && rnd() < (depth ? 0.05 : 0.09)) {
      crack(x, y, angle + (rnd() < 0.5 ? -1 : 1) * range(0.5, 1.15), Math.round(steps * range(0.25, 0.5)), width * 0.55, depth + 1);
    }
  }
  if (pts.length > 2) paths.push({ d: smooth(pts), w: width });
}

// main veins: from the edges inward, and a few from inside
for (let i = 0; i < 9; i++) crack(-20, range(0, H), range(-0.5, 0.5), Math.round(range(35, 70)), range(1.6, 2.6), 0);
for (let i = 0; i < 9; i++) crack(W + 20, range(0, H), Math.PI + range(-0.5, 0.5), Math.round(range(35, 70)), range(1.6, 2.6), 0);
for (let i = 0; i < 6; i++) crack(range(200, W - 200), range(0, H), range(0, Math.PI * 2), Math.round(range(20, 40)), range(1.2, 2), 0);

const groups = [...new Set(paths.map((p) => p.w.toFixed(1)))];
const defs = paths.map((p, i) => `<path id="v${i}" d="${p.d}"/>`).join("");
const uses = (scale, cls) => groups.map((w) => `<g stroke-width="${(w * scale).toFixed(1)}" class="${cls}">${paths.map((p, i) => (p.w.toFixed(1) === w ? `<use href="#v${i}"/>` : "")).join("")}</g>`).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
<linearGradient id="core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d4ffef"/><stop offset=".45" stop-color="#4fe0ad"/><stop offset="1" stop-color="#138a68"/></linearGradient>
<style>g{fill:none;stroke-linecap:round;stroke-linejoin:round}.halo{stroke:#1aa979;opacity:.07}.halo2{stroke:#1aa979;opacity:.1}.body{stroke:#2fc993;opacity:.2}.core{stroke:url(#core);opacity:.3}</style>
${defs}
</defs>
<g>${uses(9, "halo")}
${uses(5, "halo2")}
${uses(2.2, "body")}
${uses(0.8, "core")}</g>
</svg>
`;
const out = path.join(__dirname, "..", "src", "assets", "brand", "veins.svg");
fs.writeFileSync(out, svg);
console.log(`wrote ${path.relative(process.cwd(), out)} (${paths.length} veins, ${(svg.length / 1024).toFixed(1)} KB)`);
