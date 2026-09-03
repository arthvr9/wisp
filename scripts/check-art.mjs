// Checks that the committed art still matches what the generators produce.
// Run with: node scripts/check-art.mjs
//
// It compares pixels rather than file bytes on purpose. PNG payloads are deflate compressed,
// and two zlib versions can encode identical pixels into different bytes, so a byte comparison
// fails on a runner whose Node differs from the author's while the art is in fact identical.
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { inflateSync } from 'node:zlib';

/** @typedef {{ width: number; height: number; data: Uint8Array }} Image */

/**
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

/** @param {string} path */
function committed(path) {
  return execFileSync('git', ['show', `HEAD:${path}`], { maxBuffer: 64 * 1024 * 1024 });
}

/**
 * @param {Image} a
 * @param {Image} b
 */
function samePixels(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

// Only the generated art matters here. Anything else in the tree is the caller's business.
const ART = ['resources/sprites/', 'resources/icons/', 'docs/images/'];

const changed = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .map((line) => line.replace(/^\S+\s+/, ''))
  .filter((path) => ART.some((prefix) => path.startsWith(prefix)));

/** @type {string[]} */
const differing = [];
/** @type {string[]} */
const recompressed = [];

for (const path of changed) {
  if (!path.endsWith('.png')) {
    differing.push(path);
    continue;
  }
  try {
    if (samePixels(decodePng(committed(path)), decodePng(readFileSync(path)))) {
      recompressed.push(path);
    } else {
      differing.push(path);
    }
  } catch {
    differing.push(path);
  }
}

if (recompressed.length > 0) {
  stdout.write(
    `${recompressed.length} images differ only in compression, not in pixels, which is a zlib` +
      ' version difference and not an art change.\n',
  );
}

if (differing.length > 0) {
  stdout.write('Generated art does not match the generators. Run: npm run sprites\n');
  for (const path of differing) stdout.write(`  ${path}\n`);
  exit(1);
}

if (!argv.includes('--quiet')) stdout.write('Art matches its generators.\n');
