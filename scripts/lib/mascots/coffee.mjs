// A small coffee cup and saucer. Steam plays the role the wisp's flame plays: tall and lively
// when the mood is bright, thin and drooping when it is low. A nod to the user's company, so it
// has to read as a cup at 32 pixels: wider than tall, a visible coffee surface under the rim,
// and a handle you can see the hole of.
import { Canvas, tintPalette } from '../canvas.mjs';
import { paintEyes, paintMouth, paintZ } from '../parts.mjs';
import { FRAME } from '../sheet.mjs';

/** @typedef {import('../mascot.mjs').Expression} Expression */
/** @typedef {import('../mascot.mjs').FrameSpec} FrameSpec */

/** @type {Record<string, import('../canvas.mjs').Rgba>} */
const PALETTE = {
  outline: [69, 42, 24, 255],
  cup: [246, 238, 224, 255],
  rim: [226, 199, 163, 255],
  liquid: [92, 51, 23, 255],
  steam: [223, 223, 223, 255],
  steamTip: [255, 255, 255, 255],
  eye: [58, 35, 20, 255],
  white: [255, 255, 255, 255],
};
const TINT_SKIP = ['eye', 'white'];

/**
 * A cup wider than it is tall, tapered toward the base. The rim is a distinct lighter line
 * across the top, with a dark coffee surface (two rows, narrower on the second) just below it,
 * which is the strongest single cue that this is a drink and not a box.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} top
 * @param {number} height
 * @param {number} halfTop
 * @param {number} halfBottom
 */
function paintCup(canvas, cx, top, height, halfTop, halfBottom) {
  const { palette } = canvas;
  for (let row = 0; row <= height; row++) {
    const y = top + row;
    const t = row / height;
    const halfW = Math.round(halfTop + (halfBottom - halfTop) * t);
    for (let dx = -halfW; dx <= halfW; dx++) {
      const edge = dx === -halfW || dx === halfW || row === height;
      canvas.set(cx + dx, y, edge ? palette.outline : palette.cup);
    }
  }
  for (let dx = -halfTop + 1; dx <= halfTop - 1; dx++) canvas.set(cx + dx, top, palette.rim);
  for (let dx = -(halfTop - 2); dx <= halfTop - 2; dx++)
    canvas.set(cx + dx, top + 1, palette.liquid);
  for (let dx = -(halfTop - 4); dx <= halfTop - 4; dx++)
    canvas.set(cx + dx, top + 2, palette.liquid);
}

/**
 * A saucer flush against the cup's base row, wider than the cup so it reads as one object.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} y the cup's own base row: the saucer sits on this row, never below it
 * @param {number} halfWidth
 */
function paintSaucer(canvas, cx, y, halfWidth) {
  const { palette } = canvas;
  for (let x = cx - halfWidth; x <= cx + halfWidth; x++) {
    canvas.set(x, y, palette.outline);
    canvas.set(
      x,
      y + 1,
      x === cx - halfWidth || x === cx + halfWidth ? palette.outline : palette.cup,
    );
  }
}

/**
 * An open ring beside the cup wall: it touches the wall only at its top and bottom corners,
 * leaving a two pixel gap along the middle and a hole in the centre you can see the wallpaper
 * through, so it reads as a handle rather than a stub.
 * @param {Canvas} canvas
 * @param {number} wallX
 * @param {number} midY
 */
function paintHandle(canvas, wallX, midY) {
  const { palette } = canvas;
  const left = wallX + 1;
  const right = wallX + 4;
  const top = midY - 3;
  const bottom = midY + 3;
  for (let x = left; x <= right; x++) {
    canvas.set(x, top, palette.outline);
    canvas.set(x, bottom, palette.outline);
  }
  for (let y = top; y <= bottom; y++) {
    canvas.set(left, y, palette.outline);
    canvas.set(right, y, palette.outline);
  }
  canvas.set(wallX, top, palette.outline);
  canvas.set(wallX, bottom, palette.outline);
}

/**
 * Two or three short curved strokes above the rim, standing in for the wisp's flame. It is the
 * mood carrier, so it stays visible (shorter, more bent) even in the plain expression.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} baseY
 * @param {2 | 3} strokes
 * @param {number} height
 * @param {number} curl
 */
function paintSteam(canvas, cx, baseY, strokes, height, curl) {
  const { palette } = canvas;
  const offsets = strokes === 3 ? [-4, 0, 4] : [-3, 3];
  for (const offset of offsets) {
    for (let i = 0; i < height; i++) {
      const y = baseY - i;
      const shift = Math.round(Math.sin((i / Math.max(1, height - 1)) * Math.PI) * curl);
      const isTip = i === height - 1;
      canvas.set(cx + offset + shift, y, isTip ? palette.steamTip : palette.steam);
    }
  }
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
 *   top: number,
 *   eyes: string,
 *   steamStrokes: 2 | 3,
 *   steamHeight: number,
 *   steamCurl: number,
 *   zAt?: [number, number],
 * }} CoffeeSpec
 */

const HEIGHT = 8;
const HALF_TOP = 8;
const HALF_BOTTOM = 6;
const SAUCER_HALF = 10;

/** @param {CoffeeSpec} spec */
function draw(spec) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const { cx, top, eyes, steamStrokes, steamHeight, steamCurl, zAt } = spec;
  const bottom = top + HEIGHT;
  paintSteam(canvas, cx, top - 2, steamStrokes, steamHeight, steamCurl);
  paintCup(canvas, cx, top, HEIGHT, HALF_TOP, HALF_BOTTOM);
  paintSaucer(canvas, cx, bottom, SAUCER_HALF);
  paintHandle(canvas, cx + HALF_TOP - 1, top + 4);
  paintEyes(canvas, cx, top + 5, eyes, PALETTE.eye, PALETTE.white);
  if (eyes === 'happy') paintMouth(canvas, cx, top + 8, 'smile', PALETTE.eye);
  if (zAt) paintZ(canvas, zAt[0], zAt[1], PALETTE.steamTip);
  return canvas;
}

/** @type {CoffeeSpec} */
const base = { cx: 16, top: 14, eyes: 'open', steamStrokes: 3, steamHeight: 5, steamCurl: 2 };

/** @param {CoffeeSpec} spec */
function bob(spec) {
  return { ...spec, bobX: spec.cx - base.cx, bobY: spec.top - base.top };
}

/** @type {Record<string, CoffeeSpec[]>} */
const FRAMES = {
  idle: [bob({ ...base }), bob({ ...base, top: 15, steamHeight: 4, steamCurl: 3 })],
  walk: [
    bob({ ...base, top: 13 }),
    bob({ ...base, top: 15 }),
    bob({ ...base, top: 13, steamCurl: 3 }),
    bob({ ...base, top: 15 }),
  ],
  sit: [
    bob({ ...base, top: 16, steamHeight: 4 }),
    bob({ ...base, top: 16, steamHeight: 4, steamCurl: 3 }),
  ],
  sleep: [
    bob({
      ...base,
      top: 17,
      eyes: 'closed',
      steamStrokes: 2,
      steamHeight: 3,
      steamCurl: 4,
      zAt: [26, 9],
    }),
    bob({
      ...base,
      top: 17,
      eyes: 'closed',
      steamStrokes: 2,
      steamHeight: 3,
      steamCurl: 5,
      zAt: [27, 6],
    }),
  ],
  alert: [
    bob({ ...base, top: 11, eyes: 'wide', steamHeight: 8, steamCurl: 1 }),
    bob({ ...base, top: 10, eyes: 'wide', steamHeight: 9, steamCurl: 0 }),
  ],
  drag: [
    bob({ ...base, cx: 15, top: 12, steamHeight: 6, steamCurl: 3 }),
    bob({ ...base, cx: 17, top: 12, steamHeight: 6, steamCurl: 4 }),
  ],
  celebrate: [
    bob({ ...base, top: 14, eyes: 'happy', steamHeight: 5 }),
    bob({ ...base, top: 8, eyes: 'happy', steamHeight: 7, steamCurl: 1 }),
    bob({ ...base, top: 13, eyes: 'happy', steamHeight: 6 }),
  ],
};

/**
 * @param {Expression} expression
 */
function drawExpression(expression) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const eyeY = base.top + 5;
  for (let y = eyeY - 1; y <= eyeY + 1; y++) {
    for (let x = base.cx - 2; x <= base.cx + 5; x++) canvas.set(x, y, PALETTE.cup);
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
  const steam =
    expression === 'bright'
      ? { strokes: /** @type {3} */ (3), height: 6, curl: 1 }
      : expression === 'low'
        ? { strokes: /** @type {2} */ (2), height: 3, curl: 4 }
        : { strokes: /** @type {3} */ (3), height: 4, curl: 2 };
  const top = 7;
  const height = 6;
  const halfTop = 6;
  const halfBottom = 4;
  paintSteam(tray, 11, top - 2, steam.strokes, steam.height, steam.curl);
  paintCup(tray, 11, top, height, halfTop, halfBottom);
  paintSaucer(tray, 11, top + height, halfTop + 3);
  paintExpression(tray, 11, top + 4, expression);
  return tray;
}

function drawIcon() {
  const first = FRAMES.idle?.[0];
  if (!first) throw new Error('Missing idle frame.');
  return draw(first);
}

/** @type {import('../mascot.mjs').Mascot<CoffeeSpec>} */
export const coffee = { id: 'coffee', frames: FRAMES, draw, drawExpression, drawTray, drawIcon };
