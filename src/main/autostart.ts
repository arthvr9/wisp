import { app } from 'electron';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { MascotName } from '../shared/mascots';

export function autostartPath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'autostart', 'wisp.desktop');
}

export function isAutostartEnabled(): boolean {
  return existsSync(autostartPath());
}

export function setAutostart(enabled: boolean, mascot: MascotName = 'wisp'): void {
  const path = autostartPath();
  if (!enabled) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, desktopEntry(mascot));
}

function desktopEntry(mascot: MascotName): string {
  // Unpackaged runs need the app path and the sandbox flag, a packaged binary does not.
  const parts = app.isPackaged
    ? [process.execPath, '--ozone-platform=x11']
    : [process.execPath, app.getAppPath(), '--ozone-platform=x11', '--no-sandbox'];
  const exec = parts.map(quote).join(' ');
  const icon = join(app.getAppPath(), 'resources', 'icons', mascot, 'icon-256.png');
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Wisp',
    'Comment=Desktop mascot',
    `Exec=${exec}`,
    `Icon=${icon}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

function quote(s: string): string {
  return /[\s"\\]/.test(s) ? `"${s.replace(/(["\\])/g, '\\$1')}"` : s;
}
