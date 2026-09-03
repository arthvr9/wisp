import type { Translate } from '../../shared/i18n';
import { DAY_GROUPS } from '../../shared/signals';
import type { DayGroup, DayItem } from '../../shared/signals';

const SOON_MINUTES = 60;

function formatClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Weekday and month names arrive as one space separated string each, so a translation can
// rewrite the whole set in one entry instead of nineteen.
function nameAt(list: string, index: number): string {
  return list.trim().split(/\s+/)[index] ?? '';
}

function formatDate(ms: number, t: Translate): string {
  const d = new Date(ms);
  return t('panel.time.date', {
    day: d.getDate(),
    month: nameAt(t('panel.time.months'), d.getMonth()),
  });
}

// Kept pure (no Date.now(), everything from the item and the translator) so the row time and
// the meeting range can be tested without a rendered component.
export function formatTimeLeft(item: DayItem, t: Translate): string {
  const { signal, minutesLeft, overdue, group } = item;

  if (signal.kind === 'meeting' && signal.meeting) {
    if (signal.meeting.allDay) return t('panel.time.allDay');
    return `${formatClock(signal.dueAt)}-${formatClock(signal.meeting.endsAt)}`;
  }

  if (overdue) {
    const lateMinutes = Math.abs(minutesLeft);
    const lateHours = Math.floor(lateMinutes / 60);
    if (lateHours >= 1) return t('panel.time.late', { hours: lateHours });
    return t('panel.time.lateMinutes', { minutes: lateMinutes });
  }

  // A countdown answers "how long have I got" and stops meaning anything past an hour or so,
  // where a wall clock, a weekday and finally a date each take over in turn.
  if (minutesLeft <= 0) return t('panel.time.now');
  if (minutesLeft < SOON_MINUTES) return t('panel.time.inMinutes', { minutes: minutesLeft });
  if (group === 'today') return formatClock(signal.dueAt);
  if (group === 'later') return formatDate(signal.dueAt, t);
  // A weekday alone loses the half a reader actually needs for something due soon, so a day
  // inside the week carries its time as well.
  const weekday = nameAt(t('panel.time.weekdays'), new Date(signal.dueAt).getDay());
  return `${weekday} ${formatClock(signal.dueAt)}`;
}

export interface DayGroupRows {
  group: DayGroup;
  items: DayItem[];
}

/** Splits an already sorted list into the panel's headings, dropping the empty ones. */
export function groupRows(items: readonly DayItem[]): DayGroupRows[] {
  return DAY_GROUPS.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((section) => section.items.length > 0);
}

/**
 * One line for the header. Late and today are the two counts a person acts on, so the rest of
 * the list is only mentioned when there is nothing pressing left.
 */
export function panelTitle(items: readonly DayItem[], t: Translate): string {
  const late = items.filter((item) => item.group === 'late').length;
  const today = items.filter((item) => item.group === 'today').length;
  if (late > 0 && today > 0) return t('panel.title.lateAndToday', { late, today });
  if (late > 0) return t('panel.title.lateOnly', { late });
  if (today > 0) return t('panel.title', { count: today });
  if (items.length > 0) return t('panel.title.ahead', { count: items.length });
  return t('panel.title.clear');
}
