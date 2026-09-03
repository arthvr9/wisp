// A small coffee cup and saucer. Steam plays the role the wisp's flame plays: tall and lively
// when the mood is bright, thin and drooping when it is low.
import { Canvas, tintPalette } from '../canvas.mjs';
import { paintEyes, paintMouth, paintZ } from '../parts.mjs';
import { FRAME } from '../sheet.mjs';

/** @typedef {import('../mascot.mjs').Expression} Expression */
/** @typedef {import('../mascot.mjs').FrameSpec} FrameSpec */

/** @type {Record<string, import('../canvas.mjs').Rgba>} */
const PALETTE = {
  outline: [69, 42, 24, 255],
  cup: [246, 238, 224, 255],
  rim: [214, 165, 116, 255],
  liquid: [92, 51, 23, 255],
  steam: [223, 223, 223, 255],
  steamTip: [255, 255, 255, 255],
  eye: [58, 35, 20, 255],
  white: [255, 255, 255, 255],
};
const TINT_SKIP = ['eye', 'white'];

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} top
 * @param {number} bottom
 * @param {number} halfWidth
 */
function paintCup(canvas, cx, top, bottom, halfWidth) {
  const { palette } = canvas;
  for (let y = top; y <= bottom; y++) {
    for (let x = cx - halfWidth; x <= cx + halfWidth; x++) {
      const edge = y === top || y === bottom || x === cx - halfWidth || x === cx + halfWidth;
      canvas.set(x, y, edge ? palette.outline : palette.cup);
    }
  }
  // A lighter ring for the ceramic lip, then the dark liquid inset inside it.
  for (let x = cx - halfWidth + 1; x <= cx + halfWidth - 1; x++) canvas.set(x, top, palette.rim);
  for (let x = cx - halfWidth + 2; x <= cx + halfWidth - 2; x++) canvas.set(x, top, palette.liquid);
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} y
 * @param {number} halfWidth
 */
function paintSaucer(canvas, cx, y, halfWidth) {
  const { palette } = canvas;
  for (let x = cx - halfWidth; x <= cx + halfWidth; x++) {
    canvas.set(x, y, palette.outline);
    canvas.set(x, y + 1, x === cx - halfWidth || x === cx + halfWidth ? palette.outline : palette.cup);
  }
}

/** @type {[number, number][]} */
const HANDLE_CELLS = [
  [0, 0],
  [1, 0],
  [2, 1],
  [2, 2],
  [2, 3],
  [1, 4],
  [0, 4],
];

/**
 * @param {Canvas} canvas
 * @param {number} x
 * @param {number} y
 */
function paintHandle(canvas, x, y) {
  for (const [dx, dy] of HANDLE_CELLS) canvas.set(x + dx, y + dy, canvas.palette.outline);
}

/**
 * A single wavy steam line, standing in for the wisp's flame. `droop` bends the top over
 * sideways instead of letting it rise straight, the low mood look.
 * @param {Canvas} canvas
 * @param {number} baseX
 * @param {number} baseY
 * @param {number} height
 * @param {number} lean
 * @param {boolean} droop
 */
function paintSteam(canvas, baseX, baseY, height, lean, droop) {
  const { palette } = canvas;
  for (let i = 0; i < height; i++) {
    const y = baseY - i;
    const wave = Math.round(Math.sin((i / Math.max(1, height - 1)) * Math.PI * 1.4) * lean);
    const bend = droop && i >= height - 2 ? (i - (height - 2) + 1) * 2 : 0;
    const isTip = i >= height - 1;
    canvas.set(baseX + wave + bend, y, isTip ? palette.steamTip : palette.steam);
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
 *   halfWidth: number,
 *   eyes: string,
 *   steamHeight: number,
 *   steamLean: number,
 *   steamDroop?: boolean,
 *   feet?: [number, number],
 *   zAt?: [number, number],
 *   handle?: boolean,
 * }} CoffeeSpec
 */

const CUP_HEIGHT = 11;
const SAUCER_Y = 27;

/** @param {CoffeeSpec} spec */
function draw(spec) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const { cx, top, halfWidth, eyes, steamHeight, steamLean, steamDroop, feet, zAt, handle } = spec;
  const bottom = top + CUP_HEIGHT;
  paintSaucer(canvas, cx, SAUCER_Y, halfWidth + 3);
  if (feet) {
    canvas.set(cx - halfWidth + feet[0], SAUCER_Y + 1, canvas.palette.outline);
    canvas.set(cx + halfWidth + feet[1], SAUCER_Y + 1, canvas.palette.outline);
  }
  paintSteam(canvas, cx, top - 1, steamHeight, steamLean, steamDroop ?? false);
  paintCup(canvas, cx, top, bottom, halfWidth);
  if (handle ?? true) paintHandle(canvas, cx + halfWidth - 1, Math.round(top + CUP_HEIGHT / 2) - 2);
  paintEyes(canvas, cx, top + 6, eyes, PALETTE.eye, PALETTE.white);
  if (eyes === 'happy') paintMouth(canvas, cx, top + 9, 'smile', PALETTE.eye);
  if (zAt) paintZ(canvas, zAt[0], zAt[1], PALETTE.steamTip);
  return canvas;
}

/** @type {CoffeeSpec} */
const base = { cx: 16, top: 13, halfWidth: 7, eyes: 'open', steamHeight: 6, steamLean: 2 };

/** @param {CoffeeSpec} spec */
function bob(spec) {
  return { ...spec, bobX: spec.cx - base.cx, bobY: spec.top - base.top };
}

/** @type {Record<string, CoffeeSpec[]>} */
const FRAMES = {
  idle: [
    bob({ ...base, feet: [0, 0] }),
    bob({ ...base, top: 14, steamHeight: 5, steamLean: 3, feet: [0, 0] }),
  ],
  walk: [
    bob({ ...base, feet: [-1, 1] }),
    bob({ ...base, cx: 17, top: 12, feet: [0, 0] }),
    bob({ ...base, cx: 17, feet: [1, -1] }),
    bob({ ...base, top: 12, feet: [0, 0] }),
  ],
  sit: [
    bob({ ...base, top: 15, halfWidth: 8, steamHeight: 5, feet: [-1, 1] }),
    bob({ ...base, top: 15, halfWidth: 8, steamHeight: 4, steamLean: 3, feet: [-1, 1] }),
  ],
  sleep: [
    bob({
      ...base,
      top: 16,
      halfWidth: 8,
      eyes: 'closed',
      steamHeight: 4,
      steamLean: 1,
      steamDroop: true,
      zAt: [24, 8],
    }),
    bob({
      ...base,
      top: 16,
      halfWidth: 8,
      eyes: 'closed',
      steamHeight: 4,
      steamLean: 2,
      steamDroop: true,
      zAt: [25, 5],
    }),
  ],
  alert: [
    bob({ ...base, top: 11, eyes: 'wide', steamHeight: 8, steamLean: 1, feet: [0, 0] }),
    bob({ ...base, top: 10, eyes: 'wide', steamHeight: 9, steamLean: 0, feet: [0, 0] }),
  ],
  drag: [
    bob({ ...base, top: 12, halfWidth: 6, steamHeight: 5, steamLean: 3, feet: [-1, 1] }),
    bob({ ...base, cx: 17, top: 12, halfWidth: 6, steamHeight: 5, steamLean: 4, feet: [1, -1] }),
  ],
  celebrate: [
    bob({ ...base, top: 14, halfWidth: 8, eyes: 'happy', steamHeight: 5, steamLean: 2, feet: [-1, 1] }),
    bob({ ...base, top: 9, halfWidth: 7, eyes: 'happy', steamHeight: 7, steamLean: 0, feet: [0, 0] }),
    bob({ ...base, top: 13, halfWidth: 8, eyes: 'happy', steamHeight: 6, steamLean: 2, feet: [-2, 2] }),
  ],
};

/**
 * @param {Expression} expression
 */
function drawExpression(expression) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const eyeY = base.top + 6;
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
      ? { height: 7, lean: 1, droop: false }
      : expression === 'low'
        ? { height: 3, lean: 2, droop: true }
        : { height: 5, lean: 2, droop: false };
  paintSteam(tray, 11, 5, steam.height, steam.lean, steam.droop);
  paintSaucer(tray, 11, 19, 9);
  paintCup(tray, 11, 8, 17, 6);
  paintExpression(tray, 11, 14, expression);
  return tray;
}

function drawIcon() {
  const first = FRAMES.idle?.[0];
  if (!first) throw new Error('Missing idle frame.');
  return draw(first);
}

/** @type {import('../mascot.mjs').Mascot<CoffeeSpec>} */
export const coffee = { id: 'coffee', frames: FRAMES, draw, drawExpression, drawTray, drawIcon };
