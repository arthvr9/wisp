import { BrowserWindow } from 'electron';
import type { NativeImage } from 'electron';
import type { Rectangle } from 'electron';
import { join } from 'node:path';

import { MASCOT_SIZE } from './window';

export const PANEL_WIDTH = 320;
export const PANEL_HEIGHT = 420;
const GAP = 8;

export interface Panel {
  readonly win: BrowserWindow;
  show(mascotX: number, mascotY: number, display: Rectangle): void;
  hide(): void;
  isVisible(): boolean;
  toggle(mascotX: number, mascotY: number, display: Rectangle): void;
  capture(): Promise<NativeImage>;
  destroy(): void;
}

function computeBounds(mascotX: number, mascotY: number, display: Rectangle): Rectangle {
  const centred = mascotX + MASCOT_SIZE / 2 - PANEL_WIDTH / 2;
  const x = Math.min(Math.max(centred, display.x), display.x + display.width - PANEL_WIDTH);

  const above = mascotY - PANEL_HEIGHT - GAP;
  const below = mascotY + MASCOT_SIZE + GAP;
  const fitsAbove = above >= display.y;
  const y = Math.min(
    Math.max(fitsAbove ? above : below, display.y),
    display.y + display.height - PANEL_HEIGHT,
  );

  return { x: Math.round(x), y: Math.round(y), width: PANEL_WIDTH, height: PANEL_HEIGHT };
}

// A second window for the same reason as the bubble: the mascot window has no click-through
// on Linux, so growing it to hold the panel would make its transparent area eat clicks.
export function createPanel(): Panel {
  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
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
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(`${devUrl}/panel.html`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/panel.html'));
  }

  let visible = false;

  function show(mascotX: number, mascotY: number, display: Rectangle) {
    win.setBounds(computeBounds(mascotX, mascotY, display));
    if (!visible) {
      visible = true;
      win.showInactive();
    }
  }

  function hide() {
    if (!visible) return;
    visible = false;
    win.hide();
  }

  function toggle(mascotX: number, mascotY: number, display: Rectangle) {
    if (visible) hide();
    else show(mascotX, mascotY, display);
  }

  return {
    win,
    show,
    hide,
    isVisible() {
      return visible;
    },
    toggle,
    capture() {
      return win.webContents.capturePage();
    },
    destroy() {
      win.destroy();
    },
  };
}
