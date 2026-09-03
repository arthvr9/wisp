import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { expandRecurrences } from './expand';
import type { IcsEvent } from './parse';

function baseEvent(over: Partial<IcsEvent>): IcsEvent {
  return {
    uid: 'e@example.com',
    summary: 'Meeting',
    startMs: new Date(2026, 8, 2, 13, 0, 0).getTime(),
    endMs: new Date(2026, 8, 2, 14, 0, 0).getTime(),
    allDay: false,
    cancelled: false,
    transparent: false,
    organizer: '',
    exceptions: [],
    ...over,
  };
}

describe('expandRecurrences', () => {
  it('passes a non-recurring event through unchanged when it overlaps the window', () => {
    const event = baseEvent({});
    const result = expandRecurrences([event], {
      fromMs: new Date(2026, 8, 1).getTime(),
      toMs: new Date(2026, 8, 3).getTime(),
    });
    expect(result).toEqual([event]);
  });

  it('drops a non-recurring event entirely outside the window', () => {
    const event = baseEvent({});
    const result = expandRecurrences([event], {
      fromMs: new Date(2026, 9, 1).getTime(),
      toMs: new Date(2026, 9, 3).getTime(),
    });
    expect(result).toEqual([]);
  });

  it('keeps an event that started before the window but is still running', () => {
    const event = baseEvent({
      startMs: new Date(2026, 8, 2, 13, 0, 0).getTime(),
      endMs: new Date(2026, 8, 2, 15, 0, 0).getTime(),
    });
    const result = expandRecurrences([event], {
      fromMs: new Date(2026, 8, 2, 14, 0, 0).getTime(),
      toMs: new Date(2026, 8, 2, 16, 0, 0).getTime(),
    });
    expect(result).toEqual([event]);
  });

  it('expands FREQ=DAILY with an interval and a count', () => {
    const event = baseEvent({ recurrenceRule: 'FREQ=DAILY;INTERVAL=2;COUNT=3' });
    const result = expandRecurrences([event], {
      fromMs: new Date(2026, 8, 1).getTime(),
      toMs: new Date(2026, 8, 30).getTime(),
    });
    expect(result.map((e) => e.startMs)).toEqual([
      new Date(2026, 8, 2, 13, 0, 0).getTime(),
      new Date(2026, 8, 4, 13, 0, 0).getTime(),
      new Date(2026, 8, 6, 13, 0, 0).getTime(),
    ]);
  });

  it('stops a DAILY rule at UNTIL', () => {
    const event = baseEvent({
      recurrenceRule: `FREQ=DAILY;UNTIL=${formatUntil(new Date(2026, 8, 4, 13, 0, 0))}`,
    });
    const result = expandRecurrences([event], {
      fromMs: new Date(2026, 8, 1).getTime(),
      toMs: new Date(2026, 8, 30).getTime(),
    });
    expect(result).toHaveLength(3);
    expect(result[2]?.startMs).toBe(new Date(2026, 8, 4, 13, 0, 0).getTime());
  });

  it('expands FREQ=WEEKLY with BYDAY in chronological order', () => {
    // 2026-09-02 is a Wednesday.
    const event = baseEvent({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' });
    const result = expandRecurrences([event], {
      fromMs: new Date(2026, 8, 1).getTime(),
      toMs: new Date(2026, 8, 12).getTime(),
    });
    expect(result.map((e) => new Date(e.startMs).toDateString())).toEqual([
      new Date(2026, 8, 2).toDateString(),
      new Date(2026, 8, 4).toDateString(),
      new Date(2026, 8, 7).toDateString(),
      new Date(2026, 8, 9).toDateString(),
      new Date(2026, 8, 11).toDateString(),
    ]);
  });

  it('expands FREQ=MONTHLY on the same day of month', () => {
    const event = baseEvent({ recurrenceRule: 'FREQ=MONTHLY;COUNT=3' });
    const result = expandRecurrences([event], {
      fromMs: new Date(2026, 8, 1).getTime(),
      toMs: new Date(2026, 11, 31).getTime(),
    });
    expect(result.map((e) => e.startMs)).toEqual([
      new Date(2026, 8, 2, 13, 0, 0).getTime(),
      new Date(2026, 9, 2, 13, 0, 0).getTime(),
      new Date(2026, 10, 2, 13, 0, 0).getTime(),
    ]);
  });

  it('keeps the master as a single occurrence for an unsupported RRULE', () => {
    const event = baseEvent({ recurrenceRule: 'FREQ=YEARLY' });
    const result = expandRecurrences([event], {
      fromMs: new Date(2026, 8, 1).getTime(),
      toMs: new Date(2026, 8, 30).getTime(),
    });
    expect(result).toEqual([event]);
  });

  it('keeps the master as a single occurrence for a BYDAY on a non-weekly rule', () => {
    const event = baseEvent({ recurrenceRule: 'FREQ=DAILY;BYDAY=MO' });
    const result = expandRecurrences([event], {
      fromMs: new Date(2026, 8, 1).getTime(),
      toMs: new Date(2026, 8, 30).getTime(),
    });
    expect(result).toEqual([event]);
  });

  it('drops occurrences listed in EXDATE', () => {
    const event = baseEvent({
      recurrenceRule: 'FREQ=DAILY;COUNT=3',
      exceptions: [new Date(2026, 8, 3, 13, 0, 0).getTime()],
    });
    const result = expandRecurrences([event], {
      fromMs: new Date(2026, 8, 1).getTime(),
      toMs: new Date(2026, 8, 30).getTime(),
    });
    expect(result.map((e) => e.startMs)).toEqual([
      new Date(2026, 8, 2, 13, 0, 0).getTime(),
      new Date(2026, 8, 4, 13, 0, 0).getTime(),
    ]);
  });

  it('lets a RECURRENCE-ID override replace the occurrence it targets', () => {
    const originalSecondStart = new Date(2026, 8, 3, 13, 0, 0).getTime();
    const master = baseEvent({ recurrenceRule: 'FREQ=DAILY;COUNT=3' });
    const override = baseEvent({
      summary: 'Moved to the afternoon',
      startMs: new Date(2026, 8, 3, 16, 0, 0).getTime(),
      endMs: new Date(2026, 8, 3, 17, 0, 0).getTime(),
      recurrenceId: originalSecondStart,
    });
    const result = expandRecurrences([master, override], {
      fromMs: new Date(2026, 8, 1).getTime(),
      toMs: new Date(2026, 8, 30).getTime(),
    });
    expect(result.map((e) => ({ start: e.startMs, summary: e.summary }))).toEqual([
      { start: new Date(2026, 8, 2, 13, 0, 0).getTime(), summary: 'Meeting' },
      { start: new Date(2026, 8, 3, 16, 0, 0).getTime(), summary: 'Moved to the afternoon' },
      { start: new Date(2026, 8, 4, 13, 0, 0).getTime(), summary: 'Meeting' },
    ]);
  });

  it('includes a rescheduled override even when its original slot falls outside the window', () => {
    const master = baseEvent({ recurrenceRule: 'FREQ=DAILY;COUNT=3' });
    const override = baseEvent({
      summary: 'Rescheduled into range',
      startMs: new Date(2026, 8, 20, 16, 0, 0).getTime(),
      endMs: new Date(2026, 8, 20, 17, 0, 0).getTime(),
      recurrenceId: new Date(2026, 8, 3, 13, 0, 0).getTime(),
    });
    const result = expandRecurrences([master, override], {
      fromMs: new Date(2026, 8, 15).getTime(),
      toMs: new Date(2026, 8, 25).getTime(),
    });
    expect(result).toEqual([override]);
  });

  it('caps generation at maxPerRule regardless of window size', () => {
    const event = baseEvent({ recurrenceRule: 'FREQ=DAILY' });
    const result = expandRecurrences([event], {
      fromMs: new Date(2026, 8, 1).getTime(),
      toMs: new Date(2030, 0, 1).getTime(),
      maxPerRule: 5,
    });
    expect(result).toHaveLength(5);
  });

  describe('across a daylight saving change', () => {
    const originalTz = process.env.TZ;

    beforeEach(() => {
      process.env.TZ = 'America/Sao_Paulo';
    });

    afterEach(() => {
      process.env.TZ = originalTz;
    });

    it('keeps the same local wall clock hour, even though the UTC offset moves', () => {
      // Sao Paulo moved its clocks forward on 2017-10-15. A Saturday 20:00 weekly meeting
      // starting two weeks before that date should still read 20:00 local two weeks after it.
      const master = baseEvent({
        startMs: new Date(2017, 9, 7, 20, 0, 0).getTime(),
        endMs: new Date(2017, 9, 7, 21, 0, 0).getTime(),
        recurrenceRule: 'FREQ=WEEKLY',
      });
      const result = expandRecurrences([master], {
        fromMs: new Date(2017, 9, 1).getTime(),
        toMs: new Date(2017, 10, 1).getTime(),
      });
      expect(result.map((e) => new Date(e.startMs).getHours())).toEqual([20, 20, 20, 20]);
      const offsets = result.map((e) => new Date(e.startMs).getTimezoneOffset());
      expect(offsets).toEqual([180, 180, 120, 120]);
    });
  });
});

function formatUntil(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

describe('a monthly rule anchored on a day some months lack', () => {
  it('skips those months instead of rolling into the next one', () => {
    const master: IcsEvent = {
      uid: 'monthly-31',
      summary: 'End of month',
      startMs: new Date(2026, 0, 31, 9, 0, 0).getTime(),
      endMs: new Date(2026, 0, 31, 10, 0, 0).getTime(),
      allDay: false,
      cancelled: false,
      transparent: false,
      organizer: '',
      exceptions: [],
      recurrenceRule: 'FREQ=MONTHLY',
    };
    const out = expandRecurrences([master], {
      fromMs: new Date(2026, 0, 1).getTime(),
      toMs: new Date(2026, 5, 1).getTime(),
    });
    const days = out.map((e) => {
      const d = new Date(e.startMs);
      return `${d.getMonth() + 1}-${d.getDate()}`;
    });
    expect(days).toEqual(['1-31', '3-31', '5-31']);
  });
});
