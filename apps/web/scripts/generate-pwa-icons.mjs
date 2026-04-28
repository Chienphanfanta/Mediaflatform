// Tạo 3 placeholder PNG icons cho PWA — pure Node, KHÔNG cần sharp/canvas.
//   - icon-192.png       : 192×192 solid theme color + chữ "M" trắng đơn giản
//   - icon-512.png       : 512×512 same style
//   - icon-maskable.png  : 512×512 với safe-area padding 20% (Android maskable)
//
// Chạy 1 lần: `node apps/web/scripts/generate-pwa-icons.mjs`
// Phase 8: thay bằng logo thật (SVG → png chuẩn).
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// CRC32 portable (Node 22 mới có zlib.crc32; fallback table cho Node 18/20).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'icons');
mkdirSync(OUT_DIR, { recursive: true });

const THEME = { r: 0x53, g: 0x4a, b: 0xb7 }; // #534AB7
const FG = { r: 0xff, g: 0xff, b: 0xff };

// ────────── PNG encoder (pure) ──────────

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  const checksum = crc32(Buffer.concat([typeBuf, data]));
  crc.writeUInt32BE(checksum >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgbaPixels) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;       // bit depth
  ihdr[9] = 6;       // color type RGBA
  ihdr[10] = 0;      // compression method
  ihdr[11] = 0;      // filter method
  ihdr[12] = 0;      // interlace
  // IDAT — mỗi row prefix với filter byte 0 (None)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter
    rgbaPixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);
  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    SIG,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', iend),
  ]);
}

// ────────── Pixel painters ──────────

function setPixel(buf, w, x, y, c) {
  const i = (y * w + x) * 4;
  buf[i] = c.r;
  buf[i + 1] = c.g;
  buf[i + 2] = c.b;
  buf[i + 3] = c.a ?? 255;
}

function fillRect(buf, w, x0, y0, x1, y1, c) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) setPixel(buf, w, x, y, c);
  }
}

/**
 * Vẽ chữ "M" đơn giản dạng pixel art trong vùng [x0..x1, y0..y1].
 * 5×7 grid scaled lên — đủ rõ cho icon placeholder.
 */
function drawM(buf, w, x0, y0, x1, y1, c) {
  // Glyph M 5×7 (1 = on)
  const M = [
    '1...1',
    '11.11',
    '1.1.1',
    '1.1.1',
    '1...1',
    '1...1',
    '1...1',
  ];
  const gw = 5;
  const gh = 7;
  const cellW = Math.floor((x1 - x0) / gw);
  const cellH = Math.floor((y1 - y0) / gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (M[gy][gx] === '1') {
        fillRect(
          buf,
          w,
          x0 + gx * cellW,
          y0 + gy * cellH,
          x0 + (gx + 1) * cellW,
          y0 + (gy + 1) * cellH,
          c,
        );
      }
    }
  }
}

// ────────── Generate icons ──────────

function makeIcon(size, maskable = false) {
  const buf = Buffer.alloc(size * size * 4);
  // Background = theme color
  fillRect(buf, size, 0, 0, size, size, THEME);
  // Maskable: chừa safe area 20% (Android có thể crop tròn/tròn vuông).
  // Non-maskable: dùng ~30% padding cho M chiếm giữa.
  const pad = maskable ? size * 0.25 : size * 0.2;
  drawM(buf, size, pad, pad, size - pad, size - pad, FG);
  return encodePng(size, size, buf);
}

const targets = [
  { name: 'icon-192.png', png: makeIcon(192) },
  { name: 'icon-512.png', png: makeIcon(512) },
  { name: 'icon-maskable.png', png: makeIcon(512, true) },
];

for (const t of targets) {
  const path = join(OUT_DIR, t.name);
  const stream = createWriteStream(path);
  stream.write(t.png);
  stream.end();
  console.log(`✓ ${t.name} (${t.png.length} bytes)`);
}
console.log(`\nĐã tạo ${targets.length} icons tại ${OUT_DIR}`);
