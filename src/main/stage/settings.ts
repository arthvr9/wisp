import { loadPage } from './load';
import type { Theme } from './load';
import { BrowserWindow, nativeImage } from 'electron';
import { join } from 'node:path';

import type { MascotName } from '../../shared/mascots';

let current: BrowserWindow | undefined;

export function openSettings(
  appPath: string,
  theme: Theme,
  mascot: MascotName = 'wisp',
): BrowserWindow {
  if (current && !current.isDestroyed()) {
    current.show();
    current.focus();
    return current;
  }
  const win = new BrowserWindow({
    width: 420,
    height: 720,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'Wisp settings',
    icon: nativeImage.createFromPath(join(appPath, 'resources', 'icons', mascot, 'icon-256.png')),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
    },
  });
  loadPage(win, 'settings.html', theme);
  win.once('ready-to-show', () => {
    win.show();
  });
  win.on('closed', () => {
    if (current === win) current = undefined;
  });
  current = win;
  return win;
}

export function closeSettings(): void {
  if (current && !current.isDestroyed()) current.close();
}
