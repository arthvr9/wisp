// Builds the images the README shows, out of the sprite sheets and the tray icons that
// scripts/make-placeholder-sprites.mjs already produced. Run after that one.
// Run with: node scripts/make-docs-images.mjs
import { Buffer } from 'node:buffer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

import { MASCOTS } from './lib/mascots/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRAME = 32;

/** @typedef {{ width: number; height: number; data: Uint8Array }} Image */

/**
 * Minimal decoder for the 8 bit RGBA non interlaced files this repo generates.
 * @param {Buffer} file
 * @returns {Image}
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
  const data = new Uint8Array(stride * height);
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
  return { width, height, data };
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

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Buffer} data
 */
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** @param {Image} image */
function encodePng(image) {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(image.data.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {number[]} [fill]
 * @returns {Image}
 */
function blank(width, height, fill) {
  const data = new Uint8Array(width * height * 4);
  if (fill) {
    for (let i = 0; i < width * height; i++) data.set(fill, i * 4);
  }
  return { width, height, data };
}

/**
 * Nearest neighbour copy, which is the only scaling pixel art tolerates.
 * @param {Image} target
 * @param {Image} source
 * @param {number} dx
 * @param {number} dy
 * @param {number} [scale]
 * @param {{ x: number; y: number; w: number; h: number }} [crop]
 */
function blit(target, source, dx, dy, scale = 1, crop) {
  const { x = 0, y = 0, w = source.width, h = source.height } = crop ?? {};
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const si = ((y + sy) * source.width + (x + sx)) * 4;
      if (source.data[si + 3] === 0) continue;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const tx = dx + sx * scale + px;
          const ty = dy + sy * scale + py;
          if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
          const ti = (ty * target.width + tx) * 4;
          for (let c = 0; c < 4; c++) target.data[ti + c] = source.data[si + c] ?? 0;
        }
      }
    }
  }
}

const sheet = decodePng(readFileSync(join(root, 'resources', 'sprites', 'wisp.png')));

/** @typedef {{ x: number; y: number; w: number; h: number }} Rect */

// Frame rectangles come from the sheet's own JSON. Computing them from a fixed grid was wrong
// once a pose could start on a new row: half the strip came out empty.
/** @param {string} mascot */
function framesOf(mascot) {
  const text = readFileSync(join(root, 'resources', 'sprites', `${mascot}.json`), 'utf8');
  /** @type {unknown} */
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`Bad sheet JSON: ${mascot}`);
  const frames = /** @type {{ frames?: unknown }} */ (parsed).frames;
  if (typeof frames !== 'object' || frames === null) throw new Error(`No frames: ${mascot}`);
  /** @type {Rect[]} */
  const out = [];
  const entries = /** @type {Record<string, { frame?: unknown }>} */ (frames);
  for (const entry of Object.values(entries)) {
    const rect = entry.frame;
    if (typeof rect !== 'object' || rect === null) continue;
    const r = /** @type {Record<string, unknown>} */ (rect);
    if (typeof r.x !== 'number' || typeof r.y !== 'number') continue;
    if (typeof r.w !== 'number' || typeof r.h !== 'number') continue;
    out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
  }
  return out;
}

/**
 * Where each pose starts in a sheet. Frame indices used to be written out by hand here, which
 * only held while every pose had the frame count it started with; a mascot that spends eight
 * frames on its idle moves every index after it.
 * @param {string} mascot
 * @returns {Record<string, number>}
 */
function tagStarts(mascot) {
  const text = readFileSync(join(root, 'resources', 'sprites', `${mascot}.json`), 'utf8');
  /** @type {unknown} */
  const parsed = JSON.parse(text);
  const meta = /** @type {{ meta?: { frameTags?: unknown } }} */ (parsed).meta;
  const tags = meta?.frameTags;
  if (!Array.isArray(tags)) throw new Error(`No frame tags: ${mascot}`);
  /** @type {Record<string, number>} */
  const out = {};
  for (const raw of /** @type {unknown[]} */ (tags)) {
    const tag = /** @type {{ name?: unknown; from?: unknown }} */ (raw);
    if (typeof tag.name === 'string' && typeof tag.from === 'number') out[tag.name] = tag.from;
  }
  return out;
}

const wispFrames = framesOf('wisp');
const wispStarts = tagStarts('wisp');

/** @param {number} index */
const cell = (index) => {
  const rect = wispFrames[index];
  if (!rect) throw new Error(`Frame ${index} is missing from the wisp sheet.`);
  return rect;
};

const outDir = join(root, 'docs', 'images');
mkdirSync(outDir, { recursive: true });

const portrait = blank(FRAME * 5, FRAME * 5);
blit(portrait, sheet, 0, 0, 5, cell(0));
writeFileSync(join(outDir, 'wisp.png'), encodePng(portrait));

// One frame per pose, in the order the state machine usually walks through them. The second
// frame of each pose, since a pose's first frame is often its rest and the second is where it
// has moved; celebrate shows its third, which is the top of the hop.
const showcase = ['idle', 'walk', 'sit', 'sleep', 'alert', 'drag', 'dance', 'pet'].map(
  (pose) => (wispStarts[pose] ?? 0) + 1,
);
showcase.push((wispStarts.celebrate ?? 0) + 2);
// Startle shows its second frame, the top of the jump, where the flame is at its widest.
showcase.push((wispStarts.startle ?? 0) + 1);
const gap = 10;
const scale = 3;
const strip = blank(showcase.length * (FRAME * scale + gap) - gap, FRAME * scale);
showcase.forEach((index, column) => {
  blit(strip, sheet, column * (FRAME * scale + gap), 0, scale, cell(index));
});
writeFileSync(join(outDir, 'poses.png'), encodePng(strip));

const moods = ['dejected', 'stressed', 'uneasy', 'calm', 'cheerful', 'elated'];
const trays = moods.map((mood) =>
  decodePng(readFileSync(join(root, 'resources', 'icons', 'wisp', `tray-${mood}.png`))),
);
const trayScale = 4;
const traySize = 22 * trayScale;
const ladder = blank(moods.length * (traySize + gap) - gap, traySize);
trays.forEach((tray, column) => {
  blit(ladder, tray, column * (traySize + gap), 0, trayScale);
});
writeFileSync(join(outDir, 'moods.png'), encodePng(ladder));

// One idle frame per mascot, in the order the picker offers them, for a side by side look.
const mascotScale = 4;
const mascotCell = FRAME * mascotScale;
const mascotStrip = blank(MASCOTS.length * (mascotCell + gap) - gap, mascotCell);
MASCOTS.forEach((mascot, column) => {
  const mascotSheet = decodePng(
    readFileSync(join(root, 'resources', 'sprites', `${mascot.id}.png`)),
  );
  blit(
    mascotStrip,
    mascotSheet,
    column * (mascotCell + gap),
    0,
    mascotScale,
    framesOf(mascot.id)[0] ?? cell(0),
  );
});
writeFileSync(join(outDir, 'mascots.png'), encodePng(mascotStrip));

stdout.write(`wrote ${outDir}/wisp.png, poses.png, moods.png and mascots.png\n`);

// The bubble and the mascot as they are captured from the running app, stacked the way they
// appear on screen. Pass the two captures as arguments to refresh this one.
const [bubblePath, mascotPath] = argv.slice(2);
if (bubblePath && mascotPath) {
  const bubble = decodePng(readFileSync(bubblePath));
  const mascot = decodePng(readFileSync(mascotPath));
  const pad = 6;
  const shot = blank(bubble.width, bubble.height + pad + mascot.height);
  blit(shot, bubble, 0, 0);
  blit(shot, mascot, Math.round((bubble.width - mascot.width) / 2), bubble.height + pad);
  writeFileSync(join(outDir, 'bubble.png'), encodePng(shot));
  stdout.write(`wrote ${outDir}/bubble.png\n`);
}
