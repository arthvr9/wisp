// Builds the Aseprite style sheet, JSON, tray icons and settings icon for one mascot, out of
// the frame table and drawing functions its module provides. Generic over the mascot's own
// frame spec shape (see the Mascot typedef in scripts/lib/mascot.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Canvas, encodePng, upscale } from './canvas.mjs';
import { EXPRESSIONS, MOODS, POSES } from './mascot.mjs';

/** @typedef {import('./mascot.mjs').FrameSpec} FrameSpec */

export const FRAME = 32;

/**
 * @typedef {object} AsepriteFrame
 * @property {{ x: number; y: number; w: number; h: number }} frame
 * @property {boolean} rotated
 * @property {boolean} trimmed
 * @property {{ x: number; y: number; w: number; h: number }} spriteSourceSize
 * @property {{ w: number; h: number }} sourceSize
 * @property {number} duration
 */

/**
 * @template {FrameSpec} T
 * @param {import('./mascot.mjs').Mascot<T>} mascot
 */
export function buildSheet(mascot) {
  if (!(mascot.stridePx > 0)) throw new Error(`Mascot ${mascot.id} declares no walk stride.`);
  const rows = POSES.length + 1;
  // One row per pose, as wide as the longest pose that mascot draws. A mascot that spends eight
  // frames on its idle gets an eight column sheet; the renderer reads the tags, not the grid.
  const columns = Math.max(
    EXPRESSIONS.length,
    ...POSES.map((pose) => (mascot.frames[pose.name] ?? []).length),
  );
  const sheet = new Canvas(FRAME * columns, FRAME * rows);
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
    frames[`${mascot.id} ${index}.aseprite`] = {
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
    const specs = mascot.frames[pose.name] ?? [];
    if (specs.length === 0) throw new Error(`No frames for pose ${pose.name} of ${mascot.id}.`);
    specs.forEach((spec, column) => {
      offsetX.push(spec.bobX ?? 0);
      offsetY.push(spec.bobY ?? 0);
      place(mascot.draw(spec), column, row, spec.durationMs ?? pose.duration);
    });
    frameTags.push({ name: pose.name, from, to: index - 1, direction: 'forward' });
  });

  const expressionsFrom = index;
  EXPRESSIONS.forEach((expression, column) => {
    offsetX.push(0);
    offsetY.push(0);
    place(mascot.drawExpression(expression), column, POSES.length, 100);
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
      image: `${mascot.id}.png`,
      format: 'RGBA8888',
      size: { w: sheet.width, h: sheet.height },
      scale: '1',
      frameTags,
      wisp: { stridePx: mascot.stridePx, bob: { offsetX, offsetY } },
    },
  };
  return { sheet, json };
}

const PRINT_WIDTH = 100;

/** A number array as Prettier lays it out: one line if it fits, otherwise packed to the margin. */
const NUMBER_ARRAY = /^( *)("(?:[^"\\]|\\.)*": )?\[\n((?:\s*-?\d+,?\n)+) *\](,?)/gm;

/**
 * Formats the Aseprite JSON the way Prettier would, so the generated file passes
 * `prettier --check` without a second formatting pass. The bob offsets are one number per frame,
 * and a mascot that spends more frames on a pose grows them past the print width, so they have
 * to wrap the same way Prettier wraps them rather than only being collapsed.
 * @param {unknown} json
 */
export function formatJson(json) {
  const text = JSON.stringify(json, null, 2).replace(
    NUMBER_ARRAY,
    (_m, indent, key = '', body, comma) => {
      const items = String(body).match(/-?\d+/g) ?? [];
      const head = `${indent}${key}[`;
      const oneLine = `${head}${items.join(', ')}]${comma}`;
      if (oneLine.length <= PRINT_WIDTH) return oneLine;
      const inner = `${indent}  `;
      /** @type {string[]} */
      const lines = [];
      let line = inner;
      items.forEach((item, i) => {
        const next = line === inner ? line + item : `${line}, ${item}`;
        // The comma that will follow this line counts toward the margin, the way it does for
        // Prettier: a line that fits only without its trailing comma is one character too long.
        if (next.length + (i === items.length - 1 ? 0 : 1) > PRINT_WIDTH && line !== inner) {
          lines.push(`${line},`);
          line = inner + item;
          return;
        }
        line = next;
      });
      lines.push(line);
      return `${head}\n${lines.join('\n')}\n${indent}]${comma}`;
    },
  );
  return text + '\n';
}

/**
 * One tray icon pair (1x and 2x) per mood, plus the calm one duplicated as the neutral
 * `tray`/`tray@2x` files the tray reads before a mood is known.
 * @template {FrameSpec} T
 * @param {import('./mascot.mjs').Mascot<T>} mascot
 */
export function buildTrayIcons(mascot) {
  return MOODS.map(({ mood, expression, brightness, saturation }) => {
    const tray = mascot.drawTray(expression, brightness, saturation);
    const names = mood === 'calm' ? ['tray', 'tray-calm'] : [`tray-${mood}`];
    return { names, tray, tray2x: upscale(tray, 2) };
  });
}

/**
 * The 256x256 portrait used by the settings window and the mascot picker.
 * @template {FrameSpec} T
 * @param {import('./mascot.mjs').Mascot<T>} mascot
 */
export function buildIcon256(mascot) {
  return upscale(mascot.drawIcon(), 8);
}

/**
 * Writes every file the required layout expects for one mascot:
 * resources/sprites/<id>.png and .json, resources/icons/<id>/tray*.png and icon-256.png.
 * @template {FrameSpec} T
 * @param {import('./mascot.mjs').Mascot<T>} mascot
 * @param {string} root repository root
 */
export function writeMascotFiles(mascot, root) {
  const spritesDir = join(root, 'resources', 'sprites');
  const iconsDir = join(root, 'resources', 'icons', mascot.id);
  mkdirSync(spritesDir, { recursive: true });
  mkdirSync(iconsDir, { recursive: true });

  const { sheet, json } = buildSheet(mascot);
  writeFileSync(join(spritesDir, `${mascot.id}.png`), encodePng(sheet));
  writeFileSync(join(spritesDir, `${mascot.id}.json`), formatJson(json));

  for (const { names, tray, tray2x } of buildTrayIcons(mascot)) {
    for (const name of names) {
      writeFileSync(join(iconsDir, `${name}.png`), encodePng(tray));
      writeFileSync(join(iconsDir, `${name}@2x.png`), encodePng(tray2x));
    }
  }

  writeFileSync(join(iconsDir, 'icon-256.png'), encodePng(buildIcon256(mascot)));
}
