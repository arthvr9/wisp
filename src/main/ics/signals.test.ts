import { describe, expect, it } from 'vitest';

import { icsSignals } from './signals';
import type { IcsEvent } from './parse';

const now = new Date(2026, 8, 2, 12, 0, 0).getTime();

function event(over: Partial<IcsEvent>): IcsEvent {
  return {
    uid: 'a@example.com',
    summary: 'Sync',
    startMs: new Date(2026, 8, 2, 13, 0, 0).getTime(),
    endMs: new Date(2026, 8, 2, 14, 0, 0).getTime(),
    allDay: false,
    cancelled: false,
    transparent: false,
    organizer: 'alice@example.com',
    exceptions: [],
    ...over,
  };
}

describe('icsSignals', () => {
  it('maps the common fields of a meeting', () => {
    const [signal] = icsSignals([event({})], { nowMs: now, horizonHours: 24 });
    expect(signal).toEqual({
      id: `calendar:a@example.com@${event({}).startMs}`,
      source: 'calendar',
      kind: 'meeting',
      dueAt: event({}).startMs,
      title: 'Sync',
      url: '',
      status: 'unknown',
      listName: 'Calendar',
      meeting: {
        endsAt: event({}).endMs,
        accepted: true,
        allDay: false,
        organizer: 'alice@example.com',
        busy: true,
      },
    });
  });

  it('skips a cancelled event', () => {
    const signals = icsSignals([event({ cancelled: true })], { nowMs: now, horizonHours: 24 });
    expect(signals).toEqual([]);
  });

  it('keeps a declined event with accepted: false', () => {
    const [signal] = icsSignals([event({ partStat: 'DECLINED' })], {
      nowMs: now,
      horizonHours: 24,
    });
    expect(signal?.status).toBe('DECLINED');
    expect(signal?.meeting?.accepted).toBe(false);
  });

  it('treats NEEDS-ACTION as not accepted', () => {
    const [signal] = icsSignals([event({ partStat: 'NEEDS-ACTION' })], {
      nowMs: now,
      horizonHours: 24,
    });
    expect(signal?.meeting?.accepted).toBe(false);
  });

  it('treats a missing PARTSTAT as accepted', () => {
    const [signal] = icsSignals([event({ partStat: undefined })], { nowMs: now, horizonHours: 24 });
    expect(signal?.meeting?.accepted).toBe(true);
    expect(signal?.status).toBe('unknown');
  });

  it('treats an explicit ACCEPTED as accepted', () => {
    const [signal] = icsSignals([event({ partStat: 'ACCEPTED' })], {
      nowMs: now,
      horizonHours: 24,
    });
    expect(signal?.meeting?.accepted).toBe(true);
  });

  it('falls back to a placeholder title for an empty summary', () => {
    const [signal] = icsSignals([event({ summary: '' })], { nowMs: now, horizonHours: 24 });
    expect(signal?.title).toBe('(no subject)');
  });

  it('uses the event URL when present, and an empty string otherwise', () => {
    const [withUrl] = icsSignals([event({ url: 'https://example.com/e' })], {
      nowMs: now,
      horizonHours: 24,
    });
    expect(withUrl?.url).toBe('https://example.com/e');
    const [withoutUrl] = icsSignals([event({})], { nowMs: now, horizonHours: 24 });
    expect(withoutUrl?.url).toBe('');
  });

  it('marks a transparent event as not busy', () => {
    const [signal] = icsSignals([event({ transparent: true })], { nowMs: now, horizonHours: 24 });
    expect(signal?.meeting?.busy).toBe(false);
  });

  it('keeps an all-day event flagged as such', () => {
    const [signal] = icsSignals([event({ allDay: true })], { nowMs: now, horizonHours: 24 });
    expect(signal?.meeting?.allDay).toBe(true);
  });

  it('gives an expanded occurrence its own id keyed by start time', () => {
    const occurrence = event({ startMs: new Date(2026, 8, 9, 13, 0, 0).getTime() });
    const [signal] = icsSignals([occurrence], { nowMs: now, horizonHours: 24 * 8 });
    expect(signal?.id).toBe(`calendar:a@example.com@${occurrence.startMs}`);
  });

  it('excludes an event that ends before the lookback window starts', () => {
    const past = event({
      startMs: new Date(2026, 8, 1, 8, 0, 0).getTime(),
      endMs: new Date(2026, 8, 1, 9, 0, 0).getTime(),
    });
    const signals = icsSignals([past], { nowMs: now, pastHours: 2, horizonHours: 24 });
    expect(signals).toEqual([]);
  });

  it('excludes an event that starts after the horizon', () => {
    const future = event({
      startMs: new Date(2026, 8, 10, 8, 0, 0).getTime(),
      endMs: new Date(2026, 8, 10, 9, 0, 0).getTime(),
    });
    const signals = icsSignals([future], { nowMs: now, horizonHours: 24 });
    expect(signals).toEqual([]);
  });

  it('includes an event still running from before the lookback window', () => {
    const running = event({
      startMs: now - 3 * 3_600_000,
      endMs: now + 3_600_000,
    });
    const signals = icsSignals([running], { nowMs: now, pastHours: 2, horizonHours: 24 });
    expect(signals).toHaveLength(1);
  });
});

describe('a calendar with far too many events', () => {
  it('caps the list it hands on', () => {
    const now = Date.UTC(2026, 8, 3, 12, 0, 0);
    const events = Array.from({ length: 900 }, (_, i) => ({
      uid: `bulk-${i}`,
      summary: `Event ${i}`,
      startMs: now + i * 1000,
      endMs: now + i * 1000 + 60_000,
      allDay: false,
      cancelled: false,
      transparent: false,
      organizer: '',
      exceptions: [],
    }));
    expect(icsSignals(events, { nowMs: now, horizonHours: 24 })).toHaveLength(500);
  });
});
