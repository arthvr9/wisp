import { loadPage } from './load';
import type { Theme } from './load';
import { BrowserWindow } from 'electron';
import type { Rectangle } from 'electron';
import { join } from 'node:path';

export const MASCOT_SIZE = 96;
const CORNER = 8;

export type ShapeResult = 'applied' | 'failed' | 'unavailable';

export interface Stage {
  readonly win: BrowserWindow;
  moveTo(x: number, y: number): void;
  bounds(): Rectangle;
  cutCorners(): ShapeResult;
}

export function createStage(x: number, y: number, theme: Theme): Stage {
  const win = new BrowserWindow({
    x,
    y,
    width: MASCOT_SIZE,
    height: MASCOT_SIZE,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
    },
  });
  win.setMenu(null);

  win.setAlwaysOnTop(true);

  loadPage(win, 'index.html', theme);

  win.once('ready-to-show', () => {
    win.showInactive();
  });

  return {
    win,
    moveTo(nx, ny) {
      win.setBounds({ x: nx, y: ny, width: MASCOT_SIZE, height: MASCOT_SIZE });
    },
    bounds() {
      return win.getBounds();
    },
    cutCorners() {
      if (typeof win.setShape !== 'function') return 'unavailable';
      try {
        win.setShape(cornerlessSquare(MASCOT_SIZE, CORNER));
        return 'applied';
      } catch {
        return 'failed';
      }
    },
  };
}

function cornerlessSquare(size: number, corner: number): Rectangle[] {
  return [
    { x: corner, y: 0, width: size - 2 * corner, height: corner },
    { x: 0, y: corner, width: size, height: size - 2 * corner },
    { x: corner, y: size - corner, width: size - 2 * corner, height: corner },
  ];
}
