import type { Signal } from '../../shared/signals';
import type { IcsEvent } from './parse';

const HOUR_MS = 3_600_000;
const DEFAULT_PAST_HOURS = 2;

function toSignal(event: IcsEvent): Signal {
  const partStat = event.partStat;
  // A published calendar often omits PARTSTAT entirely (there is no "me" to respond as), and
  // the user's own calendar only ever lists what they kept, so the absence of a response is
  // treated the same as an explicit acceptance.
  const accepted = partStat === undefined || partStat.toUpperCase() === 'ACCEPTED';
  return {
    id: `calendar:${event.uid}@${event.startMs}`,
    source: 'calendar',
    kind: 'meeting',
    dueAt: event.startMs,
    title: event.summary.trim() === '' ? '(no subject)' : event.summary,
    url: event.url ?? '',
    status: partStat ?? 'unknown',
    listName: 'Calendar',
    meeting: {
      endsAt: event.endMs,
      accepted,
      allDay: event.allDay,
      organizer: event.organizer,
      busy: !event.transparent,
    },
  };
}

export function icsSignals(
  events: readonly IcsEvent[],
  opts: { nowMs: number; pastHours?: number; horizonHours: number },
): Signal[] {
  const pastHours = opts.pastHours ?? DEFAULT_PAST_HOURS;
  const windowStart = opts.nowMs - pastHours * HOUR_MS;
  const windowEnd = opts.nowMs + opts.horizonHours * HOUR_MS;

  const signals: Signal[] = [];
  for (const event of events) {
    if (event.cancelled) continue;
    if (event.startMs >= windowEnd || event.endMs <= windowStart) continue;
    signals.push(toSignal(event));
  }
  return signals;
}
