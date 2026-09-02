import { BrowserWindow } from 'electron';
import type { NativeImage } from 'electron';
import { join } from 'node:path';

import { IPC } from '../../shared/ipc';
import type { BubbleMessage } from '../../shared/ipc';
import { MASCOT_SIZE } from './window';

export const BUBBLE_WIDTH = 240;
export const BUBBLE_HEIGHT = 76;
const GAP = 4;

export interface Bubble {
  show(message: BubbleMessage): void;
  hide(): void;
  follow(mascotX: number, mascotY: number, displayLeft: number, displayRight: number): void;
  isVisible(): boolean;
  capture(): Promise<NativeImage>;
  destroy(): void;
}

// The bubble is its own window because the mascot window has no click-through on Linux, so
// enlarging it to hold a bubble would make its transparent area swallow clicks.
export function createBubble(): Bubble {
  const win = new BrowserWindow({
    width: BUBBLE_WIDTH,
    height: BUBBLE_HEIGHT,
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
    void win.loadURL(`${devUrl}/bubble.html`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/bubble.html'));
  }

  let visible = false;
  return {
    show(message) {
      win.webContents.send(IPC.bubble, message);
      if (!visible) {
        visible = true;
        win.showInactive();
      }
    },
    hide() {
      if (!visible) return;
      visible = false;
      win.webContents.send(IPC.bubble, null);
      win.hide();
    },
    follow(mascotX, mascotY, displayLeft, displayRight) {
      if (!visible) return;
      const centred = mascotX + MASCOT_SIZE / 2 - BUBBLE_WIDTH / 2;
      const x = Math.min(Math.max(centred, displayLeft), displayRight - BUBBLE_WIDTH);
      const y = mascotY - BUBBLE_HEIGHT - GAP;
      win.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: BUBBLE_WIDTH,
        height: BUBBLE_HEIGHT,
      });
    },
    isVisible() {
      return visible;
    },
    capture() {
      return win.webContents.capturePage();
    },
    destroy() {
      win.destroy();
    },
  };
}
