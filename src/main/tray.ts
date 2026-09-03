import { Menu, Tray, nativeImage } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Mood } from '../shared/mood';

// GNOME has no tray of its own. The AppIndicator extension provides one through the
// StatusNotifier D-Bus interface, so its presence on the session bus is the test.
export function detectTray(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('busctl', ['--user', '--no-pager', 'list'], { timeout: 3000 }, (err, stdout) => {
      resolve(!err && stdout.includes('org.kde.StatusNotifierWatcher'));
    });
  });
}

export interface TrayHandle {
  update(tooltip: string, items: MenuItemConstructorOptions[]): void;
  setMood(mood: Mood | 'neutral'): void;
  destroy(): void;
}

function iconFor(appPath: string, mood: Mood | 'neutral'): string {
  const dir = join(appPath, 'resources', 'icons');
  const specific = join(dir, `tray-${mood}.png`);
  return mood !== 'neutral' && existsSync(specific) ? specific : join(dir, 'tray.png');
}

export function createTray(appPath: string): TrayHandle {
  const tray = new Tray(nativeImage.createFromPath(iconFor(appPath, 'neutral')));
  let current: Mood | 'neutral' = 'neutral';
  return {
    update(tooltip, items) {
      tray.setToolTip(tooltip);
      tray.setContextMenu(Menu.buildFromTemplate(items));
    },
    setMood(mood) {
      if (mood === current) return;
      current = mood;
      tray.setImage(nativeImage.createFromPath(iconFor(appPath, mood)));
    },
    destroy() {
      tray.destroy();
    },
  };
}
