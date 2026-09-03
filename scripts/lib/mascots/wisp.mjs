// The original mascot: a small purple flame-topped blob. Kept close to the pre-refactor art so
// existing screenshots and the README stay accurate.
import { Canvas, tintPalette } from '../canvas.mjs';
import { ellipseMask, paintEyes, paintMask, paintMouth, paintZ } from '../parts.mjs';
import { FRAME } from '../sheet.mjs';

/** @typedef {import('../mascot.mjs').Expression} Expression */
/** @typedef {import('../mascot.mjs').FrameSpec} FrameSpec */

/** @type {Record<string, import('../canvas.mjs').Rgba>} */
const PALETTE = {
  outline: [59, 26, 110, 255],
  body: [124, 58, 237, 255],
  light: [167, 139, 250, 255],
  tip: [221, 214, 254, 255],
  eye: [30, 27, 75, 255],
  white: [255, 255, 255, 255],
};
const TINT_SKIP = ['eye', 'white'];

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 */
function paintBlob(canvas, cx, cy, rx, ry) {
  const { palette } = canvas;
  paintMask(canvas, ellipseMask(cx, cy, rx, ry, canvas.width, canvas.height), palette.body, palette.outline);
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
 * Eyes and mouth for a mood. cy is the eye row, the same one the sheet's eye styles use.
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
 * @typedef {FrameSpec & {
 *   cx: number,
 *   cy: number,
 *   rx: number,
 *   ry: number,
 *   eyes: string,
 *   flameHeight: number,
 *   flameLean: number,
 *   feet?: [number, number],
 *   zAt?: [number, number],
 *   armsUp?: boolean,
 * }} WispSpec
 */

/** @param {WispSpec} spec */
function draw(spec) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const { cx, cy, rx, ry, eyes, flameHeight, flameLean, feet, zAt, armsUp } = spec;
  paintFlame(canvas, cx + 1, cy - ry, flameHeight, flameLean);
  paintBlob(canvas, cx, cy, rx, ry);
  paintEyes(canvas, cx, cy - 1, eyes, PALETTE.eye, PALETTE.white);
  if (eyes === 'happy') paintMouth(canvas, cx, cy + 2, 'smile', PALETTE.eye);
  if (feet) paintFeet(canvas, cx, cy + ry, feet[0], feet[1]);
  if (armsUp) paintArmsUp(canvas, cx, cy, rx);
  if (zAt) paintZ(canvas, zAt[0], zAt[1], PALETTE.tip);
  return canvas;
}

/** @type {WispSpec} */
const base = { cx: 15, cy: 20, rx: 8, ry: 8, eyes: 'open', flameHeight: 6, flameLean: 2 };

/** @param {WispSpec} spec */
function bob(spec) {
  return { ...spec, bobX: spec.cx - base.cx, bobY: spec.cy - base.cy };
}

/** @type {Record<string, WispSpec[]>} */
const FRAMES = {
  idle: [bob({ ...base, feet: [0, 0] }), bob({ ...base, cy: 21, ry: 7, flameHeight: 5, flameLean: 3, feet: [0, 0] })],
  walk: [
    bob({ ...base, feet: [-2, 2] }),
    bob({ ...base, cx: 16, cy: 19, feet: [0, 0] }),
    bob({ ...base, cx: 16, feet: [2, -2] }),
    bob({ ...base, cy: 19, feet: [0, 0] }),
  ],
  sit: [
    bob({ ...base, cy: 23, rx: 10, ry: 6, flameHeight: 5, feet: [-3, 3] }),
    bob({ ...base, cy: 23, rx: 10, ry: 6, flameHeight: 4, flameLean: 3, feet: [-3, 3] }),
  ],
  sleep: [
    bob({ ...base, cy: 24, rx: 10, ry: 5, eyes: 'closed', flameHeight: 3, flameLean: 1, zAt: [24, 10] }),
    bob({ ...base, cy: 24, rx: 10, ry: 5, eyes: 'closed', flameHeight: 3, flameLean: 2, zAt: [25, 7] }),
  ],
  alert: [
    bob({ ...base, cy: 18, rx: 7, ry: 10, eyes: 'wide', flameHeight: 7, flameLean: 0, feet: [0, 0] }),
    bob({ ...base, cy: 17, rx: 7, ry: 10, eyes: 'wide', flameHeight: 8, flameLean: 1, feet: [0, 0] }),
  ],
  // rx 7 keeps the expression overlay's eye patch inside the outline.
  drag: [
    bob({ ...base, cy: 17, rx: 7, ry: 11, flameHeight: 5, flameLean: 3, feet: [-1, 1] }),
    bob({ ...base, cx: 16, cy: 17, rx: 7, ry: 11, flameHeight: 5, flameLean: 4, feet: [1, -1] }),
  ],
  celebrate: [
    bob({ ...base, cy: 23, rx: 9, ry: 6, eyes: 'happy', flameHeight: 4, flameLean: 2, feet: [-1, 1] }),
    bob({ ...base, cy: 15, rx: 7, ry: 8, eyes: 'happy', flameHeight: 4, flameLean: 0, armsUp: true }),
    bob({ ...base, cy: 21, rx: 9, ry: 7, eyes: 'happy', flameHeight: 5, flameLean: 2, feet: [-2, 2] }),
  ],
};

/**
 * The overlay covers the eye box of any open-eyed pose (wide eyes included) with body colour,
 * then draws the mood's eyes and mouth at the idle eye position.
 * @param {Expression} expression
 */
function drawExpression(expression) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const eyeY = base.cy - 1;
  for (let y = eyeY - 1; y <= eyeY + 1; y++) {
    for (let x = base.cx - 2; x <= base.cx + 5; x++) canvas.set(x, y, PALETTE.body);
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
  paintFlame(tray, 12, 5, 4, 1);
  paintBlob(tray, 11, 13, 8, 8);
  paintExpression(tray, 11, 12, expression);
  return tray;
}

function drawIcon() {
  const first = FRAMES.idle?.[0];
  if (!first) throw new Error('Missing idle frame.');
  return draw(first);
}

/** @type {import('../mascot.mjs').Mascot<WispSpec>} */
export const wisp = { id: 'wisp', frames: FRAMES, draw, drawExpression, drawTray, drawIcon };
