import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CUSTOM_ART_GUIDE, CUSTOM_ART_REFERENCE } from '../../shared/custom-art';
import { buildGuide, buildReferenceImage, encodePng, exportTemplate } from './template';
import { isBlank, readBuiltInSheet, readPng, validateArtDirectory } from './validate';

const SPRITES = fileURLToPath(new URL('../../../resources/sprites', import.meta.url));
const sheet = readBuiltInSheet(SPRITES);
const { spec } = sheet;

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wisp-template-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('exportTemplate', () => {
  it('writes one frame per pose, the reference image and the guide', () => {
    const result = exportTemplate(join(dir, 'my-mascot'), SPRITES);
    const frames = spec.poses.reduce((sum, pose) => sum + pose.frames, 0);
    expect(result.written).toHaveLength(frames + 2);
    expect(result.skipped).toEqual([]);
    const files = readdirSync(result.dir).sort();
    expect(files).toContain('idle-01.png');
    expect(files).toContain('idle-08.png');
    expect(files).toContain('walk-06.png');
    expect(files).toContain('celebrate-05.png');
    expect(files).toContain(CUSTOM_ART_REFERENCE);
    expect(files).toContain(CUSTOM_ART_GUIDE);
    expect(files).not.toContain('idle-09.png');
  });

  it('writes frames at the size the renderer expects, with nothing on them', () => {
    exportTemplate(dir, SPRITES);
    const png = readPng(readFileSync(join(dir, 'walk-01.png')));
    expect(png?.width).toBe(spec.frameWidth);
    expect(png?.height).toBe(spec.frameHeight);
    expect(png && isBlank(png)).toBe(true);
  });

  it('leaves a drawing that is already there alone', () => {
    exportTemplate(dir, SPRITES);
    const drawing = readFileSync(join(dir, 'idle-01.png'));
    writeFileSync(join(dir, 'idle-01.png'), Buffer.concat([drawing, Buffer.from('mine')]));
    const again = exportTemplate(dir, SPRITES);
    expect(again.written).toEqual([]);
    expect(again.skipped).toContain('idle-01.png');
    expect(readFileSync(join(dir, 'idle-01.png')).subarray(-4).toString()).toBe('mine');
  });

  it('produces a folder the importer reads back as drawn on nothing yet', () => {
    exportTemplate(dir, SPRITES);
    const result = validateArtDirectory(dir, spec);
    expect(result.errors.map((error) => error.message)).toEqual([
      'Every frame in this folder is still empty. Draw at least one pose, then import again.',
    ]);
  });
});

describe('the reference image', () => {
  it('is a PNG with the built-in frames drawn on it', () => {
    const png = readPng(encodePng(buildReferenceImage(sheet)));
    expect(png).not.toBeNull();
    expect(png && isBlank(png)).toBe(false);
    const columns = Math.max(...spec.poses.map((pose) => pose.frames));
    expect(png?.width).toBeGreaterThanOrEqual(columns * spec.frameWidth);
    expect(png?.height).toBeGreaterThanOrEqual(spec.poses.length * spec.frameHeight);
  });
});

describe('the guide', () => {
  const guide = buildGuide(spec);

  it('says how big a frame is and where the ground is', () => {
    expect(guide).toContain('32 by 32 pixel PNG with a transparent background');
    expect(guide).toContain(`The ground is row ${spec.groundRow}`);
  });

  it('says that an undrawn pose falls back to the built-in art', () => {
    expect(guide).toContain('falls back to the built-in art');
  });

  it('names every pose, its frame count and its file names', () => {
    for (const pose of spec.poses) {
      expect(guide).toContain(`${pose.pose}, ${pose.frames} frames,`);
      expect(guide).toContain(`${pose.pose}-01.png`);
    }
    expect(guide).toContain('One full walk cycle, facing right.');
  });

  it('reads the way the rest of the project reads', () => {
    expect(guide).not.toMatch(/[—–!]/);
  });
});
