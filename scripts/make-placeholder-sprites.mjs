// Placeholder art until a real Aseprite export replaces resources/sprites/wisp.{png,json}.
// Run with: node scripts/make-placeholder-sprites.mjs
//
// The JSON follows the Aseprite "hash" export. `meta.wisp` is a Wisp extension the exporter
// does not produce: `meta.wisp.bob.offsetX[i]` and `offsetY[i]` say how far frame i moves the
// eyes away from their idle position, so the renderer can place the expression overlay on the
// eyes of a frame that bobs. Real art either fills it in by hand or leaves it out (zero offsets).
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
/** @typedef {'bright' | 'plain' | 'low'} Expression */

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
  { name: 'celebrate', frames: 3, duration: 160 },
];

/** @type {Expression[]} */
const EXPRESSIONS = ['bright', 'plain', 'low'];

/** @type {{ mood: string; expression: Expression; brightness: number; saturation: number }[]} */
const MOODS = [
  { mood: 'dejected', expression: 'low', brightness: 0.78, saturation: 0.55 },
  { mood: 'stressed', expression: 'low', brightness: 0.9, saturation: 0.85 },
  { mood: 'uneasy', expression: 'plain', brightness: 0.95, saturation: 0.95 },
  { mood: 'calm', expression: 'plain', brightness: 1, saturation: 1 },
  { mood: 'cheerful', expression: 'bright', brightness: 1.08, saturation: 1 },
  { mood: 'elated', expression: 'bright', brightness: 1.18, saturation: 1.05 },
];

class Canvas {
  /**
   * @param {number} width
   * @param {number} height
   * @param {Record<string, Rgba>} palette
   */
  constructor(width, height, palette = PALETTE) {
    this.width = width;
    this.height = height;
    this.palette = palette;
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
 * @param {number} brightness
 * @param {number} saturation
 * @returns {Record<string, Rgba>}
 */
function tintPalette(brightness, saturation) {
  /** @type {Record<string, Rgba>} */
  const out = {};
  for (const [name, [r, g, b, a]] of Object.entries(PALETTE)) {
    if (name === 'eye' || name === 'white') {
      out[name] = [r, g, b, a];
      continue;
    }
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    const channel = (/** @type {number} */ c) =>
      Math.max(0, Math.min(255, Math.round((grey + (c - grey) * saturation) * brightness)));
    out[name] = [channel(r), channel(g), channel(b), a];
  }
  return out;
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
  const { width, height, palette } = canvas;
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
      canvas.set(x, y, edge ? palette.outline : palette.body);
    }
  }
  const hx = Math.round(cx - rx * 0.45);
  const hy = Math.round(cy - ry * 0.55);
  canvas.set(hx, hy, palette.light);
  canvas.set(hx + 1, hy, palette.light);
  canvas.set(hx, hy + 1, palette.light);
}

/**
 * @param {Canvas} canvas
 * @param {number} baseX
 * @param {number} baseY
 * @param {number} height
 * @param {number} lean
 */
function paintFlame(canvas, baseX, baseY, height, lean) {
  const { palette } = canvas;
  for (let i = 0; i < height; i++) {
    const y = baseY - i;
    const shift = Math.round((i / height) * lean);
    const halfWidth = i < height / 2 ? 1 : 0;
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      const isTip = i >= height - 2;
      canvas.set(baseX + shift + dx, y, isTip ? palette.tip : palette.light);
    }
  }
  canvas.set(baseX, baseY, palette.light);
}

/**
 * Eyes sit at rows cy-1..cy+1, columns cx-2..cx+5. The wide style uses the whole box.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {string} style
 */
function paintEyes(canvas, cx, cy, style) {
  const { palette } = canvas;
  const leftX = cx - 1;
  const rightX = cx + 4;
  if (style === 'closed') {
    for (const x of [leftX, rightX]) {
      canvas.set(x, cy, palette.eye);
      canvas.set(x + 1, cy, palette.eye);
    }
    return;
  }
  if (style === 'happy') {
    for (const x of [leftX - 1, rightX - 1]) {
      canvas.set(x, cy, palette.eye);
      canvas.set(x + 1, cy - 1, palette.eye);
      canvas.set(x + 2, cy, palette.eye);
    }
    return;
  }
  if (style === 'wide') {
    for (const x of [leftX - 1, rightX - 1]) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = 0; dx < 3; dx++) canvas.set(x + dx, cy + dy, palette.white);
      }
      canvas.set(x + 1, cy, palette.eye);
      canvas.set(x + 2, cy, palette.eye);
    }
    return;
  }
  if (style === 'half') {
    for (const x of [leftX, rightX]) {
      canvas.set(x, cy - 1, palette.outline);
      canvas.set(x + 1, cy - 1, palette.outline);
      canvas.set(x, cy, palette.eye);
      canvas.set(x + 1, cy, palette.eye);
    }
    return;
  }
  for (const x of [leftX, rightX]) {
    canvas.set(x, cy - 1, palette.white);
    canvas.set(x + 1, cy - 1, palette.eye);
    canvas.set(x, cy, palette.eye);
    canvas.set(x + 1, cy, palette.eye);
  }
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} y
 * @param {'smile' | 'flat'} shape
 */
function paintMouth(canvas, cx, y, shape) {
  const { palette } = canvas;
  for (let dx = 1; dx <= 3; dx++) canvas.set(cx + dx, y, palette.eye);
  if (shape === 'smile') {
    canvas.set(cx, y - 1, palette.eye);
    canvas.set(cx + 4, y - 1, palette.eye);
  }
}

/**
 * Eyes and mouth for a mood. cy is the eye row, the same one paintEyes uses.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {Expression} expression
 */
function paintExpression(canvas, cx, cy, expression) {
  if (expression === 'bright') {
    paintEyes(canvas, cx, cy, 'wide');
    paintMouth(canvas, cx, cy + 3, 'smile');
    return;
  }
  if (expression === 'low') {
    paintEyes(canvas, cx, cy, 'half');
    paintMouth(canvas, cx, cy + 3, 'flat');
    return;
  }
  paintEyes(canvas, cx, cy, 'open');
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} y
 * @param {number} leftShift
 * @param {number} rightShift
 */
function paintFeet(canvas, cx, y, leftShift, rightShift) {
  const { palette } = canvas;
  for (let dx = 0; dx < 2; dx++) {
    canvas.set(cx - 4 + leftShift + dx, y, palette.outline);
    canvas.set(cx + 2 + rightShift + dx, y, palette.outline);
  }
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 */
function paintArmsUp(canvas, cx, cy, rx) {
  const { palette } = canvas;
  for (let i = 0; i < 3; i++) {
    canvas.set(cx - rx - i, cy - 2 - i, palette.outline);
    canvas.set(cx + rx + i, cy - 2 - i, palette.outline);
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
  for (const [dx, dy] of cells) canvas.set(x + dx, y + dy, canvas.palette.tip);
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
 * @property {boolean} [armsUp]
 */

/** @param {WispSpec} spec */
function drawWisp(spec) {
  const canvas = new Canvas(FRAME, FRAME);
  const { cx, cy, rx, ry, eyes, flameHeight, flameLean, feet, zAt, armsUp } = spec;
  paintFlame(canvas, cx + 1, cy - ry, flameHeight, flameLean);
  paintBlob(canvas, cx, cy, rx, ry);
  paintEyes(canvas, cx, cy - 1, eyes);
  if (eyes === 'happy') paintMouth(canvas, cx, cy + 2, 'smile');
  if (feet) paintFeet(canvas, cx, cy + ry, feet[0], feet[1]);
  if (armsUp) paintArmsUp(canvas, cx, cy, rx);
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
  // rx 7 keeps the expression overlay's eye patch inside the outline.
  drag: [
    { ...base, cy: 17, rx: 7, ry: 11, flameHeight: 5, flameLean: 3, feet: [-1, 1] },
    { ...base, cx: 16, cy: 17, rx: 7, ry: 11, flameHeight: 5, flameLean: 4, feet: [1, -1] },
  ],
  celebrate: [
    { ...base, cy: 23, rx: 9, ry: 6, eyes: 'happy', flameHeight: 4, flameLean: 2, feet: [-1, 1] },
    { ...base, cy: 15, rx: 7, ry: 8, eyes: 'happy', flameHeight: 4, flameLean: 0, armsUp: true },
    { ...base, cy: 21, rx: 9, ry: 7, eyes: 'happy', flameHeight: 5, flameLean: 2, feet: [-2, 2] },
  ],
};

/**
 * The overlay covers the eye box of any open-eyed pose (wide eyes included) with body colour,
 * then draws the mood's eyes and mouth at the idle eye position.
 * @param {Expression} expression
 */
function drawExpression(expression) {
  const canvas = new Canvas(FRAME, FRAME);
  const eyeY = base.cy - 1;
  for (let y = eyeY - 1; y <= eyeY + 1; y++) {
    for (let x = base.cx - 2; x <= base.cx + 5; x++) canvas.set(x, y, canvas.palette.body);
  }
  paintExpression(canvas, base.cx, eyeY, expression);
  return canvas;
}

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
  const rows = POSES.length + 1;
  const sheet = new Canvas(FRAME * COLUMNS, FRAME * rows);
  /** @type {Record<string, AsepriteFrame>} */
  const frames = {};
  /** @type {{ name: string; from: number; to: number; direction: string }[]} */
  const frameTags = [];
  /** @type {number[]} */
  const offsetX = [];
  /** @type {number[]} */
  const offsetY = [];
  let index = 0;

  /**
   * @param {Canvas} canvas
   * @param {number} column
   * @param {number} row
   * @param {number} duration
   */
  const place = (canvas, column, row, duration) => {
    sheet.blit(canvas, column * FRAME, row * FRAME);
    frames[`wisp ${index}.aseprite`] = {
      frame: { x: column * FRAME, y: row * FRAME, w: FRAME, h: FRAME },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: FRAME, h: FRAME },
      sourceSize: { w: FRAME, h: FRAME },
      duration,
    };
    index++;
  };

  POSES.forEach((pose, row) => {
    const from = index;
    const specs = FRAMES[pose.name] ?? [];
    for (let column = 0; column < pose.frames; column++) {
      const spec = specs[column];
      if (!spec) throw new Error(`Missing frame ${column} for pose ${pose.name}.`);
      offsetX.push(spec.cx - base.cx);
      offsetY.push(spec.cy - base.cy);
      place(drawWisp(spec), column, row, pose.duration);
    }
    frameTags.push({ name: pose.name, from, to: index - 1, direction: 'forward' });
  });

  const expressionsFrom = index;
  EXPRESSIONS.forEach((expression, column) => {
    offsetX.push(0);
    offsetY.push(0);
    place(drawExpression(expression), column, POSES.length, 100);
  });
  frameTags.push({
    name: 'expressions',
    from: expressionsFrom,
    to: index - 1,
    direction: 'forward',
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
      wisp: { bob: { offsetX, offsetY } },
    },
  };
  return { sheet, json };
}

/**
 * @param {Expression} expression
 * @param {number} brightness
 * @param {number} saturation
 */
function buildTray(expression, brightness, saturation) {
  const tray = new Canvas(22, 22, tintPalette(brightness, saturation));
  paintFlame(tray, 12, 5, 4, 1);
  paintBlob(tray, 11, 13, 8, 8);
  paintExpression(tray, 11, 12, expression);
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
// Prettier keeps short number arrays on one line; match it so the generated file passes the check.
const jsonText = JSON.stringify(json, null, 2).replace(
  /\[\s*(-?\d+(?:,\s*-?\d+)*)\s*\]/g,
  (_m, items) => `[${String(items).replace(/\s+/g, ' ')}]`,
);
writeFileSync(join(spritesDir, 'wisp.json'), jsonText + '\n');

for (const { mood, expression, brightness, saturation } of MOODS) {
  const tray = buildTray(expression, brightness, saturation);
  const names = mood === 'calm' ? ['tray', 'tray-calm'] : [`tray-${mood}`];
  for (const name of names) {
    writeFileSync(join(iconsDir, `${name}.png`), encodePng(tray));
    writeFileSync(join(iconsDir, `${name}@2x.png`), encodePng(upscale(tray, 2)));
  }
}
const idle = FRAMES.idle?.[0];
if (!idle) throw new Error('Missing idle frame.');
writeFileSync(join(iconsDir, 'wisp-256.png'), encodePng(upscale(drawWisp(idle), 8)));

stdout.write('wrote resources/sprites/wisp.png, wisp.json and resources/icons/*.png\n');
