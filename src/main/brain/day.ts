import type { DayGroup, DayItem, Signal, SignalSource } from '../../shared/signals';

export interface DayOptions {
  nowMs: number;
  /** Local midnight after today, after tomorrow, and after the last day still called a week. */
  endOfDayMs: number;
  endOfTomorrowMs: number;
  endOfWeekMs: number;
  snoozedUntil: (signalId: string) => number | undefined;
  canComplete: (source: SignalSource) => boolean;
}

function isOverdue(signal: Signal, nowMs: number): boolean {
  if (signal.kind === 'meeting') return (signal.meeting?.endsAt ?? Infinity) < nowMs;
  return signal.dueAt < nowMs;
}

// Every open task belongs in the panel, however far out it is due: the list is what the user
// still owes, not what the clock demands right now. A meeting that already ended is simply
// over, unlike an overdue task, which still needs doing. Meetings also stop after tomorrow,
// because a fortnight of them is a calendar and the panel is not one.
function belongsInPanel(signal: Signal, opts: DayOptions): boolean {
  if (signal.closedAt !== undefined) return false;
  if (signal.kind === 'meeting') {
    if (isOverdue(signal, opts.nowMs)) return false;
    return signal.dueAt < opts.endOfTomorrowMs;
  }
  return true;
}

function groupOf(signal: Signal, overdue: boolean, opts: DayOptions): DayGroup {
  if (overdue) return 'late';
  if (signal.dueAt < opts.endOfDayMs) return 'today';
  if (signal.dueAt < opts.endOfTomorrowMs) return 'tomorrow';
  if (signal.dueAt < opts.endOfWeekMs) return 'week';
  return 'later';
}

function toItem(signal: Signal, opts: DayOptions): DayItem {
  const overdue = isOverdue(signal, opts.nowMs);
  const snoozedUntil = opts.snoozedUntil(signal.id);
  return {
    signal,
    minutesLeft: Math.round((signal.dueAt - opts.nowMs) / 60_000),
    overdue,
    group: groupOf(signal, overdue, opts),
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
    .filter((s) => belongsInPanel(s, opts))
    .map((s) => toItem(s, opts))
    .sort(byUrgency);
}
