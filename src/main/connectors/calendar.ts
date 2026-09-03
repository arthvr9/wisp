import { expandRecurrences, fetchIcsText, icsSignals, parseIcs } from '../ics';
import type { CalendarConfig } from '../../shared/config';
import type { Signal } from '../../shared/signals';
import type { Connector } from './types';

// A meeting is only ever a same-day concern, so a day of lookahead is plenty. Two hours of
// lookback keeps a meeting visible for a little while after it starts, in case Wisp was
// asleep or the app just launched.
const HORIZON_HOURS = 24;
const PAST_HOURS = 2;
const HOUR_MS = 3_600_000;

export interface CalendarConnectorOptions {
  config: () => CalendarConfig;
  fetchFn?: typeof fetch;
}

export function createCalendarConnector(opts: CalendarConnectorOptions): Connector {
  async function download(): Promise<string> {
    const url = opts.config().icsUrl.trim();
    if (url === '') {
      throw new Error('the calendar link is not set');
    }
    return fetchIcsText(url, opts.fetchFn);
  }

  return {
    source: 'calendar',

    hasCredentials(): boolean {
      return opts.config().icsUrl.trim() !== '';
    },

    async connect(): Promise<void> {
      // There is no interactive authorization for a plain published link, so a fetch is the
      // only way to confirm the URL actually points at a calendar.
      await download();
    },

    disconnect(): Promise<void> {
      return Promise.resolve();
    },

    async fetch(nowMs: number): Promise<Signal[]> {
      const text = await download();
      const events = parseIcs(text);
      const expanded = expandRecurrences(events, {
        fromMs: nowMs - PAST_HOURS * HOUR_MS,
        toMs: nowMs + HORIZON_HOURS * HOUR_MS,
      });
      return icsSignals(expanded, { nowMs, pastHours: PAST_HOURS, horizonHours: HORIZON_HOURS });
    },

    close(): void {
      // No connection is held between syncs, so there is nothing to close.
    },
  };
}
