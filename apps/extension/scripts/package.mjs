// Đóng gói dist/ → release/media-ops-extension-v{version}.zip (để cài thủ công hoặc
// upload Chrome Web Store). Zip "store" (không nén) viết tay để không cần thêm dependency.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const { version } = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push({ name: relative(dist, p).split('\\').join('/'), data: readFileSync(p) });
  }
})(dist);

const chunks = [];
const central = [];
let offset = 0;
for (const f of files) {
  const nameBuf = Buffer.from(f.name, 'utf8');
  const crc = crc32(f.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(f.data.length, 18);
  local.writeUInt32LE(f.data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  chunks.push(local, nameBuf, f.data);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(f.data.length, 20);
  cen.writeUInt32LE(f.data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt32LE(offset, 42);
  central.push(cen, nameBuf);
  offset += local.length + nameBuf.length + f.data.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

const outDir = resolve(root, 'release');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `media-ops-extension-v${version}.zip`);
writeFileSync(out, Buffer.concat([...chunks, centralBuf, end]));
console.log(`✔ ${out} (${files.length} files)`);
