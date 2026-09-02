import { app, screen } from 'electron';
import type { BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';

export interface EnvironmentReport {
  sessionType: string;
  electron: string;
  chrome: string;
  node: string;
  ozoneRequested: string;
  ozoneEffective: 'x11' | 'wayland' | 'unknown';
  displays: string[];
}

export function describeEnvironment(win: BrowserWindow): EnvironmentReport {
  return {
    sessionType: process.env.XDG_SESSION_TYPE ?? '(unset)',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    ozoneRequested: app.commandLine.getSwitchValue('ozone-platform') || '(default)',
    ozoneEffective: detectOzone(win),
    displays: screen
      .getAllDisplays()
      .map(
        (d) =>
          `#${d.id} ${d.bounds.width}x${d.bounds.height}@${d.bounds.x},${d.bounds.y} scale=${d.scaleFactor}` +
          ` work=${d.workArea.width}x${d.workArea.height}@${d.workArea.x},${d.workArea.y}`,
      ),
  };
}

// An X11 window has an XID that xprop can query. A native Wayland surface has no such id,
// so a successful xprop call is the only cheap proof that we really ended up on XWayland.
function detectOzone(win: BrowserWindow): EnvironmentReport['ozoneEffective'] {
  if (process.platform !== 'linux') return 'unknown';
  try {
    const handle = win.getNativeWindowHandle();
    const xid = handle.readUInt32LE(0);
    if (xid === 0) return 'wayland';
    const out = execFileSync('xprop', ['-id', String(xid), 'WM_CLASS'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    return out.includes('WM_CLASS') ? 'x11' : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function formatEnvironment(report: EnvironmentReport): string {
  return [
    `session type      ${report.sessionType}`,
    `electron          ${report.electron} (chrome ${report.chrome}, node ${report.node})`,
    `ozone requested   ${report.ozoneRequested}`,
    `ozone effective   ${report.ozoneEffective}`,
    ...report.displays.map((d) => `display           ${d}`),
  ].join('\n');
}
