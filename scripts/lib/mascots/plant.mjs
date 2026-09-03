// A seedling in a pot. Mood lives in the whole body here: leaves droop and dull when the pose
// is a low energy one, and stand upright with a small flower when it is a lively one. It moves
// by hopping with the pot, never with feet.
import { Canvas, tintPalette } from '../canvas.mjs';
import { paintEyes, paintMouth, paintZ } from '../parts.mjs';
import { FRAME } from '../sheet.mjs';

/** @typedef {import('../mascot.mjs').Expression} Expression */
/** @typedef {import('../mascot.mjs').FrameSpec} FrameSpec */

/** @type {Record<string, import('../canvas.mjs').Rgba>} */
const PALETTE = {
  outline: [58, 38, 22, 255],
  pot: [176, 98, 55, 255],
  potRim: [201, 138, 92, 255],
  soil: [90, 60, 38, 255],
  stem: [86, 138, 62, 255],
  leaf: [102, 168, 74, 255],
  leafDull: [141, 143, 105, 255],
  flower: [237, 137, 168, 255],
  flowerCenter: [247, 209, 92, 255],
  eye: [50, 43, 27, 255],
  white: [255, 255, 255, 255],
};
const TINT_SKIP = ['eye', 'white'];

/**
 * A trapezoid pot, wider at the rim than at the base, filled one row at a time.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} top
 * @param {number} height
 * @param {number} halfTop
 * @param {number} halfBottom
 */
function paintPot(canvas, cx, top, height, halfTop, halfBottom) {
  const { palette } = canvas;
  for (let row = 0; row <= height; row++) {
    const y = top + row;
    const t = row / height;
    const halfW = Math.round(halfTop + (halfBottom - halfTop) * t);
    for (let dx = -halfW; dx <= halfW; dx++) {
      const edge = dx === -halfW || dx === halfW || row === height;
      canvas.set(cx + dx, y, edge ? palette.outline : palette.pot);
    }
  }
  for (let dx = -halfTop + 1; dx <= halfTop - 1; dx++) canvas.set(cx + dx, top, palette.potRim);
  for (let dx = -halfTop + 2; dx <= halfTop - 2; dx++) canvas.set(cx + dx, top + 1, palette.soil);
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} baseY
 * @param {number} height
 */
function paintStem(canvas, cx, baseY, height) {
  for (let i = 0; i < height; i++) canvas.set(cx, baseY - i, canvas.palette.stem);
}

/**
 * A blade shaped leaf. Upright ones point up and outward, droopy ones sag down and outward.
 * @param {Canvas} canvas
 * @param {number} x
 * @param {number} y
 * @param {-1 | 1} dir
 * @param {boolean} upright
 */
function paintLeaf(canvas, x, y, dir, upright) {
  const color = upright ? canvas.palette.leaf : canvas.palette.leafDull;
  const dy = upright ? -1 : 1;
  canvas.set(x + dir, y, color);
  canvas.set(x + dir * 2, y + dy, color);
  canvas.set(x + dir * 3, y + dy * 2, color);
}

/**
 * @param {Canvas} canvas
 * @param {number} x
 * @param {number} y
 */
function paintFlower(canvas, x, y) {
  const { palette } = canvas;
  /** @type {[number, number][]} */
  const petals = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [dx, dy] of petals) canvas.set(x + dx, y + dy, palette.flower);
  canvas.set(x, y, palette.flowerCenter);
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {Expression} expression
 */
function paintExpression(canvas, cx, cy, expression) {
  const { palette } = canvas;
  if (expression === 'bright') {
    paintEyes(canvas, cx, cy, 'wide', palette.eye, palette.white);
    paintMouth(canvas, cx, cy + 3, 'smile', palette.eye);
    return;
  }
  if (expression === 'low') {
    paintEyes(canvas, cx, cy, 'half', palette.eye, palette.white);
    paintMouth(canvas, cx, cy + 3, 'flat', palette.eye);
    return;
  }
  paintEyes(canvas, cx, cy, 'open', palette.eye, palette.white);
}

/**
 * @typedef {FrameSpec & {
 *   cx: number,
 *   potTop: number,
 *   stemHeight: number,
 *   upright: boolean,
 *   flower: boolean,
 *   eyes: string,
 *   zAt?: [number, number],
 * }} PlantSpec
 */

const POT_HEIGHT = 9;
const POT_HALF_TOP = 7;
const POT_HALF_BOTTOM = 5;

/** @param {PlantSpec} spec */
function draw(spec) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const { cx, potTop, stemHeight, upright, flower, eyes, zAt } = spec;
  const soilY = potTop + 1;
  paintPot(canvas, cx, potTop, POT_HEIGHT, POT_HALF_TOP, POT_HALF_BOTTOM);
  paintStem(canvas, cx, soilY, stemHeight);
  const leafY = soilY - Math.round(stemHeight * 0.55);
  paintLeaf(canvas, cx, leafY, -1, upright);
  paintLeaf(canvas, cx, leafY, 1, upright);
  if (flower) paintFlower(canvas, cx, soilY - stemHeight - 1);
  const eyeY = potTop + 4;
  paintEyes(canvas, cx, eyeY, eyes, PALETTE.eye, PALETTE.white);
  if (zAt) paintZ(canvas, zAt[0], zAt[1], PALETTE.leaf);
  return canvas;
}

/** @type {PlantSpec} */
const base = { cx: 16, potTop: 18, stemHeight: 7, upright: true, flower: false, eyes: 'open' };

/** @param {PlantSpec} spec */
function bob(spec) {
  return { ...spec, bobX: spec.cx - base.cx, bobY: spec.potTop - base.potTop };
}

/** @type {Record<string, PlantSpec[]>} */
const FRAMES = {
  idle: [bob({ ...base }), bob({ ...base, potTop: 19, stemHeight: 6 })],
  walk: [
    bob({ ...base, potTop: 18 }),
    bob({ ...base, potTop: 14, stemHeight: 6 }),
    bob({ ...base, potTop: 18 }),
    bob({ ...base, potTop: 19, stemHeight: 8 }),
  ],
  sit: [
    bob({ ...base, potTop: 19, stemHeight: 5, upright: false }),
    bob({ ...base, potTop: 19, stemHeight: 5, upright: false }),
  ],
  sleep: [
    bob({ ...base, potTop: 19, stemHeight: 4, upright: false, eyes: 'closed', zAt: [24, 8] }),
    bob({ ...base, potTop: 19, stemHeight: 4, upright: false, eyes: 'closed', zAt: [25, 5] }),
  ],
  alert: [
    bob({ ...base, potTop: 17, stemHeight: 9, eyes: 'wide', flower: true }),
    bob({ ...base, potTop: 16, stemHeight: 10, eyes: 'wide', flower: true }),
  ],
  drag: [
    bob({ ...base, cx: 15, potTop: 18, stemHeight: 6 }),
    bob({ ...base, cx: 17, potTop: 18, stemHeight: 6 }),
  ],
  celebrate: [
    bob({ ...base, potTop: 19, stemHeight: 6, eyes: 'happy', flower: true }),
    bob({ ...base, potTop: 12, stemHeight: 9, eyes: 'happy', flower: true }),
    bob({ ...base, potTop: 18, stemHeight: 7, eyes: 'happy', flower: true }),
  ],
};

/**
 * @param {Expression} expression
 */
function drawExpression(expression) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const eyeY = base.potTop + 4;
  for (let y = eyeY - 1; y <= eyeY + 1; y++) {
    for (let x = base.cx - 2; x <= base.cx + 5; x++) canvas.set(x, y, PALETTE.pot);
  }
  paintExpression(canvas, base.cx, eyeY, expression);
  return canvas;
}

/**
 * @param {Expression} expression
 * @param {number} brightness
 * @param {number} saturation
 */
function drawTray(expression, brightness, saturation) {
  const tray = new Canvas(22, 22, tintPalette(PALETTE, brightness, saturation, TINT_SKIP));
  const upright = expression !== 'low';
  const flower = expression === 'bright';
  const potTop = 12;
  const stemHeight = expression === 'low' ? 3 : 5;
  paintPot(tray, 11, potTop, 7, 5, 4);
  paintStem(tray, 11, potTop + 1, stemHeight);
  const leafY = potTop + 1 - Math.round(stemHeight * 0.55);
  paintLeaf(tray, 11, leafY, -1, upright);
  paintLeaf(tray, 11, leafY, 1, upright);
  if (flower) paintFlower(tray, 11, potTop - stemHeight - 1);
  paintExpression(tray, 11, potTop + 3, expression);
  return tray;
}

function drawIcon() {
  const first = FRAMES.idle?.[0];
  if (!first) throw new Error('Missing idle frame.');
  return draw(first);
}

/** @type {import('../mascot.mjs').Mascot<PlantSpec>} */
export const plant = { id: 'plant', frames: FRAMES, draw, drawExpression, drawTray, drawIcon };
