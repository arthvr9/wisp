import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import {
  CUSTOM_ART_GUIDE,
  CUSTOM_ART_REFERENCE,
  POSE_GUIDE,
  POSE_GUIDE_FALLBACK,
  frameFileName,
} from '../../shared/custom-art';
import type { CustomArtSpec } from '../../shared/custom-art';
import { readBuiltInSheet, readPng } from './validate';
import type { BuiltInSheet } from './validate';

type Rgba = readonly [number, number, number, number];

export class Canvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, colour: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data.set(colour, (y * this.width + x) * 4);
  }

  fill(colour: Rgba): void {
    for (let i = 0; i < this.data.length; i += 4) this.data.set(colour, i);
  }

  rect(x: number, y: number, w: number, h: number, colour: Rgba): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, colour);
    }
  }
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodePng(canvas: Canvas): Buffer {
  const { width, height, data } = canvas;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// A 3 by 5 font, one string of fifteen cells per glyph. The labels on the reference sheet are
// pixels like everything else here, so no font file has to ship or be found on the machine.
const GLYPHS: Record<string, string> = {
  A: '.#.#.#####.##.#',
  B: '##.#.###.#.###.',
  C: '.###..#..#...##',
  D: '##.#.##.##.###.',
  E: '####..##.#..###',
  F: '####..##.#..#..',
  G: '.###..#.##.#.##',
  H: '#.##.#####.##.#',
  I: '###.#..#..#.###',
  J: '..#..#..##.#.#.',
  K: '#.##.###.#.##.#',
  L: '#..#..#..#..###',
  M: '#.########.##.#',
  N: '#.###.###.###.#',
  O: '.#.#.##.##.#.#.',
  P: '##.#.###.#..#..',
  Q: '.#.#.##.####.##',
  R: '##.#.###.#.##.#',
  S: '.###...#...###.',
  T: '###.#..#..#..#.',
  U: '#.##.##.##.#.#.',
  V: '#.##.##.#.#..#.',
  W: '#.##.########.#',
  X: '#.##.#.#.#.##.#',
  Y: '#.##.#.#..#..#.',
  Z: '###..#.#.#..###',
  '0': '####.##.##.####',
  '1': '.#.##..#..#.###',
  '2': '##...#.#.#..###',
  '3': '##...#.#...###.',
  '4': '#.##.####..#..#',
  '5': '####..##...###.',
  '6': '.###..####.####',
  '7': '###..#.#.#..#..',
  '8': '####.#####.####',
  '9': '####.####..###.',
  ' ': '...............',
  '.': '.............#.',
};

const GLYPH_W = 3;
const GLYPH_H = 5;

function drawText(canvas: Canvas, text: string, x: number, y: number, scale: number, colour: Rgba) {
  let cursor = x;
  for (const character of text.toUpperCase()) {
    const glyph = GLYPHS[character] ?? GLYPHS[' '] ?? '';
    for (let row = 0; row < GLYPH_H; row++) {
      for (let column = 0; column < GLYPH_W; column++) {
        if (glyph[row * GLYPH_W + column] !== '#') continue;
        canvas.rect(cursor + column * scale, y + row * scale, scale, scale, colour);
      }
    }
    cursor += (GLYPH_W + 1) * scale;
  }
}

function textWidth(text: string, scale: number): number {
  return text.length * (GLYPH_W + 1) * scale - scale;
}

const BACKGROUND: Rgba = [23, 23, 27, 255];
const INK: Rgba = [232, 232, 234, 255];
const DIM: Rgba = [124, 124, 136, 255];
const GROUND: Rgba = [58, 58, 68, 255];

const FRAME_SCALE = 3;
const TEXT_SCALE = 2;
const MARGIN = 12;
const FRAME_GAP = 4;
const LABEL_GAP = 6;
const NUMBER_GAP = 3;

/**
 * The built-in frames laid out one row per pose, with the pose name, the frame numbers and the
 * ground line drawn in. It is the picture the guide file talks about.
 */
export function buildReferenceImage(sheet: BuiltInSheet): Canvas {
  const { spec, rects } = sheet;
  const source = readPng(readFileSync(sheet.imagePath));
  if (!source?.rgba) throw new Error(`Sprite sheet ${sheet.imagePath} could not be read.`);
  const pixels = source.rgba;

  const frameW = spec.frameWidth * FRAME_SCALE;
  const frameH = spec.frameHeight * FRAME_SCALE;
  const columns = Math.max(...spec.poses.map((pose) => pose.frames));
  const labelH = GLYPH_H * TEXT_SCALE;
  const blockH = labelH + LABEL_GAP + frameH + NUMBER_GAP + labelH;
  const canvas = new Canvas(
    MARGIN * 2 + columns * (frameW + FRAME_GAP) - FRAME_GAP,
    MARGIN * 2 + spec.poses.length * (blockH + MARGIN) - MARGIN,
  );
  canvas.fill(BACKGROUND);

  let top = MARGIN;
  for (const pose of spec.poses) {
    const label = `${pose.pose} ${pose.frames} frames`;
    drawText(canvas, label, MARGIN, top, TEXT_SCALE, INK);
    const framesTop = top + labelH + LABEL_GAP;
    const groundY = framesTop + spec.groundRow * FRAME_SCALE;
    canvas.rect(MARGIN, groundY, canvas.width - MARGIN * 2, 1, GROUND);
    (rects[pose.pose] ?? []).forEach((rect, index) => {
      const left = MARGIN + index * (frameW + FRAME_GAP);
      for (let y = 0; y < rect.h; y++) {
        for (let x = 0; x < rect.w; x++) {
          const at = ((rect.y + y) * source.width + rect.x + x) * 4;
          const alpha = pixels[at + 3] ?? 0;
          if (alpha === 0) continue;
          canvas.rect(
            left + x * FRAME_SCALE,
            framesTop + y * FRAME_SCALE,
            FRAME_SCALE,
            FRAME_SCALE,
            [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0, 255],
          );
        }
      }
      const number = String(index + 1).padStart(2, '0');
      drawText(
        canvas,
        number,
        left + Math.round((frameW - textWidth(number, TEXT_SCALE)) / 2),
        framesTop + frameH + NUMBER_GAP,
        TEXT_SCALE,
        DIM,
      );
    });
    top += blockH + MARGIN;
  }
  return canvas;
}

const GUIDE_WIDTH = 92;

function wrap(text: string, indent: string): string[] {
  const lines: string[] = [];
  let line = indent;
  for (const word of text.split(' ')) {
    if (line !== indent && line.length + 1 + word.length > GUIDE_WIDTH) {
      lines.push(line);
      line = indent + word;
      continue;
    }
    line = line === indent ? line + word : `${line} ${word}`;
  }
  lines.push(line);
  return lines;
}

export function buildGuide(spec: CustomArtSpec): string {
  const size = `${spec.frameWidth} by ${spec.frameHeight}`;
  const lines: string[] = [
    'How to draw a mascot for Wisp',
    '',
    `Every frame is a ${size} pixel PNG with a transparent background.`,
    `The ground is row ${spec.groundRow}, counting rows from the top of the frame starting at 0.`,
    'Whatever stands on the floor rests on that row, and its shadow may spill one row below it.',
    'Keep the mascot facing right. Wisp mirrors the art when it walks the other way.',
    '',
    'Any pose you leave undrawn falls back to the built-in art, so you can draw idle and walk',
    'first and come back to the rest later. Leave the frames of a pose empty, or delete them,',
    'and the built-in art plays for that pose.',
    'A pose is all or nothing: draw every frame of it, or leave every frame of it empty.',
    '',
    `Open ${CUSTOM_ART_REFERENCE} to see the built-in frames of every pose, with the frame`,
    'numbers and the ground line drawn in.',
    '',
    'The poses',
    '',
  ];
  for (const pose of spec.poses) {
    const first = frameFileName(pose.pose, 1);
    const last = frameFileName(pose.pose, pose.frames);
    lines.push(`${pose.pose}, ${pose.frames} frames, ${first} to ${last}`);
    lines.push(...wrap(POSE_GUIDE[pose.pose] ?? POSE_GUIDE_FALLBACK, '  '));
    lines.push(`  Each frame is held for about ${pose.durationMs} ms.`);
    lines.push('');
  }
  lines.push(
    'When the frames are ready',
    '',
    'Open Settings, Mascot, Import a drawing, and choose this folder. Wisp checks every file',
    'and tells you which file needs work. One empty frame in a pose you drew counts as work to',
    'do, because an invisible frame is hard to tell from a broken one.',
    '',
    'Moods still use the built-in expressions. Drawing your own comes later.',
    '',
  );
  return lines.join('\n');
}

export interface TemplateExport {
  dir: string;
  written: string[];
  /** Files that were already there. Nothing is overwritten, drawings included. */
  skipped: string[];
  spec: CustomArtSpec;
}

/**
 * Writes a starter kit into `targetDir`: one transparent PNG per frame, the reference image and
 * the guide. An existing file is never overwritten.
 */
export function exportTemplate(targetDir: string, spritesDir: string): TemplateExport {
  const sheet = readBuiltInSheet(spritesDir);
  const { spec } = sheet;
  mkdirSync(targetDir, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];

  const write = (name: string, bytes: Buffer | string): void => {
    const path = join(targetDir, name);
    if (existsSync(path)) {
      skipped.push(name);
      return;
    }
    writeFileSync(path, bytes);
    written.push(name);
  };

  const blank = encodePng(new Canvas(spec.frameWidth, spec.frameHeight));
  for (const pose of spec.poses) {
    for (let index = 1; index <= pose.frames; index++) {
      write(frameFileName(pose.pose, index), blank);
    }
  }
  write(CUSTOM_ART_REFERENCE, encodePng(buildReferenceImage(sheet)));
  write(CUSTOM_ART_GUIDE, buildGuide(spec));
  return { dir: targetDir, written, skipped, spec };
}
