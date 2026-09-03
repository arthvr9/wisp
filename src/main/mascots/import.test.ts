import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CUSTOM_ART_MANIFEST, frameFileName, slugForMascotName } from '../../shared/custom-art';
import {
  customMascotExists,
  deleteCustomMascot,
  importMascotFolder,
  listCustomMascots,
  loadCustomMascot,
} from './import';
import { Canvas, encodePng } from './template';
import { readBuiltInSheet } from './validate';

const SPRITES = fileURLToPath(new URL('../../../resources/sprites', import.meta.url));
const { spec } = readBuiltInSheet(SPRITES);

let root = '';
let source = '';

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'wisp-import-'));
  root = join(base, 'mascots');
  source = join(base, 'drawing');
  mkdirSync(source, { recursive: true });
});

afterEach(() => {
  rmSync(join(root, '..'), { recursive: true, force: true });
});

function frame(tone: number): Buffer {
  const canvas = new Canvas(spec.frameWidth, spec.frameHeight);
  canvas.set(1, 1, [tone, 40, 40, 255]);
  return encodePng(canvas);
}

function draw(pose: string, count: number): void {
  for (let index = 1; index <= count; index++) {
    writeFileSync(join(source, frameFileName(pose, index)), frame(100 + index));
  }
}

function drawIdleAndWalk(): void {
  draw('idle', 8);
  draw('walk', 6);
}

function importAs(name: string) {
  return importMascotFolder({ sourceDir: source, name, root, spritesDir: SPRITES });
}

describe('importMascotFolder', () => {
  it('stores the poses that are drawn and says which ones they are', () => {
    drawIdleAndWalk();
    const result = importAs('My Slime');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mascot.slug).toBe('my-slime');
    expect(result.mascot.name).toBe('My Slime');
    expect(result.mascot.poses).toEqual(['idle', 'walk']);
    expect(result.mascot.frameWidth).toBe(32);
    expect(result.mascot.stridePx).toBe(spec.stridePx);
    expect(existsSync(join(root, 'my-slime', 'idle-08.png'))).toBe(true);
    expect(existsSync(join(root, 'my-slime', 'sit-01.png'))).toBe(false);
    expect(existsSync(join(root, 'my-slime', CUSTOM_ART_MANIFEST))).toBe(true);
  });

  it('returns the errors and writes nothing when a frame is wrong', () => {
    drawIdleAndWalk();
    writeFileSync(join(source, 'walk-03.png'), encodePng(new Canvas(48, 32)));
    const result = importAs('Broken');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.message)).toEqual([
      'walk-03.png is 48 by 32, it needs to be 32 by 32.',
    ]);
    expect(existsSync(join(root, 'broken'))).toBe(false);
  });

  it('gives the second mascot of the same name a folder of its own', () => {
    drawIdleAndWalk();
    const first = importAs('Cat');
    const second = importAs('Cat');
    expect(first.ok && first.mascot.slug).toBe('cat');
    expect(second.ok && second.mascot.slug).toBe('cat-2');
    expect(listCustomMascots(root).map((mascot) => mascot.slug)).toEqual(['cat', 'cat-2']);
    expect(listCustomMascots(root).map((mascot) => mascot.name)).toEqual(['Cat', 'Cat']);
  });

  it('turns a name with path characters into a plain folder name', () => {
    drawIdleAndWalk();
    const result = importAs('../../etc/passwd');
    expect(result.ok && result.mascot.slug).toBe('etc-passwd');
    expect(existsSync(join(root, 'etc-passwd', CUSTOM_ART_MANIFEST))).toBe(true);
  });

  it('keeps accents and punctuation out of the folder name and in the display name', () => {
    drawIdleAndWalk();
    const result = importAs('  Café da Manhã  ');
    expect(result.ok && result.mascot.slug).toBe('cafe-da-manha');
    expect(result.ok && result.mascot.name).toBe('Café da Manhã');
  });

  it('falls back to a folder name when the name has nothing usable in it', () => {
    drawIdleAndWalk();
    const result = importAs('???');
    expect(result.ok && result.mascot.slug).toBe('mascot');
  });
});

describe('slugForMascotName', () => {
  it('keeps a slug short, lowercase and free of path separators', () => {
    expect(slugForMascotName('A'.repeat(80))).toHaveLength(32);
    expect(slugForMascotName('/../..')).toBe('mascot');
    expect(slugForMascotName('Wisp 2: The Return')).toBe('wisp-2-the-return');
  });
});

describe('loadCustomMascot', () => {
  it('hands back one data URL per frame of every drawn pose', () => {
    drawIdleAndWalk();
    importAs('Slime');
    const mascot = loadCustomMascot(root, 'slime');
    expect(mascot?.poses).toEqual(['idle', 'walk']);
    expect(mascot?.frames.idle).toHaveLength(8);
    expect(mascot?.frames.walk).toHaveLength(6);
    expect(mascot?.frames.sit).toBeUndefined();
    expect(mascot?.frames.idle?.[0]).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    const bytes = Buffer.from((mascot?.frames.idle?.[0] ?? '').split(',')[1] ?? '', 'base64');
    expect(bytes.equals(readFileSync(join(root, 'slime', 'idle-01.png')))).toBe(true);
  });

  it('is null for a mascot the user deleted behind the app', () => {
    drawIdleAndWalk();
    importAs('Slime');
    rmSync(join(root, 'slime'), { recursive: true, force: true });
    expect(loadCustomMascot(root, 'slime')).toBeNull();
    expect(customMascotExists(root, 'slime')).toBe(false);
    expect(listCustomMascots(root)).toEqual([]);
  });

  it('drops a pose that lost a frame instead of animating a gap', () => {
    drawIdleAndWalk();
    importAs('Slime');
    rmSync(join(root, 'slime', 'walk-04.png'));
    const mascot = loadCustomMascot(root, 'slime');
    expect(mascot?.poses).toEqual(['idle']);
    expect(mascot?.frames.walk).toBeUndefined();
  });

  it('refuses a slug that is not one', () => {
    expect(loadCustomMascot(root, '../../../etc')).toBeNull();
    expect(loadCustomMascot(root, 'Slime')).toBeNull();
    expect(deleteCustomMascot(root, '..')).toBe(false);
  });

  it('is null when the mascots directory does not exist at all', () => {
    expect(loadCustomMascot(root, 'slime')).toBeNull();
    expect(listCustomMascots(root)).toEqual([]);
  });
});

describe('listCustomMascots', () => {
  it('skips a folder that has no manifest', () => {
    drawIdleAndWalk();
    importAs('Slime');
    mkdirSync(join(root, 'half-written'), { recursive: true });
    writeFileSync(join(root, 'half-written', 'idle-01.png'), frame(10));
    writeFileSync(join(root, 'notes.txt'), 'not a mascot');
    expect(listCustomMascots(root).map((mascot) => mascot.slug)).toEqual(['slime']);
  });
});

describe('deleteCustomMascot', () => {
  it('removes the folder and says whether there was one', () => {
    drawIdleAndWalk();
    importAs('Slime');
    expect(deleteCustomMascot(root, 'slime')).toBe(true);
    expect(existsSync(join(root, 'slime'))).toBe(false);
    expect(deleteCustomMascot(root, 'slime')).toBe(false);
  });
});
