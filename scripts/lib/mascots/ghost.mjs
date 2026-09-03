// A small round ghost with a wavy hem. It floats, so it never has feet: the walk cycle bobs and
// the hem waves instead of stepping. The body is pale rather than alpha blended, so it stays
// readable over any wallpaper.
import { Canvas, tintPalette } from '../canvas.mjs';
import { paintMouth, paintZ } from '../parts.mjs';
import { FRAME } from '../sheet.mjs';

/** @typedef {import('../mascot.mjs').Expression} Expression */
/** @typedef {import('../mascot.mjs').FrameSpec} FrameSpec */

/** @type {Record<string, import('../canvas.mjs').Rgba>} */
const PALETTE = {
  outline: [150, 165, 190, 255],
  body: [231, 238, 247, 255],
  shadow: [170, 178, 195, 140],
  eye: [58, 66, 92, 255],
  white: [255, 255, 255, 255],
};
const TINT_SKIP = ['eye', 'white', 'shadow'];
const LEGS = 3;

/**
 * A dome topped body with a three bump hem, filled one column at a time: each column runs from
 * the dome curve down to the hem. The hem is a hard edged triangular scallop per leg, not a
 * smooth curve, so it reads as cloth rather than noise. `phase` shifts the scallops sideways a
 * little for the idle and walk animation.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} top
 * @param {number} halfWidth
 * @param {number} straightHeight
 * @param {number} hemDepth
 * @param {number} phase
 */
function paintGhost(canvas, cx, top, halfWidth, straightHeight, hemDepth, phase) {
  const { palette } = canvas;
  const domeHeight = halfWidth;
  const notchY = top + domeHeight + straightHeight;
  const width = halfWidth * 2 + 1;
  const legWidth = width / LEGS;
  for (let dx = -halfWidth; dx <= halfWidth; dx++) {
    const nx = dx / halfWidth;
    const domeDrop = Math.round((1 - Math.sqrt(Math.max(0, 1 - nx * nx))) * domeHeight);
    const colTop = top + domeDrop;
    const pos = dx + halfWidth + phase;
    const withinLeg = ((pos % legWidth) + legWidth) % legWidth;
    const centerDist = Math.abs(withinLeg - legWidth / 2) / (legWidth / 2);
    const colBottom = notchY + Math.round((1 - centerDist) * hemDepth);
    const isEdgeColumn = dx === -halfWidth || dx === halfWidth;
    for (let y = colTop; y <= colBottom; y++) {
      const edge = isEdgeColumn || y === colTop || y === colBottom;
      canvas.set(cx + dx, y, edge ? palette.outline : palette.body);
    }
  }
}

/**
 * A flat shadow on the ground. It shrinks when the ghost floats higher, to sell the height.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} y
 * @param {number} halfWidth
 */
function paintShadow(canvas, cx, y, halfWidth) {
  const { palette } = canvas;
  for (let dx = -halfWidth; dx <= halfWidth; dx++) canvas.set(cx + dx, y, palette.shadow);
}

/**
 * Two small dark eyes with a one pixel light halo, so they read as eyes and not as dents in a
 * pale body.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {'open' | 'closed'} style
 */
function paintEyes(canvas, cx, cy, style) {
  const { palette } = canvas;
  for (const x of [cx - 1, cx + 4]) {
    for (let dy = -2; dy <= 1; dy++) {
      for (let dx = -1; dx <= 2; dx++) canvas.set(x + dx, cy + dy, palette.white);
    }
  }
  for (const x of [cx - 1, cx + 4]) {
    if (style === 'closed') {
      canvas.set(x, cy, palette.eye);
      canvas.set(x + 1, cy, palette.eye);
      continue;
    }
    canvas.set(x, cy - 1, palette.eye);
    canvas.set(x + 1, cy - 1, palette.eye);
    canvas.set(x, cy, palette.eye);
    canvas.set(x + 1, cy, palette.eye);
  }
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {Expression} expression
 */
function paintExpression(canvas, cx, cy, expression) {
  if (expression === 'bright') {
    paintEyes(canvas, cx, cy, 'open');
    paintMouth(canvas, cx, cy + 4, 'smile', canvas.palette.eye);
    return;
  }
  if (expression === 'low') {
    paintEyes(canvas, cx, cy, 'closed');
    paintMouth(canvas, cx, cy + 4, 'flat', canvas.palette.eye);
    return;
  }
  paintEyes(canvas, cx, cy, 'open');
}

/**
 * @typedef {FrameSpec & {
 *   cx: number,
 *   top: number,
 *   halfWidth: number,
 *   eyes: 'open' | 'closed' | 'happy',
 *   hemDepth: number,
 *   phase: number,
 *   shadowWidth: number,
 *   zAt?: [number, number],
 * }} GhostSpec
 */

const STRAIGHT_HEIGHT = 5;

/** @param {GhostSpec} spec */
function draw(spec) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const { cx, top, halfWidth, eyes, hemDepth, phase, shadowWidth, zAt } = spec;
  paintShadow(canvas, cx, 29, shadowWidth);
  paintGhost(canvas, cx, top, halfWidth, STRAIGHT_HEIGHT, hemDepth, phase);
  const eyeY = top + halfWidth + 2;
  paintEyes(canvas, cx, eyeY, eyes === 'closed' ? 'closed' : 'open');
  if (eyes === 'happy') paintMouth(canvas, cx, eyeY + 4, 'smile', PALETTE.eye);
  if (zAt) paintZ(canvas, zAt[0], zAt[1], PALETTE.outline);
  return canvas;
}

/** @type {GhostSpec} */
const base = {
  cx: 16,
  top: 10,
  halfWidth: 7,
  eyes: 'open',
  hemDepth: 3,
  phase: 0,
  shadowWidth: 6,
};

/** @param {GhostSpec} spec */
function bob(spec) {
  const eyeY = spec.top + spec.halfWidth + 2;
  const baseEyeY = base.top + base.halfWidth + 2;
  return { ...spec, bobX: spec.cx - base.cx, bobY: eyeY - baseEyeY };
}

/** @type {Record<string, GhostSpec[]>} */
const FRAMES = {
  idle: [bob({ ...base }), bob({ ...base, top: 11, phase: 2 })],
  walk: [
    bob({ ...base, top: 9 }),
    bob({ ...base, top: 11, phase: 1 }),
    bob({ ...base, top: 9, phase: 2 }),
    bob({ ...base, top: 11, phase: 3 }),
  ],
  sit: [
    bob({ ...base, top: 14, halfWidth: 9, hemDepth: 2, shadowWidth: 8 }),
    bob({ ...base, top: 14, halfWidth: 9, hemDepth: 2, phase: 1, shadowWidth: 8 }),
  ],
  sleep: [
    bob({
      ...base,
      top: 15,
      halfWidth: 8,
      eyes: 'closed',
      hemDepth: 1,
      shadowWidth: 8,
      zAt: [24, 8],
    }),
    bob({
      ...base,
      top: 15,
      halfWidth: 8,
      eyes: 'closed',
      hemDepth: 1,
      phase: 1,
      shadowWidth: 8,
      zAt: [25, 5],
    }),
  ],
  alert: [
    bob({ ...base, top: 6, eyes: 'open', hemDepth: 4, shadowWidth: 5 }),
    bob({ ...base, top: 5, eyes: 'open', hemDepth: 4, phase: 2, shadowWidth: 5 }),
  ],
  drag: [
    bob({ ...base, cx: 15, top: 8, hemDepth: 4, shadowWidth: 5 }),
    bob({ ...base, cx: 17, top: 8, hemDepth: 4, phase: 2, shadowWidth: 5 }),
  ],
  celebrate: [
    bob({ ...base, top: 12, halfWidth: 8, eyes: 'happy', shadowWidth: 7 }),
    bob({ ...base, top: 4, eyes: 'happy', hemDepth: 4, shadowWidth: 4 }),
    bob({ ...base, top: 10, halfWidth: 8, eyes: 'happy', phase: 2, shadowWidth: 7 }),
  ],
};

/**
 * @param {Expression} expression
 */
function drawExpression(expression) {
  const canvas = new Canvas(FRAME, FRAME, PALETTE);
  const eyeY = base.top + base.halfWidth + 2;
  for (let y = eyeY - 2; y <= eyeY + 1; y++) {
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
  const hemDepth = expression === 'bright' ? 3 : expression === 'low' ? 1 : 2;
  paintShadow(tray, 11, 20, 4);
  paintGhost(tray, 11, 4, 5, 4, hemDepth, 0);
  paintExpression(tray, 11, 11, expression);
  return tray;
}

function drawIcon() {
  const first = FRAMES.idle?.[0];
  if (!first) throw new Error('Missing idle frame.');
  return draw(first);
}

/** @type {import('../mascot.mjs').Mascot<GhostSpec>} */
export const ghost = { id: 'ghost', frames: FRAMES, draw, drawExpression, drawTray, drawIcon };
