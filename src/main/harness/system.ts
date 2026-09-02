import { readdirSync, readFileSync } from 'node:fs';

// Electron's getAppMetrics only sees our own processes. The compositor and XWayland do the
// actual moving and repainting, so their CPU is part of the real cost. Linux only, which
// matches the target.
const WATCHED = ['gnome-shell', 'Xwayland'];
const CLOCK_TICKS = 100;

interface Reading {
  ticks: number;
  atMs: number;
}

export interface SystemSample {
  name: string;
  pid: number;
  cpuPercent: number;
}

export class SystemSampler {
  private readonly last = new Map<number, Reading>();

  sample(): SystemSample[] {
    if (process.platform !== 'linux') return [];
    const now = performance.now();
    const out: SystemSample[] = [];
    for (const pid of listPids()) {
      const name = commOf(pid);
      if (name === undefined || !WATCHED.includes(name)) continue;
      const ticks = cpuTicks(pid);
      if (ticks === undefined) continue;
      const prev = this.last.get(pid);
      this.last.set(pid, { ticks, atMs: now });
      if (!prev) continue;
      const elapsedS = (now - prev.atMs) / 1000;
      const cpuPercent = ((ticks - prev.ticks) / CLOCK_TICKS / elapsedS) * 100;
      out.push({ name, pid, cpuPercent });
    }
    return out;
  }
}

function listPids(): number[] {
  try {
    return readdirSync('/proc')
      .filter((entry) => /^\d+$/.test(entry))
      .map(Number);
  } catch {
    return [];
  }
}

function commOf(pid: number): string | undefined {
  try {
    return readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
  } catch {
    return undefined;
  }
}

// /proc/<pid>/stat: fields 14 and 15 are utime and stime, after the parenthesised comm.
function cpuTicks(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const utime = Number(rest[11]);
    const stime = Number(rest[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return undefined;
    return utime + stime;
  } catch {
    return undefined;
  }
}
