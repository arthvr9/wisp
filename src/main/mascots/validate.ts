import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import {
  GROUND_ROW,
  POSE_ORDER,
  frameFileName,
  isPose,
  parseFrameFileName,
} from '../../shared/custom-art';
import type { CustomArtError, CustomArtSpec } from '../../shared/custom-art';
import type { Pose } from '../../shared/actor';

// The picker hands us a directory the user chose, so every read below is bounded. A folder of
// 32 by 32 frames is roughly forty files of a few kilobytes each; anything past these numbers
// is a wrong folder, not a big mascot.
export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
// The largest decompressed image this reads. A frame is 32 by 32 and the built-in sheet is
// 256 by 352, so the real numbers are kilobytes; this leaves room for a sheet many times larger
// while staying far below anything that would hurt.
export const MAX_PIXEL_BYTES = 32 * 1024 * 1024;

export interface ValidateOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface DrawnFrame {
  pose: Pose;
  index: number;
  file: string;
  bytes: Uint8Array;
}

interface ReadFrame extends DrawnFrame {
  blank: boolean;
}

export interface ValidateResult {
  errors: CustomArtError[];
  /** Only poses that are completely drawn and free of errors. */
  poses: Partial<Record<Pose, DrawnFrame[]>>;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngRead {
  width: number;
  height: number;
  /** Null when the pixels could not be read, which leaves the size the only thing checked. */
  rgba: Uint8Array | null;
}

interface Header {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlace: number;
}

function readHeader(data: Uint8Array): Header {
  const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return {
    width: view.readUInt32BE(0),
    height: view.readUInt32BE(4),
    depth: view[8] ?? 0,
    colorType: view[9] ?? 0,
    interlace: view[12] ?? 0,
  };
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function unfilter(raw: Uint8Array, height: number, stride: number, bpp: number): Uint8Array {
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const from = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? (out[y * stride + x - bpp] ?? 0) : 0;
      const up = y > 0 ? (out[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= bpp && y > 0 ? (out[(y - 1) * stride + x - bpp] ?? 0) : 0;
      let value = raw[from + x] ?? 0;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const dLeft = Math.abs(estimate - left);
        const dUp = Math.abs(estimate - up);
        const dUpLeft = Math.abs(estimate - upLeft);
        value += dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      }
      out[y * stride + x] = value & 0xff;
    }
  }
  return out;
}

function sampleAt(line: Uint8Array, offset: number, index: number, depth: number): number {
  if (depth === 8) return line[offset + index] ?? 0;
  if (depth === 16) return line[offset + index * 2] ?? 0;
  const perByte = 8 / depth;
  const byte = line[offset + Math.floor(index / perByte)] ?? 0;
  const shift = 8 - depth * ((index % perByte) + 1);
  const max = (1 << depth) - 1;
  return ((byte >> shift) & max) * Math.floor(255 / max);
}

function toRgba(
  pixels: Uint8Array,
  header: Header,
  stride: number,
  palette: Uint8Array | null,
  transparency: Uint8Array | null,
): Uint8Array {
  const { width, height, depth, colorType } = header;
  const channels = CHANNELS[colorType] ?? 4;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const offset = y * stride;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      const read = (channel: number): number =>
        sampleAt(pixels, offset, x * channels + channel, depth);
      if (colorType === 3) {
        const index = sampleAt(pixels, offset, x, depth) / Math.floor(255 / ((1 << depth) - 1));
        const base = index * 3;
        rgba[out] = palette?.[base] ?? 0;
        rgba[out + 1] = palette?.[base + 1] ?? 0;
        rgba[out + 2] = palette?.[base + 2] ?? 0;
        rgba[out + 3] = transparency?.[index] ?? 255;
        continue;
      }
      if (colorType === 0 || colorType === 4) {
        const grey = read(0);
        rgba[out] = grey;
        rgba[out + 1] = grey;
        rgba[out + 2] = grey;
        rgba[out + 3] = colorType === 4 ? read(1) : 255;
        continue;
      }
      rgba[out] = read(0);
      rgba[out + 1] = read(1);
      rgba[out + 2] = read(2);
      rgba[out + 3] = colorType === 6 ? read(3) : 255;
    }
  }
  return rgba;
}

/**
 * Reads a PNG far enough to know its size and whether anything is drawn on it. Returns null
 * when the bytes are not a PNG at all.
 */
export function readPng(bytes: Uint8Array): PngRead | null {
  if (bytes.length < 8 + 25) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let header: Header | null = null;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (at + 8 <= view.length) {
    const length = view.readUInt32BE(at);
    const type = view.toString('ascii', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = readHeader(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!header || header.width <= 0 || header.height <= 0) return null;
  const { width, height, depth, colorType, interlace } = header;
  const channels = CHANNELS[colorType];
  // An interlaced PNG still reports its size, so only the blank check is skipped for one. No
  // editor writes interlaced by default and rebuilding an Adam7 image to answer one question
  // is not worth the code.
  if (channels === undefined || interlace !== 0 || idat.length === 0) {
    return { width, height, rgba: null };
  }
  const stride = Math.ceil((width * channels * depth) / 8);
  const declared = height * (stride + 1);
  // The header says how many bytes the pixels take, but the header is written by whoever made
  // the file, so on its own it is a cap the attacker chooses: declaring 65535 by 65535 asks for
  // 17 GB and binds nothing. The absolute limit is what actually holds, and the declared size
  // only tightens it. Both are needed: the file size caps elsewhere bound what is read from
  // disk, not what comes out of the decompressor.
  //
  // Nothing is decompressed at all for a size no sprite sheet could have. The size still comes
  // back, so a frame that is the wrong size is still reported as the wrong size rather than as
  // a broken file.
  if (declared > MAX_PIXEL_BYTES) return { width, height, rgba: null };
  try {
    const raw = inflateSync(Buffer.concat(idat.map((part) => Buffer.from(part))), {
      maxOutputLength: Math.min(declared, MAX_PIXEL_BYTES),
    });
    if (raw.length < height * (stride + 1)) return { width, height, rgba: null };
    const bpp = Math.max(1, Math.ceil((channels * depth) / 8));
    const pixels = unfilter(raw, height, stride, bpp);
    return { width, height, rgba: toRgba(pixels, header, stride, palette, transparency) };
  } catch {
    return { width, height, rgba: null };
  }
}

export function isBlank(read: PngRead): boolean {
  const { rgba } = read;
  if (!rgba) return false;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 0) return false;
  }
  return true;
}

interface SheetTag {
  name: string;
  from: number;
  to: number;
}

interface SheetFrame {
  frame: { x: number; y: number; w: number; h: number };
  sourceSize?: { w: number; h: number };
  duration: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readTags(meta: Record<string, unknown>): SheetTag[] {
  const raw = Array.isArray(meta.frameTags) ? meta.frameTags : [];
  const tags: SheetTag[] = [];
  for (const entry of raw) {
    const tag = asRecord(entry);
    if (!tag) continue;
    const { name, from, to } = tag;
    if (typeof name !== 'string' || typeof from !== 'number' || typeof to !== 'number') continue;
    tags.push({ name, from, to });
  }
  return tags;
}

function readFrames(json: Record<string, unknown>): SheetFrame[] {
  const frames = asRecord(json.frames);
  if (!frames) return [];
  const out: SheetFrame[] = [];
  for (const entry of Object.values(frames)) {
    const frame = asRecord(entry);
    const rect = asRecord(frame?.frame);
    if (!frame || !rect) continue;
    const source = asRecord(frame.sourceSize);
    out.push({
      frame: {
        x: Number(rect.x),
        y: Number(rect.y),
        w: Number(rect.w),
        h: Number(rect.h),
      },
      sourceSize: source ? { w: Number(source.w), h: Number(source.h) } : undefined,
      duration: typeof frame.duration === 'number' ? frame.duration : 100,
    });
  }
  return out;
}

export interface BuiltInSheet {
  spec: CustomArtSpec;
  /** Frame rectangles of the built-in sheet, by pose, for the reference image. */
  rects: Partial<Record<Pose, { x: number; y: number; w: number; h: number }[]>>;
  imagePath: string;
}

/**
 * The frame size, the pose list and the frame counts a drawing has to match, read off the
 * built-in sheet rather than repeated here. The sheet is the only thing that knows them.
 */
export function readBuiltInSheet(spritesDir: string, mascot = 'wisp'): BuiltInSheet {
  const parsed: unknown = JSON.parse(readFileSync(join(spritesDir, `${mascot}.json`), 'utf8'));
  const json = asRecord(parsed);
  const meta = asRecord(json?.meta);
  if (!json || !meta) throw new Error(`Sprite sheet ${mascot}.json is not readable.`);
  const frames = readFrames(json);
  const first = frames[0];
  if (!first) throw new Error(`Sprite sheet ${mascot}.json has no frames.`);
  const stride = asRecord(meta.wisp)?.stridePx;
  const poses: CustomArtSpec['poses'] = [];
  const rects: Partial<Record<Pose, { x: number; y: number; w: number; h: number }[]>> = {};
  for (const tag of readTags(meta)) {
    if (!isPose(tag.name)) continue;
    const own = frames.slice(tag.from, tag.to + 1);
    if (own.length === 0) continue;
    poses.push({
      pose: tag.name,
      frames: own.length,
      durationMs: own[0]?.duration ?? 100,
    });
    rects[tag.name] = own.map((frame) => frame.frame);
  }
  return {
    spec: {
      frameWidth: first.sourceSize?.w ?? first.frame.w,
      frameHeight: first.sourceSize?.h ?? first.frame.h,
      groundRow: GROUND_ROW,
      stridePx: typeof stride === 'number' && stride > 0 ? stride : 0,
      poses,
    },
    rects,
    imagePath: join(spritesDir, `${mascot}.png`),
  };
}

function describeBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

interface Candidate {
  pose: Pose;
  index: number;
  file: string;
}

export function validateArtDirectory(
  dir: string,
  spec: CustomArtSpec,
  options: ValidateOptions = {},
): ValidateResult {
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const errors: CustomArtError[] = [];
  const poseSpec = new Map(spec.poses.map((entry) => [entry.pose, entry]));
  const size = `${spec.frameWidth} by ${spec.frameHeight}`;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return {
      errors: [
        {
          code: 'no-directory',
          message: `The folder ${dir} could not be opened. It may have been moved or deleted.`,
        },
      ],
      poses: {},
    };
  }
  if (entries.length > maxFiles) {
    return {
      errors: [
        {
          code: 'too-many-files',
          message: `The folder holds ${entries.length} files and the limit is ${maxFiles}. Choose the folder that holds the frames and nothing else.`,
        },
      ],
      poses: {},
    };
  }

  const candidates: Candidate[] = [];
  const seen = new Map<string, string>();
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const parsed = parseFrameFileName(entry.name);
    if (!parsed) continue;
    // A link can point anywhere on the disk, including outside the folder the user picked, so
    // it is refused rather than followed.
    if (entry.isSymbolicLink()) {
      errors.push({
        code: 'symlink',
        file: entry.name,
        message: `${entry.name} is a link to a file somewhere else. Copy the real file into the folder.`,
      });
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isPose(parsed.pose)) {
      errors.push({
        code: 'unknown-frame',
        file: entry.name,
        message: `${entry.name} does not name a pose. The poses are ${listOf([...POSE_ORDER])}.`,
      });
      continue;
    }
    const pose = parsed.pose;
    const wanted = poseSpec.get(pose);
    if (!wanted) continue;
    if (parsed.index > wanted.frames) {
      errors.push({
        code: 'unknown-frame',
        file: entry.name,
        pose,
        message: `${entry.name} is past the end of ${pose}, which has ${wanted.frames} frames, ${frameFileName(pose, 1)} to ${frameFileName(pose, wanted.frames)}.`,
      });
      continue;
    }
    const key = `${pose}-${parsed.index}`;
    const other = seen.get(key);
    if (other !== undefined) {
      errors.push({
        code: 'duplicate-frame',
        file: entry.name,
        pose,
        message: `${other} and ${entry.name} are both frame ${parsed.index} of ${pose}. Keep one of them.`,
      });
      continue;
    }
    seen.set(key, entry.name);
    candidates.push({ pose, index: parsed.index, file: entry.name });
  }

  const drawn: Partial<Record<Pose, ReadFrame[]>> = {};
  const broken = new Set<Pose>();
  let total = 0;
  let overBudget = false;
  for (const candidate of candidates) {
    const path = join(dir, candidate.file);
    let bytes: Uint8Array;
    try {
      const stat = statSync(path);
      if (stat.size > maxFileBytes) {
        errors.push({
          code: 'too-large',
          file: candidate.file,
          pose: candidate.pose,
          message: `${candidate.file} is ${describeBytes(stat.size)}. One frame cannot be larger than ${describeBytes(maxFileBytes)}.`,
        });
        broken.add(candidate.pose);
        continue;
      }
      total += stat.size;
      if (total > maxTotalBytes) {
        overBudget = true;
        break;
      }
      bytes = readFileSync(path);
    } catch {
      errors.push({
        code: 'unreadable',
        file: candidate.file,
        pose: candidate.pose,
        message: `${candidate.file} could not be read.`,
      });
      broken.add(candidate.pose);
      continue;
    }
    const png = readPng(bytes);
    if (!png) {
      errors.push({
        code: 'not-a-png',
        file: candidate.file,
        pose: candidate.pose,
        message: `${candidate.file} is not a PNG image. Export it from your editor as a PNG.`,
      });
      broken.add(candidate.pose);
      continue;
    }
    if (png.width !== spec.frameWidth || png.height !== spec.frameHeight) {
      errors.push({
        code: 'wrong-size',
        file: candidate.file,
        pose: candidate.pose,
        message: `${candidate.file} is ${png.width} by ${png.height}, it needs to be ${size}.`,
      });
      broken.add(candidate.pose);
      continue;
    }
    const frames = drawn[candidate.pose] ?? [];
    frames.push({
      pose: candidate.pose,
      index: candidate.index,
      file: candidate.file,
      bytes,
      blank: isBlank(png),
    });
    drawn[candidate.pose] = frames;
  }

  if (overBudget) {
    return {
      errors: [
        {
          code: 'folder-too-large',
          message: `The frames in this folder add up to more than ${describeBytes(maxTotalBytes)}. Choose the folder that holds the frames and nothing else.`,
        },
      ],
      poses: {},
    };
  }

  const complete: Partial<Record<Pose, DrawnFrame[]>> = {};
  let blankOnly = false;
  for (const entry of spec.poses) {
    const frames = drawn[entry.pose];
    if (!frames || frames.length === 0) continue;
    const blanks = frames.filter((frame) => frame.blank);
    // The template ships every frame blank, so a pose whose frames are all still empty is one
    // the user has not drawn yet, not a mistake. A pose with only some frames empty is.
    if (blanks.length === frames.length) {
      blankOnly = true;
      continue;
    }
    if (broken.has(entry.pose)) continue;
    if (blanks.length > 0) {
      for (const frame of blanks) {
        errors.push({
          code: 'blank',
          file: frame.file,
          pose: entry.pose,
          message: `${frame.file} is empty and the rest of ${entry.pose} is drawn. Draw it, or empty every ${entry.pose} frame to keep the built-in art for that pose.`,
        });
      }
      continue;
    }
    if (frames.length < entry.frames) {
      const have = new Set(frames.map((frame) => frame.index));
      const missing: string[] = [];
      for (let i = 1; i <= entry.frames; i++) {
        if (!have.has(i)) missing.push(frameFileName(entry.pose, i));
      }
      errors.push({
        code: 'partial-pose',
        pose: entry.pose,
        message: `${entry.pose} has ${frames.length} ${frames.length === 1 ? 'frame' : 'frames'} drawn and needs ${entry.frames}, missing ${listOf(missing)}.`,
      });
      continue;
    }
    complete[entry.pose] = [...frames].sort((a, b) => a.index - b.index);
  }

  if (Object.keys(complete).length === 0 && errors.length === 0) {
    return {
      errors: [
        {
          code: 'nothing-drawn',
          message: blankOnly
            ? 'Every frame in this folder is still empty. Draw at least one pose, then import again.'
            : `No frames found in this folder. Frames are named like ${frameFileName('idle', 1)}. Export the template first if you have not.`,
        },
      ],
      poses: {},
    };
  }

  return { errors, poses: complete };
}
