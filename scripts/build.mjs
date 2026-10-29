import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { zipSync } from 'fflate';
import path from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
if (manifest.version !== version) throw new Error('La versión del manifiesto y del paquete deben coincidir.');

// A small original raster icon; no artwork from the reference extension is reused.
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([size, name, bytes, crc]);
}
function icon(size) {
  const scale = 3, width = size * scale, pixels = [];
  const segment = (x, y, x1, y1, x2, y2, r) => {
    const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / ((x2 - x1) ** 2 + (y2 - y1) ** 2)));
    return Math.hypot(x - x1 - t * (x2 - x1), y - y1 - t * (y2 - y1)) < r;
  };
  for (let y = 0; y < size; y++) {
    pixels.push(0);
    for (let x = 0; x < size; x++) {
      const rgb = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        const a = (x * scale + sx) / width * 128, b = (y * scale + sy) / width * 128;
        const corner = Math.hypot(Math.max(0, 28 - a, a - 100), Math.max(0, 28 - b, b - 100));
        if (corner > 27) continue;
        const ring = Math.abs(Math.hypot(a - 51, b - 43) - 16) < 3.5;
        const arc = b >= 67 && b <= 96 && Math.abs(Math.hypot((a - 51) * .94, b - 96) - 27) < 3.5;
        const line = [[60, 99, 77, 78], [77, 78, 87, 87], [87, 87, 105, 61], [93, 61, 105, 61], [105, 61, 105, 73]].some(p => segment(a, b, ...p, 3.3));
        const color = ring || arc || line ? [255, 38, 102] : [10 + Math.round(b / 15), 23 + Math.round(a / 15), 43 + Math.round(a / 9)];
        for (let c = 0; c < 3; c++) rgb[c] += color[c]; rgb[3] += 255;
      }
      pixels.push(...rgb.map(c => Math.round(c / scale ** 2)));
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from(pixels))), chunk('IEND', Buffer.alloc(0))]);
}

await mkdir('public/icons', { recursive: true });
for (const size of [16, 48, 128]) await writeFile(`public/icons/${size}.png`, icon(size));
await viteBuild();
await Promise.all([
  esbuild({ entryPoints: ['src/extension/background.ts'], outfile: 'dist/background.js', bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', minify: true, legalComments: 'none' }),
  esbuild({ entryPoints: ['src/extension/content.ts'], outfile: 'dist/content.js', bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', minify: true, legalComments: 'none' }),
]);
await writeFile('dist/INSTALACION.txt', await readFile('docs/INSTALACION.txt'));
const files = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else files[path.relative('dist', file).replaceAll('\\', '/')] = new Uint8Array(await readFile(file));
  }
}
await walk('dist');
await mkdir('release', { recursive: true });
await writeFile(`release/ig-tracker-${version}.zip`, zipSync(files));
console.log(`\nExtensión lista: dist/\nZIP para compartir: release/ig-tracker-${version}.zip`);
