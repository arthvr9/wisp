import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { frameFileName } from '../../shared/custom-art';
import type { CustomArtError } from '../../shared/custom-art';
import { Canvas, encodePng } from './template';
import { isBlank, readBuiltInSheet, readPng, validateArtDirectory } from './validate';

const SPRITES = fileURLToPath(new URL('../../../resources/sprites', import.meta.url));
const { spec } = readBuiltInSheet(SPRITES);

function drawnPng(width = spec.frameWidth, height = spec.frameHeight): Buffer {
  const canvas = new Canvas(width, height);
  canvas.set(1, 1, [200, 40, 40, 255]);
  return encodePng(canvas);
}

function blankPng(width = spec.frameWidth, height = spec.frameHeight): Buffer {
  return encodePng(new Canvas(width, height));
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, tail]);
}

interface RawPng {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlace?: number;
  palette?: number[];
  transparency?: number[];
  pixels?: Buffer;
}

/** Colour types the encoder in template.ts does not write, so the decoder can be tested on them. */
function rawPng(options: RawPng): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(options.width, 0);
  ihdr.writeUInt32BE(options.height, 4);
  ihdr[8] = options.depth;
  ihdr[9] = options.colorType;
  ihdr[12] = options.interlace ?? 0;
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
  ];
  if (options.palette) parts.push(chunk('PLTE', Buffer.from(options.palette)));
  if (options.transparency) parts.push(chunk('tRNS', Buffer.from(options.transparency)));
  if (options.pixels) parts.push(chunk('IDAT', deflateSync(options.pixels)));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function scanlines(width: number, height: number, channels: number, fill: number[]): Buffer {
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        raw[y * (stride + 1) + 1 + x * channels + c] = fill[c] ?? 0;
      }
    }
  }
  return raw;
}

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wisp-art-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writePose(pose: string, count: number, make: () => Buffer = drawnPng): void {
  for (let index = 1; index <= count; index++) {
    writeFileSync(join(dir, frameFileName(pose, index)), make());
  }
}

function writeEveryPose(make: () => Buffer = drawnPng): void {
  for (const pose of spec.poses) writePose(pose.pose, pose.frames, make);
}

function messages(errors: CustomArtError[]): string[] {
  return errors.map((error) => error.message);
}

describe('readPng bounds', () => {
  it('refuses a file whose pixels inflate far past what its header declares', () => {
    // A 32 by 32 header over an IDAT holding a gigabyte of zeroes. It sits inside every byte cap
    // in this file, because those bound what is read from disk and not what comes out of the
    // decompressor. Without a cap on the output this grew the process by 812 MB.
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(32, 0);
    ihdr.writeUInt32BE(32, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const bomb = rawPng({
      width: 32,
      height: 32,
      depth: 8,
      colorType: 6,
      pixels: Buffer.alloc(64 * 1024 * 1024),
    });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const before = process.memoryUsage().rss;
    const read = readPng(bomb);
    const grew = (process.memoryUsage().rss - before) / 1024 / 1024;
    expect(read?.rgba).toBeNull();
    expect(grew).toBeLessThan(64);
  });
});

describe('the built-in sheet', () => {
  it('is where the frame size and the pose list come from', () => {
    expect(spec.frameWidth).toBe(32);
    expect(spec.frameHeight).toBe(32);
    expect(spec.stridePx).toBe(20);
    expect(spec.poses.map((pose) => `${pose.pose}:${pose.frames}`)).toEqual([
      'idle:8',
      'walk:6',
      'sit:4',
      'sleep:4',
      'alert:4',
      'drag:4',
      'celebrate:5',
      'dance:8',
      'pet:5',
      'startle:5',
    ]);
  });
});

describe('validateArtDirectory', () => {
  it('accepts a folder with every pose drawn', () => {
    writeEveryPose();
    const result = validateArtDirectory(dir, spec);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.poses)).toEqual(spec.poses.map((pose) => pose.pose));
    expect(result.poses.idle).toHaveLength(8);
    expect(result.poses.idle?.map((frame) => frame.file)).toEqual([
      'idle-01.png',
      'idle-02.png',
      'idle-03.png',
      'idle-04.png',
      'idle-05.png',
      'idle-06.png',
      'idle-07.png',
      'idle-08.png',
    ]);
  });

  it('takes the poses that are drawn and leaves the rest to the built-in art', () => {
    writePose('idle', 8);
    writePose('walk', 6);
    const result = validateArtDirectory(dir, spec);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.poses)).toEqual(['idle', 'walk']);
  });

  it('ignores the guide, the reference image and anything else in the folder', () => {
    writePose('idle', 8);
    writeFileSync(join(dir, 'how-to-draw.txt'), 'notes');
    writeFileSync(join(dir, 'reference.png'), drawnPng(820, 892));
    writeFileSync(join(dir, 'my drawing.aseprite'), 'binary');
    const result = validateArtDirectory(dir, spec);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.poses)).toEqual(['idle']);
  });

  it('treats a pose whose frames are all still empty as one the user has not drawn', () => {
    writePose('idle', 8);
    writePose('sit', 4, blankPng);
    const result = validateArtDirectory(dir, spec);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.poses)).toEqual(['idle']);
  });

  it('names the file and the size when a frame is the wrong size', () => {
    writePose('walk', 6);
    writeFileSync(join(dir, 'walk-03.png'), drawnPng(48, 32));
    const result = validateArtDirectory(dir, spec);
    expect(messages(result.errors)).toEqual(['walk-03.png is 48 by 32, it needs to be 32 by 32.']);
    expect(result.errors[0]?.code).toBe('wrong-size');
    expect(result.errors[0]?.file).toBe('walk-03.png');
    expect(result.poses.walk).toBeUndefined();
  });

  it('names the missing files when a pose is half drawn', () => {
    writePose('sit', 2);
    const result = validateArtDirectory(dir, spec);
    expect(messages(result.errors)).toEqual([
      'sit has 2 frames drawn and needs 4, missing sit-03.png and sit-04.png.',
    ]);
    expect(result.errors[0]?.pose).toBe('sit');
  });

  it('counts one drawn frame in the singular', () => {
    writePose('sleep', 1);
    const result = validateArtDirectory(dir, spec);
    expect(messages(result.errors)).toEqual([
      'sleep has 1 frame drawn and needs 4, missing sleep-02.png, sleep-03.png and sleep-04.png.',
    ]);
  });

  it('points at the one empty frame in a pose that is otherwise drawn', () => {
    writePose('sit', 4);
    writeFileSync(join(dir, 'sit-02.png'), blankPng());
    const result = validateArtDirectory(dir, spec);
    expect(messages(result.errors)).toEqual([
      'sit-02.png is empty and the rest of sit is drawn. Draw it, or empty every sit frame to keep the built-in art for that pose.',
    ]);
    expect(result.errors[0]?.code).toBe('blank');
  });

  it('says when a file is not a PNG', () => {
    writePose('drag', 4);
    writeFileSync(join(dir, 'drag-01.png'), 'this is a text file');
    const result = validateArtDirectory(dir, spec);
    expect(messages(result.errors)).toEqual([
      'drag-01.png is not a PNG image. Export it from your editor as a PNG.',
    ]);
  });

  it('says when a file names a pose that does not exist', () => {
    writeFileSync(join(dir, 'sitt-01.png'), drawnPng());
    const result = validateArtDirectory(dir, spec);
    expect(messages(result.errors)).toEqual([
      'sitt-01.png does not name a pose. The poses are idle, walk, sit, sleep, alert, drag, celebrate, dance, pet and startle.',
    ]);
  });

  it('says when a frame number runs past the end of a pose', () => {
    writePose('walk', 6);
    writeFileSync(join(dir, 'walk-07.png'), drawnPng());
    const result = validateArtDirectory(dir, spec);
    expect(messages(result.errors)).toEqual([
      'walk-07.png is past the end of walk, which has 6 frames, walk-01.png to walk-06.png.',
    ]);
  });

  it('says when two files are the same frame', () => {
    writePose('walk', 6);
    writeFileSync(join(dir, 'walk-3.png'), drawnPng());
    const result = validateArtDirectory(dir, spec);
    expect(messages(result.errors)).toEqual([
      'walk-03.png and walk-3.png are both frame 3 of walk. Keep one of them.',
    ]);
  });

  it('refuses a frame that is a link to a file somewhere else', () => {
    writePose('idle', 8);
    const outside = join(dir, '..', `wisp-outside-${process.pid}.png`);
    writeFileSync(outside, drawnPng());
    rmSync(join(dir, 'idle-04.png'));
    symlinkSync(outside, join(dir, 'idle-04.png'));
    const result = validateArtDirectory(dir, spec);
    rmSync(outside, { force: true });
    expect(messages(result.errors)).toContain(
      'idle-04.png is a link to a file somewhere else. Copy the real file into the folder.',
    );
  });

  it('stops on a folder with too many files in it', () => {
    for (let i = 0; i < 12; i++) writeFileSync(join(dir, `file-${i}.txt`), 'x');
    const result = validateArtDirectory(dir, spec, { maxFiles: 10 });
    expect(messages(result.errors)).toEqual([
      'The folder holds 12 files and the limit is 10. Choose the folder that holds the frames and nothing else.',
    ]);
  });

  it('stops on a frame that is far too big to be one', () => {
    writePose('alert', 4);
    writeFileSync(join(dir, 'alert-02.png'), Buffer.concat([drawnPng(), Buffer.alloc(300 * 1024)]));
    const result = validateArtDirectory(dir, spec, { maxFileBytes: 200 * 1024 });
    expect(messages(result.errors)).toEqual([
      'alert-02.png is 300 KB. One frame cannot be larger than 200 KB.',
    ]);
  });

  it('stops once the folder has handed over more bytes than it should', () => {
    writeEveryPose();
    const result = validateArtDirectory(dir, spec, { maxTotalBytes: 200 });
    expect(messages(result.errors)).toEqual([
      'The frames in this folder add up to more than 1 KB. Choose the folder that holds the frames and nothing else.',
    ]);
  });

  it('says the folder holds no frames when it holds no frames', () => {
    writeFileSync(join(dir, 'notes.txt'), 'nothing here');
    const result = validateArtDirectory(dir, spec);
    expect(messages(result.errors)).toEqual([
      'No frames found in this folder. Frames are named like idle-01.png. Export the template first if you have not.',
    ]);
  });

  it('says the template is still blank when nothing has been drawn on it', () => {
    writeEveryPose(blankPng);
    const result = validateArtDirectory(dir, spec);
    expect(messages(result.errors)).toEqual([
      'Every frame in this folder is still empty. Draw at least one pose, then import again.',
    ]);
  });

  it('says so when the folder is gone', () => {
    const missing = join(dir, 'not-here');
    const result = validateArtDirectory(missing, spec);
    expect(result.errors[0]?.code).toBe('no-directory');
    expect(result.errors[0]?.message).toContain('could not be opened');
  });
});

describe('readPng', () => {
  it('rejects bytes that are not a PNG', () => {
    expect(readPng(Buffer.from('not a png at all, not even close'))).toBeNull();
  });

  it('reads a truecolour image with alpha', () => {
    const png = readPng(drawnPng());
    expect(png?.width).toBe(32);
    expect(png?.height).toBe(32);
    expect(png && isBlank(png)).toBe(false);
  });

  it('sees an empty truecolour image', () => {
    const png = readPng(blankPng());
    expect(png && isBlank(png)).toBe(true);
  });

  it('reads greyscale with alpha', () => {
    const empty = readPng(
      rawPng({ width: 4, height: 4, depth: 8, colorType: 4, pixels: scanlines(4, 4, 2, [80, 0]) }),
    );
    expect(empty && isBlank(empty)).toBe(true);
    const drawn = readPng(
      rawPng({
        width: 4,
        height: 4,
        depth: 8,
        colorType: 4,
        pixels: scanlines(4, 4, 2, [80, 255]),
      }),
    );
    expect(drawn && isBlank(drawn)).toBe(false);
  });

  it('reads a palette image and its transparent entries', () => {
    const png = rawPng({
      width: 4,
      height: 4,
      depth: 8,
      colorType: 3,
      palette: [0, 0, 0, 255, 0, 0],
      transparency: [0, 255],
      pixels: scanlines(4, 4, 1, [0]),
    });
    const empty = readPng(png);
    expect(empty && isBlank(empty)).toBe(true);
    const drawn = readPng(
      rawPng({
        width: 4,
        height: 4,
        depth: 8,
        colorType: 3,
        palette: [0, 0, 0, 255, 0, 0],
        transparency: [0, 255],
        pixels: scanlines(4, 4, 1, [1]),
      }),
    );
    expect(drawn && isBlank(drawn)).toBe(false);
  });

  it('measures an image without alpha and calls it drawn', () => {
    const png = readPng(
      rawPng({
        width: 8,
        height: 4,
        depth: 8,
        colorType: 2,
        pixels: scanlines(8, 4, 3, [0, 0, 0]),
      }),
    );
    expect(png?.width).toBe(8);
    expect(png && isBlank(png)).toBe(false);
  });

  it('measures an interlaced image without reading its pixels', () => {
    const png = readPng(rawPng({ width: 32, height: 32, depth: 8, colorType: 6, interlace: 1 }));
    expect(png).toEqual({ width: 32, height: 32, rgba: null });
    expect(png && isBlank(png)).toBe(false);
  });
});
