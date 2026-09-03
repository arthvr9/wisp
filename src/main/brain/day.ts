import type { DayItem, Signal, SignalSource } from '../../shared/signals';

export interface DayOptions {
  nowMs: number;
  endOfDayMs: number;
  snoozedUntil: (signalId: string) => number | undefined;
  canComplete: (source: SignalSource) => boolean;
}

function isOverdue(signal: Signal, nowMs: number): boolean {
  if (signal.kind === 'meeting') return (signal.meeting?.endsAt ?? Infinity) < nowMs;
  return signal.dueAt < nowMs;
}

// A meeting that already ended is simply over, unlike an overdue task, which still needs
// doing. So a meeting only earns its place by starting before the end of day, never by having
// finished in the past.
function belongsInDay(signal: Signal, opts: DayOptions): boolean {
  if (signal.closedAt !== undefined) return false;
  if (signal.kind === 'meeting') {
    if (isOverdue(signal, opts.nowMs)) return false;
    return signal.dueAt < opts.endOfDayMs;
  }
  return isOverdue(signal, opts.nowMs) || signal.dueAt < opts.endOfDayMs;
}

function toItem(signal: Signal, opts: DayOptions): DayItem {
  const overdue = isOverdue(signal, opts.nowMs);
  const snoozedUntil = opts.snoozedUntil(signal.id);
  return {
    signal,
    minutesLeft: Math.round((signal.dueAt - opts.nowMs) / 60_000),
    overdue,
    ...(snoozedUntil === undefined ? {} : { snoozedUntil }),
    actions: { complete: signal.kind === 'task-due' && opts.canComplete(signal.source) },
  };
}

function byUrgency(a: DayItem, b: DayItem): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  return a.signal.dueAt - b.signal.dueAt;
}

export function dayItems(signals: readonly Signal[], opts: DayOptions): DayItem[] {
  return signals
    .filter((s) => belongsInDay(s, opts))
    .map((s) => toItem(s, opts))
    .sort(byUrgency);
}
