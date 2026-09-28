// 窓とトレイのアイコン（build/icon.png）を作る。
// web/public/icon.svg と同じ絵を、256×256 の PNG として自分で描く。
// （ImageMagick などを持っていない環境でも組めるように、絵心は code で書く）

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..', 'build', 'icon.png');

const SIZE = 256;
const SS = 4; // 4倍で描いて縮める（輪郭を滑らかにするため）
const N = SIZE * SS;

const ORANGE = [0xc9, 0x64, 0x42];
const CREAM = [0xfa, 0xf9, 0xf5];

const px = Buffer.alloc(N * N * 4);

function put(x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const i = (y * N + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = 255;
}

/** 角の丸い四角（64分の14＝256分の56 の丸み） */
function roundedRect(radius) {
  const r = radius;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cx = Math.min(Math.max(x, r), N - 1 - r);
      const cy = Math.min(Math.max(y, r), N - 1 - r);
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) put(x, y, ORANGE);
    }
  }
}

function disc(cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) put(x, y, color);
    }
  }
}

/** 輪（顔の輪郭）。中心からの距離が半径±太さ半分のところを描く */
function strokeRing(cx, cy, r, width, color) {
  const outer = r + width / 2;
  for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++) {
    for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(d - r) <= width / 2) put(x, y, color);
    }
  }
}

/** 3次ベジェを太さで描く（口の曲線） */
function strokeCurve(p0, p1, p2, p3, width, color) {
  const steps = 2000;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0];
    const y = u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1];
    disc(x, y, width / 2, color);
  }
}

const s = (v) => (v / 64) * N; // 64 の座標系から描画座標へ

roundedRect(s(14));
strokeRing(s(32), s(30), s(14), s(4), CREAM);
disc(s(26.5), s(29), s(2.4), CREAM);
disc(s(37.5), s(29), s(2.4), CREAM);
strokeCurve([s(27.5), s(35)], [s(28.7), s(37.4)], [s(30.2), s(38.7)], [s(32), s(38.7)], s(4), CREAM);
strokeCurve([s(32), s(38.7)], [s(33.8), s(38.7)], [s(35.3), s(37.4)], [s(36.5), s(35)], s(4), CREAM);

/** 縮めて PNG にする */
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const sum = [0, 0, 0, 0];
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * N + (x * SS + dx)) * 4;
        for (let c = 0; c < 4; c++) sum[c] += px[i + c];
      }
    }
    const o = (y * SIZE + x) * 4;
    for (let c = 0; c < 4; c++) out[o + c] = Math.round(sum[c] / (SS * SS));
  }
}

// --- PNG（RGBA・フィルタ無し） ---
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // 8ビット
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  out.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`描いた: ${OUT}（${SIZE}×${SIZE}）`);
