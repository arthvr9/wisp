// Placeholder art until a real Aseprite export replaces resources/sprites/wisp.{png,json}.
// Run with: node scripts/make-placeholder-sprites.mjs
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const FRAME = 32;
const COLUMNS = 4;

/** @typedef {number[]} Rgba */

/** @type {Record<string, Rgba>} */
const PALETTE = {
  outline: [59, 26, 110, 255],
  body: [124, 58, 237, 255],
  light: [167, 139, 250, 255],
  tip: [221, 214, 254, 255],
  eye: [30, 27, 75, 255],
  white: [255, 255, 255, 255],
};

/** @type {{ name: string; frames: number; duration: number }[]} */
const POSES = [
  { name: 'idle', frames: 2, duration: 500 },
  { name: 'walk', frames: 4, duration: 140 },
  { name: 'sit', frames: 2, duration: 600 },
  { name: 'sleep', frames: 2, duration: 900 },
  { name: 'alert', frames: 2, duration: 120 },
  { name: 'drag', frames: 2, duration: 300 },
];

class Canvas {
  /**
   * @param {number} width
   * @param {number} height
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {Rgba} rgba
   */
  set(x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data.set(rgba, (y * this.width + x) * 4);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Rgba}
   */
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0, 0];
    const i = (y * this.width + x) * 4;
    return Array.from(this.data.subarray(i, i + 4));
  }

  /**
   * @param {Canvas} source
   * @param {number} dx
   * @param {number} dy
   * @param {number} scale
   */
  blit(source, dx, dy, scale = 1) {
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const px = source.get(x, y);
        if (px[3] === 0) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            this.set(dx + x * scale + sx, dy + y * scale + sy, px);
          }
        }
      }
    }
  }
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @param {number} width
 * @param {number} height
 */
function ellipseMask(cx, cy, rx, ry, width, height) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      if (nx * nx + ny * ny < 0.98) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 */
function paintBlob(canvas, cx, cy, rx, ry) {
  const { width, height } = canvas;
  const mask = ellipseMask(cx, cy, rx, ry, width, height);
  /**
   * @param {number} x
   * @param {number} y
   */
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      canvas.set(x, y, edge ? PALETTE.outline : PALETTE.body);
    }
  }
  const hx = Math.round(cx - rx * 0.45);
  const hy = Math.round(cy - ry * 0.55);
  canvas.set(hx, hy, PALETTE.light);
  canvas.set(hx + 1, hy, PALETTE.light);
  canvas.set(hx, hy + 1, PALETTE.light);
}

/**
 * @param {Canvas} canvas
 * @param {number} baseX
 * @param {number} baseY
 * @param {number} height
 * @param {number} lean
 */
function paintFlame(canvas, baseX, baseY, height, lean) {
  for (let i = 0; i < height; i++) {
    const y = baseY - i;
    const shift = Math.round((i / height) * lean);
    const halfWidth = i < height / 2 ? 1 : 0;
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      const isTip = i >= height - 2;
      canvas.set(baseX + shift + dx, y, isTip ? PALETTE.tip : PALETTE.light);
    }
  }
  canvas.set(baseX, baseY, PALETTE.light);
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {string} style
 */
function paintEyes(canvas, cx, cy, style) {
  const leftX = cx - 1;
  const rightX = cx + 4;
  if (style === 'closed') {
    for (const x of [leftX, rightX]) {
      canvas.set(x, cy, PALETTE.eye);
      canvas.set(x + 1, cy, PALETTE.eye);
    }
    return;
  }
  if (style === 'wide') {
    for (const x of [leftX - 1, rightX - 1]) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = 0; dx < 3; dx++) canvas.set(x + dx, cy + dy, PALETTE.white);
      }
      canvas.set(x + 1, cy, PALETTE.eye);
      canvas.set(x + 2, cy, PALETTE.eye);
    }
    return;
  }
  for (const x of [leftX, rightX]) {
    canvas.set(x, cy - 1, PALETTE.white);
    canvas.set(x + 1, cy - 1, PALETTE.eye);
    canvas.set(x, cy, PALETTE.eye);
    canvas.set(x + 1, cy, PALETTE.eye);
  }
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} y
 * @param {number} leftShift
 * @param {number} rightShift
 */
function paintFeet(canvas, cx, y, leftShift, rightShift) {
  for (let dx = 0; dx < 2; dx++) {
    canvas.set(cx - 4 + leftShift + dx, y, PALETTE.outline);
    canvas.set(cx + 2 + rightShift + dx, y, PALETTE.outline);
  }
}

/**
 * @param {Canvas} canvas
 * @param {number} x
 * @param {number} y
 */
function paintZ(canvas, x, y) {
  /** @type {[number, number][]} */
  const cells = [
    [0, 0],
    [1, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ];
  for (const [dx, dy] of cells) canvas.set(x + dx, y + dy, PALETTE.tip);
}

/**
 * @typedef {object} WispSpec
 * @property {number} cx
 * @property {number} cy
 * @property {number} rx
 * @property {number} ry
 * @property {string} eyes
 * @property {number} flameHeight
 * @property {number} flameLean
 * @property {[number, number]} [feet]
 * @property {[number, number]} [zAt]
 */

/** @param {WispSpec} spec */
function drawWisp(spec) {
  const canvas = new Canvas(FRAME, FRAME);
  const { cx, cy, rx, ry, eyes, flameHeight, flameLean, feet, zAt } = spec;
  paintFlame(canvas, cx + 1, cy - ry, flameHeight, flameLean);
  paintBlob(canvas, cx, cy, rx, ry);
  paintEyes(canvas, cx, cy - 1, eyes);
  if (feet) paintFeet(canvas, cx, cy + ry, feet[0], feet[1]);
  if (zAt) paintZ(canvas, zAt[0], zAt[1]);
  return canvas;
}

/** @type {WispSpec} */
const base = { cx: 15, cy: 20, rx: 8, ry: 8, eyes: 'open', flameHeight: 6, flameLean: 2 };

/** @type {Record<string, WispSpec[]>} */
const FRAMES = {
  idle: [
    { ...base, feet: [0, 0] },
    { ...base, cy: 21, ry: 7, flameHeight: 5, flameLean: 3, feet: [0, 0] },
  ],
  walk: [
    { ...base, feet: [-2, 2] },
    { ...base, cx: 16, cy: 19, feet: [0, 0] },
    { ...base, cx: 16, feet: [2, -2] },
    { ...base, cy: 19, feet: [0, 0] },
  ],
  sit: [
    { ...base, cy: 23, rx: 10, ry: 6, flameHeight: 5, feet: [-3, 3] },
    { ...base, cy: 23, rx: 10, ry: 6, flameHeight: 4, flameLean: 3, feet: [-3, 3] },
  ],
  sleep: [
    { ...base, cy: 24, rx: 10, ry: 5, eyes: 'closed', flameHeight: 3, flameLean: 1, zAt: [24, 10] },
    { ...base, cy: 24, rx: 10, ry: 5, eyes: 'closed', flameHeight: 3, flameLean: 2, zAt: [25, 7] },
  ],
  alert: [
    { ...base, cy: 18, rx: 7, ry: 10, eyes: 'wide', flameHeight: 7, flameLean: 0, feet: [0, 0] },
    { ...base, cy: 17, rx: 7, ry: 10, eyes: 'wide', flameHeight: 8, flameLean: 1, feet: [0, 0] },
  ],
  drag: [
    { ...base, cy: 17, rx: 6, ry: 11, flameHeight: 5, flameLean: 3, feet: [-1, 1] },
    { ...base, cx: 16, cy: 17, rx: 6, ry: 11, flameHeight: 5, flameLean: 4, feet: [1, -1] },
  ],
};

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

/** @param {Uint8Array} bytes */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {string} type
 * @param {Uint8Array} data
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param {Canvas} canvas */
function encodePng(canvas) {
  const { width, height, data } = canvas;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @typedef {object} AsepriteFrame
 * @property {{ x: number; y: number; w: number; h: number }} frame
 * @property {boolean} rotated
 * @property {boolean} trimmed
 * @property {{ x: number; y: number; w: number; h: number }} spriteSourceSize
 * @property {{ w: number; h: number }} sourceSize
 * @property {number} duration
 */

function buildSheet() {
  const sheet = new Canvas(FRAME * COLUMNS, FRAME * POSES.length);
  /** @type {Record<string, AsepriteFrame>} */
  const frames = {};
  /** @type {{ name: string; from: number; to: number; direction: string }[]} */
  const frameTags = [];
  let index = 0;
  POSES.forEach((pose, row) => {
    const from = index;
    const specs = FRAMES[pose.name] ?? [];
    for (let column = 0; column < pose.frames; column++) {
      const spec = specs[column];
      if (!spec) throw new Error(`Missing frame ${column} for pose ${pose.name}.`);
      sheet.blit(drawWisp(spec), column * FRAME, row * FRAME);
      frames[`wisp ${index}.aseprite`] = {
        frame: { x: column * FRAME, y: row * FRAME, w: FRAME, h: FRAME },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: FRAME, h: FRAME },
        sourceSize: { w: FRAME, h: FRAME },
        duration: pose.duration,
      };
      index++;
    }
    frameTags.push({ name: pose.name, from, to: index - 1, direction: 'forward' });
  });
  const json = {
    frames,
    meta: {
      app: 'scripts/make-placeholder-sprites.mjs',
      version: '0',
      image: 'wisp.png',
      format: 'RGBA8888',
      size: { w: sheet.width, h: sheet.height },
      scale: '1',
      frameTags,
    },
  };
  return { sheet, json };
}

function buildTray() {
  const tray = new Canvas(22, 22);
  paintFlame(tray, 12, 5, 4, 1);
  paintBlob(tray, 11, 13, 8, 8);
  paintEyes(tray, 11, 12, 'open');
  return tray;
}

/**
 * @param {Canvas} source
 * @param {number} scale
 */
function upscale(source, scale) {
  const out = new Canvas(source.width * scale, source.height * scale);
  out.blit(source, 0, 0, scale);
  return out;
}

const spritesDir = join(root, 'resources', 'sprites');
const iconsDir = join(root, 'resources', 'icons');
mkdirSync(spritesDir, { recursive: true });
mkdirSync(iconsDir, { recursive: true });

const { sheet, json } = buildSheet();
writeFileSync(join(spritesDir, 'wisp.png'), encodePng(sheet));
writeFileSync(join(spritesDir, 'wisp.json'), JSON.stringify(json, null, 2) + '\n');

const tray = buildTray();
writeFileSync(join(iconsDir, 'tray.png'), encodePng(tray));
writeFileSync(join(iconsDir, 'tray@2x.png'), encodePng(upscale(tray, 2)));
const idle = FRAMES.idle?.[0];
if (!idle) throw new Error('Missing idle frame.');
writeFileSync(join(iconsDir, 'wisp-256.png'), encodePng(upscale(drawWisp(idle), 8)));

stdout.write('wrote resources/sprites/wisp.png, wisp.json and resources/icons/*.png\n');
