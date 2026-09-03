// A small black cat. Tail and ears carry the mood: tall perked ears and a curled tail read as
// bright, flattened ears and a low tail read as low. Two eyes and nothing else on the face; a
// mouth at 32 pixels turns to mush.
import { Canvas, tintPalette } from '../canvas.mjs';
import { ellipseMask, paintEyes, paintMask, paintZ } from '../parts.mjs';
import { FRAME } from '../sheet.mjs';

/** @typedef {import('../mascot.mjs').Expression} Expression */
/** @typedef {import('../mascot.mjs').FrameSpec} FrameSpec */

/** @type {Record<string, import('../canvas.mjs').Rgba>} */
const PALETTE = {
  outline: [14, 14, 18, 255],
  body: [45, 45, 52, 255],
  whisker: [80, 80, 88, 255],
  eye: [116, 214, 120, 255],
  white: [255, 255, 255, 255],
};
const TINT_SKIP = ['eye', 'white'];

/**
 * One ear as a small triangle. `height` shrinks it against the head for a flattened, wary or
 * sleepy look; `lean` tilts the apex sideways for a relaxed set.
 * @param {Canvas} canvas
 * @param {number} baseX
 * @param {number} baseY
 * @param {number} height
 * @param {number} lean
 * @param {1 | -1} side
 */
function paintEar(canvas, baseX, baseY, height, lean, side) {
  const { palette } = canvas;
  for (let i = 0; i < height; i++) {
    const y = baseY - i;
    const shift = Math.round((i / height) * lean) * side;
    const halfWidth = Math.max(0, Math.round(((height - i) / height) * 2));
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      const edge = dx === -halfWidth || dx === halfWidth || i === 0;
      canvas.set(baseX + shift + dx, y, edge ? palette.outline : palette.body);
    }
  }
}

/** @type {[number, number][]} */
const TAIL_LOW = [
  [1, 1],
  [2, 2],
  [3, 2],
  [4, 3],
  [5, 3],
  [6, 3],
];
/** @type {[number, number][]} */
const TAIL_CURLED = [
  [1, -1],
  [2, -2],
  [2, -3],
  [1, -4],
  [0, -5],
  [-1, -5],
];

/**
 * @param {Canvas} canvas
 * @param {number} x
 * @param {number} y
 * @param {boolean} curled
 */
function paintTail(canvas, x, y, curled) {
  const cells = curled ? TAIL_CURLED : TAIL_LOW;
  const { palette } = canvas;
  cells.forEach(([dx, dy], i) => {
    canvas.set(x + dx, y + dy, i === cells.length - 1 ? palette.outline : palette.body);
  });
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 */
function paintWhiskers(canvas, cx, cy) {
  const { palette } = canvas;
  for (const side of [-1, 1]) {
    canvas.set(cx + side * 6, cy, palette.whisker);
    canvas.set(cx + side * 7, cy, palette.whisker);
    canvas.set(cx + side * 6, cy + 1, palette.whisker);
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
    return;
  }
  if (expression === 'low') {
    paintEyes(canvas, cx, cy, 'half', palette.eye, palette.white);
    return;
  }
  paintEyes(canvas, cx, cy, 'open', palette.eye, palette.white);
}

/**
 * @typedef {FrameSpec & {
 *   cx: number,
 *   cy: number,
 *   rx: number,
 *   ry: number,
 *   eyes: string,
 *   earHeight: number,
 *   earLean: number,
 *   tailCurled: boolean,
 *   feet?: [number, number],
 *   zAt?: [number, number],
 * }} CatSpec
 */

/** @param {CatSpec} spec */
function draw(spec) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const { cx, cy, rx, ry, eyes, earHeight, earLean, tailCurled, feet, zAt } = spec;
  paintTail(canvas, cx + rx - 2, cy, tailCurled);
  paintEar(canvas, cx - 4, cy - ry + 1, earHeight, earLean, -1);
  paintEar(canvas, cx + 4, cy - ry + 1, earHeight, earLean, 1);
  paintMask(canvas, ellipseMask(cx, cy, rx, ry, FRAME, FRAME), PALETTE.body, PALETTE.outline);
  if (feet) {
    for (const dx of [-3, 3]) {
      canvas.set(cx + dx + feet[0], cy + ry, PALETTE.outline);
      canvas.set(cx + dx + feet[1], cy + ry, PALETTE.outline);
    }
  }
  paintEyes(canvas, cx, cy - 1, eyes, PALETTE.eye, PALETTE.white);
  paintWhiskers(canvas, cx, cy);
  if (zAt) paintZ(canvas, zAt[0], zAt[1], PALETTE.whisker);
  return canvas;
}

/** @type {CatSpec} */
const base = {
  cx: 16,
  cy: 20,
  rx: 8,
  ry: 7,
  eyes: 'open',
  earHeight: 5,
  earLean: 0,
  tailCurled: false,
};

/** @param {CatSpec} spec */
function bob(spec) {
  return { ...spec, bobX: spec.cx - base.cx, bobY: spec.cy - base.cy };
}

/** @type {Record<string, CatSpec[]>} */
const FRAMES = {
  idle: [bob({ ...base, feet: [0, 0] }), bob({ ...base, cy: 21, ry: 6, earLean: 1, feet: [0, 0] })],
  walk: [
    bob({ ...base, feet: [-2, 2] }),
    bob({ ...base, cx: 17, cy: 19, feet: [0, 0] }),
    bob({ ...base, cx: 17, feet: [2, -2] }),
    bob({ ...base, cy: 19, feet: [0, 0] }),
  ],
  sit: [
    bob({ ...base, cy: 22, rx: 9, ry: 6, earLean: 1, feet: [-3, 3] }),
    bob({ ...base, cy: 22, rx: 9, ry: 6, earLean: 2, feet: [-3, 3] }),
  ],
  sleep: [
    bob({
      ...base,
      cy: 23,
      rx: 10,
      ry: 5,
      eyes: 'closed',
      earHeight: 2,
      earLean: 2,
      zAt: [24, 10],
    }),
    bob({
      ...base,
      cy: 23,
      rx: 10,
      ry: 5,
      eyes: 'closed',
      earHeight: 2,
      earLean: 2,
      zAt: [25, 7],
    }),
  ],
  alert: [
    bob({
      ...base,
      cy: 18,
      rx: 7,
      ry: 9,
      eyes: 'wide',
      earHeight: 6,
      earLean: 0,
      tailCurled: true,
      feet: [0, 0],
    }),
    bob({
      ...base,
      cy: 17,
      rx: 7,
      ry: 9,
      eyes: 'wide',
      earHeight: 7,
      earLean: 0,
      tailCurled: true,
      feet: [0, 0],
    }),
  ],
  drag: [
    bob({ ...base, cy: 17, rx: 7, ry: 10, earLean: 1, feet: [-1, 1] }),
    bob({ ...base, cx: 17, cy: 17, rx: 7, ry: 10, earLean: 1, feet: [1, -1] }),
  ],
  celebrate: [
    bob({ ...base, cy: 22, rx: 9, ry: 6, eyes: 'wide', tailCurled: true, feet: [-1, 1] }),
    bob({
      ...base,
      cy: 15,
      rx: 7,
      ry: 8,
      eyes: 'wide',
      earHeight: 6,
      tailCurled: true,
      feet: [0, 0],
    }),
    bob({ ...base, cy: 20, rx: 9, ry: 7, eyes: 'wide', tailCurled: true, feet: [-2, 2] }),
  ],
};

/**
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
  const ears = expression === 'bright' ? 4 : expression === 'low' ? 2 : 3;
  paintTail(tray, 17, 13, expression === 'bright');
  paintEar(tray, 8, 6, ears, 0, -1);
  paintEar(tray, 14, 6, ears, 0, 1);
  paintMask(tray, ellipseMask(11, 13, 8, 8, 22, 22), tray.palette.body, tray.palette.outline);
  paintExpression(tray, 11, 12, expression);
  paintWhiskers(tray, 11, 13);
  return tray;
}

function drawIcon() {
  const first = FRAMES.idle?.[0];
  if (!first) throw new Error('Missing idle frame.');
  return draw(first);
}

/** @type {import('../mascot.mjs').Mascot<CatSpec>} */
export const cat = { id: 'cat', frames: FRAMES, draw, drawExpression, drawTray, drawIcon };
