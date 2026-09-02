import { execFile } from 'node:child_process';

import type { SilenceWindow } from '../shared/nudges';

const POLL_MS = 30_000;
const WINDOW_MS = 60_000;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => {
      resolve(err ? '' : stdout);
    });
  });
}

// GNOME's own Do Not Disturb toggle lives in this gsettings key. Reading it every 30 s is
// the cheapest reliable signal we have from a Wayland session.
async function doNotDisturb(): Promise<boolean> {
  const out = await run('gsettings', ['get', 'org.gnome.desktop.notifications', 'show-banners']);
  return out.trim() === 'false';
}

// Only X11 windows are visible from XWayland, so a fullscreen Wayland app goes unnoticed.
async function activeX11Fullscreen(): Promise<boolean> {
  const active = await run('xprop', ['-root', '_NET_ACTIVE_WINDOW']);
  const id = /window id # (0x[0-9a-f]+)/i.exec(active)?.[1];
  if (!id || id === '0x0') return false;
  const state = await run('xprop', ['-id', id, '_NET_WM_STATE']);
  return state.includes('_NET_WM_STATE_FULLSCREEN');
}

export class SilenceSources {
  private dnd = false;
  private fullscreen = false;
  private snoozeUntil = 0;
  private timer: NodeJS.Timeout | undefined;

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  snooze(untilMs: number): void {
    this.snoozeUntil = untilMs;
  }

  unsnooze(): void {
    this.snoozeUntil = 0;
  }

  snoozedUntil(nowMs: number): number | undefined {
    return this.snoozeUntil > nowMs ? this.snoozeUntil : undefined;
  }

  windows(nowMs: number): SilenceWindow[] {
    const out: SilenceWindow[] = [];
    if (this.dnd) {
      out.push({
        from: nowMs,
        to: nowMs + WINDOW_MS,
        source: 'do-not-disturb',
        allowUrgent: false,
      });
    }
    if (this.fullscreen) {
      out.push({ from: nowMs, to: nowMs + WINDOW_MS, source: 'fullscreen', allowUrgent: true });
    }
    const snooze = this.snoozedUntil(nowMs);
    if (snooze !== undefined) {
      out.push({ from: nowMs, to: snooze, source: 'snooze', allowUrgent: false });
    }
    return out;
  }

  private async poll(): Promise<void> {
    if (process.platform !== 'linux') return;
    const [dnd, fullscreen] = await Promise.all([doNotDisturb(), activeX11Fullscreen()]);
    this.dnd = dnd;
    this.fullscreen = fullscreen;
  }
}
