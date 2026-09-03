// Builds the two app icons electron-builder asks for out of the mascot's 256 pixel icon:
// build/icon.png at 512 for Linux and build/icon.ico for Windows. Scaling is nearest
// neighbour, because anything smoother turns pixel art into mush.
// Run with: node scripts/make-app-icons.mjs [mascot]
import { Buffer } from 'node:buffer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { Canvas, encodePng } from './lib/canvas.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mascot = argv[2] ?? 'wisp';
// Windows picks a different size per surface, from the 16 pixel title bar to the 256 pixel
// preview. The .ico carries them all, so nothing has to be resized at display time.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Minimal decoder for the 8 bit RGBA non interlaced files this repo generates.
 * @param {Buffer} file
 * @returns {Canvas}
 */
function decodePng(file) {
  let offset = 8;
  let width = 0;
  let height = 0;
  /** @type {Buffer[]} */
  const idat = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) {
        throw new Error('Only 8 bit RGBA non interlaced PNG is supported.');
      }
    } else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const canvas = new Canvas(width, height);
  const data = canvas.data;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = (x >= 4 ? data[y * stride + x - 4] : 0) ?? 0;
      const b = (y > 0 ? data[(y - 1) * stride + x] : 0) ?? 0;
      const c = (x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0) ?? 0;
      const value = line[x] ?? 0;
      let out = value;
      if (filter === 1) out = value + a;
      else if (filter === 2) out = value + b;
      else if (filter === 3) out = value + ((a + b) >> 1);
      else if (filter === 4) out = value + paeth(a, b, c);
      data[y * stride + x] = out & 0xff;
    }
  }
  return canvas;
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} c
 */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * @param {Canvas} source
 * @param {number} size
 * @returns {Canvas}
 */
function resize(source, size) {
  const out = new Canvas(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x * source.width) / size);
      const sy = Math.floor((y * source.height) / size);
      out.set(x, y, source.get(sx, sy));
    }
  }
  return out;
}

/**
 * An .ico is a directory of images, and since Windows Vista those images may be PNG, so the
 * whole file is a header plus the PNGs already encoded above.
 * @param {{ size: number; png: Buffer }[]} images
 * @returns {Buffer}
 */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    // 256 does not fit in a byte and is written as 0, which the format defines as 256.
    entry[0] = size % 256;
    entry[1] = size % 256;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const source = decodePng(readFileSync(join(root, 'resources', 'icons', mascot, 'icon-256.png')));
const out = join(root, 'build');
mkdirSync(out, { recursive: true });

const png512 = encodePng(resize(source, 512));
writeFileSync(join(out, 'icon.png'), png512);
const ico = encodeIco(ICO_SIZES.map((size) => ({ size, png: encodePng(resize(source, size)) })));
writeFileSync(join(out, 'icon.ico'), ico);
stdout.write(
  `build/icon.png 512x512 ${png512.length} B, build/icon.ico ${ICO_SIZES.join('/')} ${ico.length} B, from ${mascot}\n`,
);
