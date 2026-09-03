import { describe, expect, it } from 'vitest';

import { createCalendarConnector } from './calendar';
import type { CalendarConfig } from '../../shared/config';

const now = new Date(2026, 8, 2, 12, 0, 0).getTime();

function config(icsUrl: string): () => CalendarConfig {
  return () => ({ icsUrl, warnMinutes: 5, silenceDuringMeetings: true });
}

function fakeFetch(handler: (url: string) => { status: number; body: string }): typeof fetch {
  return ((url: string) => {
    const { status, body } = handler(url);
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
}

function vevent(fields: Record<string, string>): string {
  const lines = [
    'BEGIN:VEVENT',
    ...Object.entries(fields).map(([k, v]) => `${k}:${v}`),
    'END:VEVENT',
  ];
  return lines.join('\r\n');
}

function calendar(...vevents: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...vevents, 'END:VCALENDAR'].join('\r\n');
}

describe('createCalendarConnector', () => {
  it('has credentials only when the ICS URL is set', () => {
    const withUrl = createCalendarConnector({ config: config('https://example.com/cal.ics') });
    const withoutUrl = createCalendarConnector({ config: config('') });
    expect(withUrl.hasCredentials()).toBe(true);
    expect(withoutUrl.hasCredentials()).toBe(false);
  });

  it('connect() throws a short error when the URL is empty', async () => {
    const connector = createCalendarConnector({ config: config('') });
    await expect(connector.connect()).rejects.toThrow(/calendar link is not set/);
  });

  it('connect() fetches once and succeeds for a valid calendar', async () => {
    let calls = 0;
    const connector = createCalendarConnector({
      config: config('https://example.com/cal.ics'),
      fetchFn: fakeFetch(() => {
        calls += 1;
        return { status: 200, body: calendar() };
      }),
    });
    await connector.connect();
    expect(calls).toBe(1);
  });

  it('connect() throws a short error when the fetch fails', async () => {
    const connector = createCalendarConnector({
      config: config('https://example.com/secret.ics'),
      fetchFn: fakeFetch(() => ({ status: 403, body: 'forbidden' })),
    });
    const err = await connector.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('the calendar link was rejected with status 403');
  });

  it('disconnect() and close() do nothing', async () => {
    const connector = createCalendarConnector({ config: config('https://example.com/cal.ics') });
    await expect(connector.disconnect()).resolves.toBeUndefined();
    expect(connector.close()).toBeUndefined();
  });

  it('downloads, parses, expands and maps an ICS document end to end', async () => {
    const ics = calendar(
      vevent({
        UID: 'a@example.com',
        SUMMARY: 'Roadmap review',
        DTSTART: '20260902T140000Z',
        DTEND: '20260902T150000Z',
        ORGANIZER: 'mailto:alice@example.com',
      }),
    );
    const connector = createCalendarConnector({
      config: config('https://example.com/cal.ics'),
      fetchFn: fakeFetch(() => ({ status: 200, body: ics })),
    });
    const signals = await connector.fetch(now);
    expect(signals).toEqual([
      {
        id: `calendar:a@example.com@${Date.UTC(2026, 8, 2, 14, 0, 0)}`,
        source: 'calendar',
        kind: 'meeting',
        dueAt: Date.UTC(2026, 8, 2, 14, 0, 0),
        title: 'Roadmap review',
        url: '',
        status: 'unknown',
        listName: 'Calendar',
        meeting: {
          endsAt: Date.UTC(2026, 8, 2, 15, 0, 0),
          accepted: true,
          allDay: false,
          organizer: 'alice@example.com',
          busy: true,
        },
      },
    ]);
  });

  it('expands a recurring event and maps every occurrence inside the 24 hour horizon', async () => {
    const ics = calendar(
      vevent({
        UID: 'daily@example.com',
        SUMMARY: 'Standup',
        DTSTART: '20260902T130000Z',
        DTEND: '20260902T133000Z',
        RRULE: 'FREQ=DAILY',
      }),
    );
    const connector = createCalendarConnector({
      config: config('https://example.com/cal.ics'),
      fetchFn: fakeFetch(() => ({ status: 200, body: ics })),
    });
    const signals = await connector.fetch(now);
    expect(signals).toHaveLength(2);
    expect(signals.map((s) => s.dueAt)).toEqual([
      Date.UTC(2026, 8, 2, 13, 0, 0),
      Date.UTC(2026, 8, 3, 13, 0, 0),
    ]);
  });

  it('excludes an occurrence outside the 24 hour horizon or 2 hour lookback', async () => {
    const ics = calendar(
      vevent({
        UID: 'far@example.com',
        SUMMARY: 'Next week',
        DTSTART: '20260909T130000Z',
        DTEND: '20260909T140000Z',
      }),
      vevent({
        UID: 'past@example.com',
        SUMMARY: 'Yesterday',
        DTSTART: '20260901T130000Z',
        DTEND: '20260901T140000Z',
      }),
    );
    const connector = createCalendarConnector({
      config: config('https://example.com/cal.ics'),
      fetchFn: fakeFetch(() => ({ status: 200, body: ics })),
    });
    const signals = await connector.fetch(now);
    expect(signals).toEqual([]);
  });

  it('fetch() rejects when the URL is empty, without calling fetchFn', async () => {
    let called = false;
    const connector = createCalendarConnector({
      config: config(''),
      fetchFn: fakeFetch(() => {
        called = true;
        return { status: 200, body: calendar() };
      }),
    });
    await expect(connector.fetch(now)).rejects.toThrow(/calendar link is not set/);
    expect(called).toBe(false);
  });
});
