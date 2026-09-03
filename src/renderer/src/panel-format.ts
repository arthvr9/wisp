import type { Translate } from '../../shared/i18n';
import type { DayItem } from '../../shared/signals';

const SOON_MINUTES = 60;

function formatClock(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Kept pure (no Date.now(), everything from the item and the translator) so the row time and
// the meeting range can be tested without a rendered component.
export function formatTimeLeft(item: DayItem, t: Translate): string {
  const { signal, minutesLeft, overdue } = item;

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

  if (minutesLeft <= 0) return t('panel.time.now');
  if (minutesLeft < SOON_MINUTES) return t('panel.time.inMinutes', { minutes: minutesLeft });
  return formatClock(signal.dueAt);
}
