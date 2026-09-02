import { BrowserWindow, nativeImage } from 'electron';
import { join } from 'node:path';

let current: BrowserWindow | undefined;

export function openSettings(appPath: string): BrowserWindow {
  if (current && !current.isDestroyed()) {
    current.show();
    current.focus();
    return current;
  }
  const win = new BrowserWindow({
    width: 420,
    height: 600,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'Wisp settings',
    icon: nativeImage.createFromPath(join(appPath, 'resources', 'icons', 'wisp-256.png')),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
    },
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(`${devUrl}/settings.html`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/settings.html'));
  }
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
