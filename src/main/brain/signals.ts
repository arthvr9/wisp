import type { Signal } from '../../shared/signals';

export type AnnouncementKind = 'due-soon' | 'due-now' | 'overdue';

export interface Announcement {
  signal: Signal;
  kind: AnnouncementKind;
  minutesLeft: number;
}

const dueNowWindowMs = 60_000;
const maxAnnouncements = 3;

function kindFor(delta: number, dueSoonMs: number): AnnouncementKind | undefined {
  if (delta > 0 && delta <= dueSoonMs) return 'due-soon';
  if (delta > -dueNowWindowMs && delta <= 0) return 'due-now';
  if (delta <= -dueNowWindowMs) return 'overdue';
  return undefined;
}

export function dueAnnouncements(
  signals: Signal[],
  nowMs: number,
  opts: { dueSoonMs: number; announced: (id: string, kind: string) => boolean },
): Announcement[] {
  const out: Announcement[] = [];
  for (const signal of signals) {
    const delta = signal.dueAt - nowMs;
    const kind = kindFor(delta, opts.dueSoonMs);
    if (kind === undefined || opts.announced(signal.id, kind)) continue;
    const minutesLeft = Math.round(delta / 60_000);
    out.push({ signal, kind, minutesLeft: minutesLeft === 0 ? 0 : minutesLeft });
  }
  out.sort((a, b) => a.signal.dueAt - b.signal.dueAt);
  return out.slice(0, maxAnnouncements);
}
