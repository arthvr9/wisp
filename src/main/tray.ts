import { Menu, Tray, nativeImage } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

// GNOME has no tray of its own. The AppIndicator extension provides one through the
// StatusNotifier D-Bus interface, so its presence on the session bus is the test.
export function detectTray(): Promise<boolean> {
  if (process.platform !== 'linux') return Promise.resolve(true);
  return new Promise((resolve) => {
    execFile('busctl', ['--user', '--no-pager', 'list'], { timeout: 3000 }, (err, stdout) => {
      resolve(!err && stdout.includes('org.kde.StatusNotifierWatcher'));
    });
  });
}

export interface TrayHandle {
  update(tooltip: string, items: MenuItemConstructorOptions[]): void;
  destroy(): void;
}

export function createTray(appPath: string): TrayHandle {
  const icon = nativeImage.createFromPath(join(appPath, 'resources', 'icons', 'tray.png'));
  const tray = new Tray(icon);
  return {
    update(tooltip, items) {
      tray.setToolTip(tooltip);
      tray.setContextMenu(Menu.buildFromTemplate(items));
    },
    destroy() {
      tray.destroy();
    },
  };
}
