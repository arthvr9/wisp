import type { QuietHours, SilenceWindow, Urgency } from '../../shared/nudges';

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

export function localDayStart(nowMs: number, tzOffsetMinutes: number): number {
  const local = nowMs - tzOffsetMinutes * MINUTE_MS;
  return Math.floor(local / DAY_MS) * DAY_MS + tzOffsetMinutes * MINUTE_MS;
}

function parseClock(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

export type TzOffsetAt = (atMs: number) => number;

const systemOffset: TzOffsetAt = (atMs) => new Date(atMs).getTimezoneOffset();

/**
 * The offset is read per day rather than once, because the day a clock change falls on has a
 * different offset from the day around it and a fixed one puts that night's window an hour off.
 */
export function quietHoursWindows(
  quiet: QuietHours,
  nowMs: number,
  tzOffset: number | TzOffsetAt = systemOffset,
): SilenceWindow[] {
  if (!quiet.enabled) return [];
  const start = parseClock(quiet.start);
  const end = parseClock(quiet.end);
  if (start === undefined || end === undefined || start === end) return [];

  const offsetAt: TzOffsetAt = typeof tzOffset === 'number' ? () => tzOffset : tzOffset;
  const spanMinutes = end > start ? end - start : end - start + 24 * 60;
  return [-1, 0, 1].map((day) => {
    const around = nowMs + day * DAY_MS;
    const from = localDayStart(around, offsetAt(around)) + start * MINUTE_MS;
    return { from, to: from + spanMinutes * MINUTE_MS, source: 'quiet-hours', allowUrgent: true };
  });
}

export function snoozeWindow(untilMs: number, nowMs: number): SilenceWindow | undefined {
  if (untilMs <= nowMs) return undefined;
  return { from: nowMs, to: untilMs, source: 'snooze', allowUrgent: false };
}

export function activeSilence(
  windows: SilenceWindow[],
  nowMs: number,
  urgency: Urgency,
): SilenceWindow | undefined {
  return windows.find(
    (w) => w.from <= nowMs && nowMs < w.to && !(w.allowUrgent && urgency === 'urgent'),
  );
}
