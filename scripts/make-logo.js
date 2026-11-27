// Generates the Oxva logo files from one geometry definition.
// The mark is a slanted "O" cut into two pieces, traced from src/assets/brand/oxva-logo-source.webp
// (97.5% pixel overlap with the source; the rest is anti-aliasing along the edges).
//
//   node scripts/make-logo.js
//
// Writes to src/assets/brand/:
//   oxva-mark.svg            black mark, transparent
//   oxva-mark-white.svg      white mark, transparent
//   favicon.svg              browser-tab icon
//   oxva-mark-2048.png       black mark, 2048 px wide, transparent
//   oxva-mark-2048-white.png white mark, 2048 px wide, transparent
//   apple-touch-icon.png     180 x 180, green-white mark on the dark ground
//   icon-512.png             512 x 512, same as above (for web app manifests)
// and prints the path data used inline in the pages.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------- geometry (source image pixels) ---------------- */
const hyp = (a, b) => Math.hypot(a, b);
const unit = (a, b) => { const l = hyp(a, b); return [a / l, b / l]; };

// slanted lines written as x = x0 - k * (y - y0)
const leftOuter = (y) => 605 - 0.505 * (y - 402);
const leftInner = (y) => 712 - 0.505 * (y - 444);
const rightInner = (y) => 918 - 0.54 * (y - 462);
// right outer edge: x + 0.455 y = 1242.05 (tangent to both right-hand corners)
const RIGHT_C = 1242.05, RIGHT_K = 0.455;
const nLeft = unit(1, 0.505), nRight = unit(1, RIGHT_K), nRightIn = unit(1, 0.54);

// corner circles
const TL = { cx: 750.9, cy: 468, r: 160 };   // outer top-left
const TR = { cx: 931, cy: 418, r: 110 };     // outer top-right
const BR = { cx: RIGHT_C - RIGHT_K * 554 - 160 * hyp(1, RIGHT_K), cy: 554, r: 160 }; // outer bottom-right
const BL = { cx: 603, cy: 614, r: 100 };     // outer bottom-left
const IT = { cx: 795.7, cy: 500, r: 100 };   // inner top-left
const IB = { cx: 772, cy: 522, r: 100 };     // inner bottom-right

const onCircleX = (c, y, side) => c.cx + side * Math.sqrt(c.r * c.r - (y - c.cy) ** 2);
const solve = (f, lo, hi) => { for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; (f(lo) * f(m) <= 0) ? hi = m : lo = m; } return (lo + hi) / 2; };

// cut lines
const cutA = { from: [leftInner(509), 509], to: [leftOuter(597), 597] };            // lower edge of the top piece (left slash)
const cutBLeft = (y) => 613 - 3.2 * (y - 588);                                        // upper edge of the bottom piece, left
const cutBRight = (y) => 1011 - 4.11 * (y - 432);                                     // upper edge of the bottom piece, right

const yBLcut = solve((y) => cutBLeft(y) - onCircleX(BL, y, -1), 600, 640);
const yTip = solve((y) => cutBLeft(y) - leftInner(y), 560, 600);
const yRcut = solve((y) => cutBRight(y) - rightInner(y), 440, 470);

// Each piece: start point, then segments ['L', x, y] or ['A', circle, sweep, x, y]
const pieceTop = [
  [cutA.to[0], cutA.to[1]],
  ['L', TL.cx - TL.r * nLeft[0], TL.cy - TL.r * nLeft[1]],
  ['A', TL, 1, TL.cx, TL.cy - TL.r],
  ['L', TR.cx, TR.cy - TR.r],
  ['A', TR, 1, onCircleX(TR, 400, 1), 400],
  ['L', IT.cx, IT.cy - IT.r],
  ['A', IT, 0, IT.cx - IT.r * nLeft[0], IT.cy - IT.r * nLeft[1]],
  ['L', cutA.from[0], cutA.from[1]]
];
const pieceBottom = [
  [onCircleX(TR, 425, 1), 425],
  ['A', TR, 1, TR.cx + TR.r * nRight[0], TR.cy + TR.r * nRight[1]],
  ['L', BR.cx + BR.r * nRight[0], BR.cy + BR.r * nRight[1]],
  ['A', BR, 1, BR.cx, BR.cy + BR.r],
  ['L', BL.cx, BL.cy + BL.r],
  ['A', BL, 1, cutBLeft(yBLcut), yBLcut],
  ['L', cutBLeft(yTip), yTip],
  ['L', leftInner(622), 622],
  ['L', IB.cx, IB.cy + IB.r],
  ['A', IB, 0, IB.cx + IB.r * nRightIn[0], IB.cy + IB.r * nRightIn[1]],
  ['L', rightInner(yRcut), yRcut]
];

/* ---------------- outputs ---------------- */
const VIEW = { x: 503, y: 308, w: 538, h: 406 }; // tight box around the mark
const f = (n) => (+n.toFixed(1)).toString();

function toPathData(piece) {
  let d = 'M' + f(piece[0][0]) + ' ' + f(piece[0][1]);
  for (const s of piece.slice(1)) {
    if (s[0] === 'L') d += 'L' + f(s[1]) + ' ' + f(s[2]);
    else d += 'A' + f(s[1].r) + ' ' + f(s[1].r) + ' 0 0 ' + s[2] + ' ' + f(s[3]) + ' ' + f(s[4]);
  }
  return d + 'Z';
}
const D = toPathData(pieceTop) + toPathData(pieceBottom);

// flatten into polygons for the PNG rasterizer
function flatten(piece) {
  const pts = [piece[0].slice()];
  let [px, py] = piece[0];
  for (const s of piece.slice(1)) {
    if (s[0] === 'L') { pts.push([s[1], s[2]]); [px, py] = [s[1], s[2]]; continue; }
    const c = s[1], sweep = s[2], tx = s[3], ty = s[4];
    let a0 = Math.atan2(py - c.cy, px - c.cx), a1 = Math.atan2(ty - c.cy, tx - c.cx);
    if (sweep === 1 && a1 < a0) a1 += 2 * Math.PI;
    if (sweep === 0 && a1 > a0) a1 -= 2 * Math.PI;
    const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * c.r / 1.5));
    for (let i = 1; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a)]); }
    [px, py] = [tx, ty];
  }
  return pts;
}
const POLYS = [flatten(pieceTop), flatten(pieceBottom)];

// coverage rasterizer (4x4 supersampling, even-odd) -> alpha buffer
function rasterize(width, height, scale, ox, oy) {
  const SS = 4, alpha = new Float32Array(width * height);
  const edges = [];
  for (const poly of POLYS) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    edges.push([(a[0] - VIEW.x) * scale + ox, (a[1] - VIEW.y) * scale + oy, (b[0] - VIEW.x) * scale + ox, (b[1] - VIEW.y) * scale + oy]);
  }
  for (let sy = 0; sy < height * SS; sy++) {
    const y = (sy + 0.5) / SS, xs = [];
    for (const [x1, y1, x2, y2] of edges) if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    xs.sort((p, q) => p - q);
    const row = Math.floor(sy / SS) * width;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const s0 = Math.max(0, Math.ceil(xs[i] * SS - 0.5)), s1 = Math.min(width * SS - 1, Math.floor(xs[i + 1] * SS - 0.5));
      for (let sx = s0; sx <= s1; sx++) alpha[row + (sx >> 2)] += 1 / (SS * SS);
    }
  }
  return alpha;
}

// minimal PNG encoder (RGBA, 8-bit)
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) { const o = y * (width * 4 + 1) + 1 + x * 4; const p = pixel(x, y); raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = p[3]; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, '..', 'src', 'assets', 'brand');
fs.mkdirSync(out, { recursive: true });
const svg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" role="img" aria-label="Oxva"><path fill="${fill}" d="${D}"/></svg>\n`;
fs.writeFileSync(path.join(out, 'oxva-mark.svg'), svg('#111111'));
fs.writeFileSync(path.join(out, 'oxva-mark-white.svg'), svg('#ffffff'));
// the green-white glass of the 3D logo (same stops as .brand-mark in site.css), on the site's dark ground
const GREEN = [[0, [242, 255, 249]], [0.4, [168, 239, 210]], [0.75, [63, 214, 160]], [1, [42, 158, 120]]];
const GROUND = [6, 8, 7];
function greenAt(t) {
  for (let i = 1; i < GREEN.length; i++) {
    if (t <= GREEN[i][0]) {
      const [o0, c0] = GREEN[i - 1], [o1, c1] = GREEN[i], k = (t - o0) / (o1 - o0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
  }
  return GREEN[GREEN.length - 1][1];
}
const stops = GREEN.map(([o, c]) => `<stop offset="${o}" stop-color="rgb(${c.join(',')})"/>`).join('');
// browser-tab icon: the green-white mark on a dark rounded square, readable at 16 px
fs.writeFileSync(path.join(out, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs>` +
  `<rect width="64" height="64" rx="14" fill="rgb(${GROUND.join(',')})"/>` +
  `<svg x="8" y="13" width="48" height="38" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}"><path fill="url(#g)" d="${D}"/></svg></svg>\n`);

// transparent PNGs, 2048 px wide
{
  const W = 2048, scale = W / VIEW.w, H = Math.round(VIEW.h * scale);
  const a = rasterize(W, H, scale, 0, 0);
  const at = (x, y) => Math.min(255, Math.round(a[y * W + x] * 255));
  fs.writeFileSync(path.join(out, 'oxva-mark-2048.png'), png(W, H, (x, y) => [17, 17, 17, at(x, y)]));
  fs.writeFileSync(path.join(out, 'oxva-mark-2048-white.png'), png(W, H, (x, y) => [255, 255, 255, at(x, y)]));
}

// square app icons: the green-white mark centered on the dark ground, gradient from top-left to bottom-right
function appIcon(size, file) {
  const pad = size * 0.2, scale = (size - 2 * pad) / VIEW.w, mh = VIEW.h * scale;
  const a = rasterize(size, size, scale, pad, (size - mh) / 2);
  const bg = GROUND, span = size - 2 * pad;
  fs.writeFileSync(path.join(out, file), png(size, size, (x, y) => {
    const t = Math.min(1, a[y * size + x]);
    const fg = greenAt(Math.min(1, Math.max(0, ((x - pad) + (y - pad)) / (2 * span))));
    return [0, 1, 2].map((i) => Math.round(bg[i] + (fg[i] - bg[i]) * t)).concat(255);
  }));
}
appIcon(180, 'apple-touch-icon.png');
appIcon(512, 'icon-512.png');

console.log('viewBox', `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`);
console.log('path', D);
for (const file of fs.readdirSync(out)) console.log('  ' + file.padEnd(26) + fs.statSync(path.join(out, file)).size + ' bytes');
