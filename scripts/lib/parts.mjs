// Small drawing helpers shared by every mascot: filled shapes, eyes, mouth, the sleep "z".
// Each mascot module composes these with its own bespoke bits (steam, ears, hem, leaves, ...).
import { Canvas } from './canvas.mjs';

/** @typedef {number[]} Rgba */

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @param {number} width
 * @param {number} height
 */
export function ellipseMask(cx, cy, rx, ry, width, height) {
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
 * A rounded box: an ellipse mask union a centred rectangle, for shapes wider than they are tall.
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @param {number} width
 * @param {number} height
 */
export function roundedBoxMask(cx, cy, rx, ry, width, height) {
  const mask = ellipseMask(cx, cy, rx, ry, width, height);
  const top = Math.round(cy - ry * 0.6);
  const bottom = Math.round(cy + ry);
  const left = Math.round(cx - rx);
  const right = Math.round(cx + rx);
  for (let y = Math.max(0, top); y <= Math.min(height - 1, bottom); y++) {
    for (let x = Math.max(0, left); x <= Math.min(width - 1, right); x++) {
      mask[y * width + x] = 1;
    }
  }
  return mask;
}

/**
 * Fills a mask with `body`, outlining the pixels that border outside the mask with `outline`.
 * @param {Canvas} canvas
 * @param {Uint8Array} mask
 * @param {Rgba} body
 * @param {Rgba} outline
 */
export function paintMask(canvas, mask, body, outline) {
  const { width, height } = canvas;
  /**
   * @param {number} x
   * @param {number} y
   */
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      canvas.set(x, y, edge ? outline : body);
    }
  }
}

/**
 * Two dot eyes centred on columns cx-2..cx+5, row cy. Style controls their shape.
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} cy
 * @param {'open' | 'wide' | 'half' | 'closed' | 'happy'} style
 * @param {Rgba} eye
 * @param {Rgba} white
 */
export function paintEyes(canvas, cx, cy, style, eye, white) {
  const leftX = cx - 1;
  const rightX = cx + 4;
  if (style === 'closed') {
    for (const x of [leftX, rightX]) {
      canvas.set(x, cy, eye);
      canvas.set(x + 1, cy, eye);
    }
    return;
  }
  if (style === 'happy') {
    for (const x of [leftX - 1, rightX - 1]) {
      canvas.set(x, cy, eye);
      canvas.set(x + 1, cy - 1, eye);
      canvas.set(x + 2, cy, eye);
    }
    return;
  }
  if (style === 'wide') {
    for (const x of [leftX - 1, rightX - 1]) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = 0; dx < 3; dx++) canvas.set(x + dx, cy + dy, white);
      }
      canvas.set(x + 1, cy, eye);
      canvas.set(x + 2, cy, eye);
    }
    return;
  }
  if (style === 'half') {
    for (const x of [leftX, rightX]) {
      canvas.set(x, cy, eye);
      canvas.set(x + 1, cy, eye);
    }
    return;
  }
  for (const x of [leftX, rightX]) {
    canvas.set(x, cy - 1, white);
    canvas.set(x + 1, cy - 1, eye);
    canvas.set(x, cy, eye);
    canvas.set(x + 1, cy, eye);
  }
}

/**
 * @param {Canvas} canvas
 * @param {number} cx
 * @param {number} y
 * @param {'smile' | 'flat'} shape
 * @param {Rgba} color
 */
export function paintMouth(canvas, cx, y, shape, color) {
  for (let dx = 1; dx <= 3; dx++) canvas.set(cx + dx, y, color);
  if (shape === 'smile') {
    canvas.set(cx, y - 1, color);
    canvas.set(cx + 4, y - 1, color);
  }
}

/**
 * @param {Canvas} canvas
 * @param {number} x
 * @param {number} y
 * @param {Rgba} color
 */
export function paintZ(canvas, x, y, color) {
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
  for (const [dx, dy] of cells) canvas.set(x + dx, y + dy, color);
}
