// Generates public/icons/icon.svg, icon-192.png and icon-512.png (no dependencies).
// Usage: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// ---- geometry in unit space (0..1), content stays inside a 0.8 circle so the icon is maskable
const C = 0.5;
const CYAN = [0.45, 0.85, 1.0], SLATE = [0.16, 0.2, 0.28], AMBER = [1.0, 0.72, 0.22], WHITE = [0.94, 0.98, 1.0];
const BG_IN = [0.09, 0.115, 0.17], BG_OUT = [0.043, 0.051, 0.071];

function ngonPts(cx, cy, r, n, rot) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = rot + (i * 2 * Math.PI) / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return pts;
}
const hex = ngonPts(C, C, 0.19, 6, Math.PI / 6);
const tris = [];
for (let i = 0; i < 8; i++) {
  const a = (i * 2 * Math.PI) / 8 + Math.PI / 8;
  const cx = C + Math.cos(a) * 0.305, cy = C + Math.sin(a) * 0.305;
  tris.push(ngonPts(cx, cy, 0.04, 3, a + Math.PI)); // tip points at the tower
}

// ---- SVG
const pts = (p) => p.map(([x, y]) => `${(x * 512).toFixed(1)},${(y * 512).toFixed(1)}`).join(' ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><radialGradient id="g" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#171d2b"/><stop offset="1" stop-color="#0b0d12"/></radialGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <circle cx="256" cy="256" r="${(0.38 * 512).toFixed(1)}" fill="none" stroke="#73d9ff" stroke-width="${(0.024 * 512).toFixed(1)}"/>
  ${tris.map((t) => `<polygon points="${pts(t)}" fill="#ffb838"/>`).join('\n  ')}
  <polygon points="${pts(hex)}" fill="#293347" stroke="#73d9ff" stroke-width="${(0.024 * 512).toFixed(1)}" stroke-linejoin="round"/>
  <circle cx="256" cy="256" r="${(0.075 * 512).toFixed(1)}" fill="#f0faff"/>
</svg>
`;
writeFileSync(join(outDir, 'icon.svg'), svg);

// ---- raster
function sdCircle(x, y, cx, cy, r) { return Math.hypot(x - cx, y - cy) - r; }
function sdPoly(x, y, v) {
  let d = (x - v[0][0]) ** 2 + (y - v[0][1]) ** 2, s = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
    const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1];
    const wx = x - v[i][0], wy = y - v[i][1];
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const bx = wx - ex * t, by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = y >= v[i][1], c2 = y < v[j][1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function shade(x, y, aa) {
  const r = Math.hypot(x - C, y - C);
  let col = mix(BG_IN, BG_OUT, Math.min(1, r / 0.7));
  const over = (d, c) => { const cov = Math.max(0, Math.min(1, 0.5 - d / aa)); col = mix(col, c, cov); };
  over(Math.abs(r - 0.38) - 0.012, CYAN);
  for (const t of tris) over(sdPoly(x, y, t), AMBER);
  const dh = sdPoly(x, y, hex);
  over(dh, SLATE);
  over(Math.abs(dh) - 0.012, CYAN);
  over(sdCircle(x, y, C, C, 0.075), WHITE);
  return col;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const SS = 3; // supersampling per axis
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const aa = 1 / size;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, aa);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = py * (size * 4 + 1) + 1 + px * 4, k = 255 / (SS * SS);
      raw[o] = Math.round(r * k); raw[o + 1] = Math.round(g * k); raw[o + 2] = Math.round(b * k); raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const size of [192, 512]) writeFileSync(join(outDir, `icon-${size}.png`), png(size));
console.log('icons written to', outDir);
