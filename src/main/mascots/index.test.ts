import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { frameFileName } from '../../shared/custom-art';
import { Canvas, encodePng } from './template';

// The entry point is the only file here that reaches for Electron, so the module is mocked
// rather than pulling in real Electron for a unit test.
let userDataDir = '';
const appDir = fileURLToPath(new URL('../../..', import.meta.url));
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, getAppPath: () => appDir },
}));

const {
  checkCustomArtFolder,
  customMascotsRoot,
  deleteCustomMascot,
  exportCustomArtTemplate,
  importCustomMascot,
  listCustomMascots,
  loadCustomMascot,
} = await import('./index');

let source = '';

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'wisp-userdata-'));
  source = join(userDataDir, 'drawing');
  mkdirSync(source, { recursive: true });
});

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
});

function draw(pose: string, count: number): void {
  for (let index = 1; index <= count; index++) {
    const canvas = new Canvas(32, 32);
    canvas.set(index, 1, [200, 40, 40, 255]);
    writeFileSync(join(source, frameFileName(pose, index)), encodePng(canvas));
  }
}

describe('the mascots entry point', () => {
  it('keeps custom mascots beside the rest of the user data', () => {
    expect(customMascotsRoot()).toBe(join(userDataDir, 'mascots'));
  });

  it('exports a template, checks it, imports it and loads it back', () => {
    exportCustomArtTemplate(source);
    expect(checkCustomArtFolder(source).map((error) => error.code)).toEqual(['nothing-drawn']);

    draw('idle', 8);
    expect(checkCustomArtFolder(source)).toEqual([]);

    const result = importCustomMascot(source, 'Test Slime');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(listCustomMascots().map((mascot) => mascot.slug)).toEqual(['test-slime']);
    expect(loadCustomMascot('test-slime')?.frames.idle).toHaveLength(8);
    expect(deleteCustomMascot('test-slime')).toBe(true);
    expect(listCustomMascots()).toEqual([]);
  });
});
