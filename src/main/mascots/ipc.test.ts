import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { frameFileName } from '../../shared/custom-art';
import type { CustomMascotSummary } from '../../shared/custom-art';
import { translator } from '../../shared/i18n';
import { IPC } from '../../shared/ipc';
import { Canvas, encodePng } from './template';
import type { MascotStore } from './ipc';

// Only the entry point these handlers sit on reaches for Electron, so the module is mocked
// rather than pulling in real Electron for a unit test.
interface FakeEvent {
  sender: { id: number };
}
type Handler = (event: FakeEvent, ...args: unknown[]) => unknown;

const handlers = new Map<string, Handler>();
let userDataDir = '';
let dialogResult: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] };
const appDir = fileURLToPath(new URL('../../..', import.meta.url));

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir, getAppPath: () => appDir },
  ipcMain: {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener);
    },
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: () => Promise.resolve(dialogResult) },
}));

const { registerMascotIpc } = await import('./ipc');

const t = () => translator('en', { name: 'Wisp' });
const event: FakeEvent = { sender: { id: 1 } };

let source = '';
let picked: string | null = null;

const SPEC = { frameWidth: 32, frameHeight: 32, groundRow: 28, stridePx: 13, poses: [] };

function call(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}.`);
  return handler(event, ...args);
}

function draw(pose: string, count: number): void {
  for (let index = 1; index <= count; index++) {
    const canvas = new Canvas(32, 32);
    canvas.set(index, 1, [200, 40, 40, 255]);
    writeFileSync(join(source, frameFileName(pose, index)), encodePng(canvas));
  }
}

beforeEach(() => {
  handlers.clear();
  userDataDir = mkdtempSync(join(tmpdir(), 'wisp-userdata-'));
  source = join(userDataDir, 'Blue Slime');
  mkdirSync(source, { recursive: true });
  picked = source;
  dialogResult = { canceled: true, filePaths: [] };
  registerMascotIpc({
    t,
    pick: () => Promise.resolve(picked),
  });
});

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true });
});

async function importDrawing(name?: string): Promise<CustomMascotSummary> {
  draw('idle', 8);
  const result = await call(IPC.customArtImport, name);
  if (result === null || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
    throw new Error('The drawing did not import.');
  }
  return (result as { ok: true; mascot: CustomMascotSummary }).mascot;
}

describe('registerMascotIpc', () => {
  it('registers every custom art channel', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        IPC.customArtCheck,
        IPC.customArtExport,
        IPC.customArtImport,
        IPC.customMascotDelete,
        IPC.customMascotList,
        IPC.customMascotLoad,
      ].sort(),
    );
  });

  it('writes the template into the picked folder and reports how many files it wrote', async () => {
    const result = await call(IPC.customArtExport);
    expect(result).toMatchObject({ dir: source });
    expect((result as { count: number }).count).toBeGreaterThan(10);
    expect(existsSync(join(source, 'how-to-draw.txt'))).toBe(true);
  });

  it('writes nothing when the picker is closed', async () => {
    picked = null;
    expect(await call(IPC.customArtExport)).toBeNull();
    expect(await call(IPC.customArtCheck)).toBeNull();
    expect(await call(IPC.customArtImport, 'Slime')).toBeNull();
    expect(existsSync(join(source, 'how-to-draw.txt'))).toBe(false);
  });

  it('reads the picker through the dialog when none is injected', async () => {
    registerMascotIpc({ t });
    dialogResult = { canceled: true, filePaths: [] };
    expect(await call(IPC.customArtExport)).toBeNull();
    dialogResult = { canceled: false, filePaths: [source] };
    expect(await call(IPC.customArtExport)).toMatchObject({ dir: source });
  });

  it('checks a folder without importing it', async () => {
    await call(IPC.customArtExport);
    const result = await call(IPC.customArtCheck);
    expect(result).toMatchObject({ dir: source });
    expect((result as { errors: { code: string }[] }).errors.map((e) => e.code)).toEqual([
      'nothing-drawn',
    ]);
    expect(await call(IPC.customMascotList)).toEqual([]);
  });

  it('names an import after the folder when the renderer sends no name', async () => {
    const mascot = await importDrawing();
    expect(mascot.name).toBe('Blue Slime');
    expect(mascot.slug).toBe('blue-slime');
    expect(mascot.poses).toEqual(['idle']);
  });

  it('cuts a name from the renderer to the length a config name is cut to', async () => {
    const mascot = await importDrawing('  ' + 'o'.repeat(60) + '  ');
    expect(mascot.name).toBe('o'.repeat(24));
  });

  it('lists, loads and deletes an imported mascot', async () => {
    const mascot = await importDrawing();
    expect(await call(IPC.customMascotList)).toHaveLength(1);
    const loaded = await call(IPC.customMascotLoad, mascot.slug);
    expect((loaded as { frames: Record<string, string[]> }).frames.idle).toHaveLength(8);
    expect(await call(IPC.customMascotDelete, mascot.slug)).toEqual([]);
    expect(existsSync(join(userDataDir, 'mascots', mascot.slug))).toBe(false);
  });

  it('leaves the mascots folder alone when the slug is not one of ours', async () => {
    const mascot = await importDrawing();
    const outside = join(userDataDir, 'secrets');
    mkdirSync(outside);
    writeFileSync(join(userDataDir, 'config.json'), '{}');

    for (const slug of [
      '..',
      '../..',
      '../secrets',
      'mascots/../../secrets',
      '/etc',
      './blue-slime',
      'blue-slime/../../secrets',
      '',
      42,
      null,
      { slug: 'blue-slime' },
    ]) {
      expect(await call(IPC.customMascotLoad, slug)).toBeNull();
      expect(await call(IPC.customMascotDelete, slug)).toHaveLength(1);
    }

    expect(existsSync(outside)).toBe(true);
    expect(existsSync(join(userDataDir, 'config.json'))).toBe(true);
    expect(existsSync(join(userDataDir, 'mascots', mascot.slug))).toBe(true);
  });

  it('never reaches the store with a slug it did not accept', async () => {
    const calls: string[] = [];
    const store: MascotStore = {
      exportTemplate: () => ({ dir: '', written: [], skipped: [], spec: SPEC }),
      check: () => [],
      import: () => ({ ok: false, errors: [] }),
      list: () => [],
      load: (slug) => {
        calls.push(`load ${slug}`);
        return null;
      },
      remove: (slug) => {
        calls.push(`remove ${slug}`);
        return false;
      },
    };
    registerMascotIpc({ t, store, pick: () => Promise.resolve(picked) });
    await call(IPC.customMascotLoad, '../../etc');
    await call(IPC.customMascotDelete, '../../etc');
    expect(calls).toEqual([]);
    await call(IPC.customMascotLoad, 'blue-slime');
    expect(calls).toEqual(['load blue-slime']);
  });
});
