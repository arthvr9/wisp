import { describe, expect, it, vi } from 'vitest';

import { fetchCalendarSignals } from './calendar';
import type { GraphClient } from './client';

interface Call {
  path: string;
  query: Record<string, string> | undefined;
  headers: Record<string, string> | undefined;
}

function fakeClient(pages: unknown[]): GraphClient & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    get: <T>(
      path: string,
      query?: Record<string, string>,
      headers?: Record<string, string>,
    ): Promise<T> => {
      calls.push({ path, query, headers });
      const page = pages[calls.length - 1];
      return Promise.resolve(page as T);
    },
  };
}

function event(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    subject: `Meeting ${id}`,
    start: { dateTime: '2026-09-02T14:00:00.0000000' },
    end: { dateTime: '2026-09-02T15:00:00.0000000' },
    isAllDay: false,
    isCancelled: false,
    showAs: 'busy',
    responseStatus: { response: 'accepted' },
    organizer: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
    webLink: `https://outlook.office.com/${id}`,
    seriesMasterId: null,
    ...over,
  };
}

function page(value: unknown[], nextLink?: string): Record<string, unknown> {
  return nextLink === undefined ? { value } : { value, '@odata.nextLink': nextLink };
}

const now = new Date(2026, 8, 2, 12, 0, 0).getTime();

describe('fetchCalendarSignals', () => {
  it('requests calendarView with the expected window, select and headers', async () => {
    const client = fakeClient([page([])]);
    await fetchCalendarSignals(client, { nowMs: now, horizonHours: 24 });
    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call?.path).toBe('/me/calendarView');
    expect(call?.headers).toEqual({ Prefer: 'outlook.timezone="UTC"' });
    expect(call?.query).toEqual({
      startDateTime: new Date(now - 2 * 3_600_000).toISOString(),
      endDateTime: new Date(now + 24 * 3_600_000).toISOString(),
      $select:
        'id,subject,start,end,isAllDay,isCancelled,showAs,responseStatus,organizer,webLink,seriesMasterId',
      $orderby: 'start/dateTime',
      $top: '100',
    });
  });

  it('respects a custom pastHours', async () => {
    const client = fakeClient([page([])]);
    await fetchCalendarSignals(client, { nowMs: now, pastHours: 5, horizonHours: 1 });
    expect(client.calls[0]?.query?.startDateTime).toBe(new Date(now - 5 * 3_600_000).toISOString());
  });

  it('maps an event to a meeting signal, parsing wall-clock times as UTC', async () => {
    const client = fakeClient([page([event('a')])]);
    const signals = await fetchCalendarSignals(client, { nowMs: now, horizonHours: 24 });
    expect(signals).toEqual([
      {
        id: 'outlook:a',
        source: 'outlook',
        kind: 'meeting',
        dueAt: Date.parse('2026-09-02T14:00:00.000Z'),
        title: 'Meeting a',
        url: 'https://outlook.office.com/a',
        status: 'accepted',
        listName: 'Calendar',
        meeting: {
          endsAt: Date.parse('2026-09-02T15:00:00.000Z'),
          accepted: true,
          allDay: false,
          organizer: 'Alice',
          busy: true,
        },
      },
    ]);
  });

  it('falls back to the organizer address and a placeholder subject', async () => {
    const client = fakeClient([
      page([
        event('a', {
          subject: '',
          organizer: { emailAddress: { address: 'bob@example.com' } },
        }),
      ]),
    ]);
    const [signal] = await fetchCalendarSignals(client, { nowMs: now, horizonHours: 24 });
    expect(signal?.title).toBe('(no subject)');
    expect(signal?.meeting?.organizer).toBe('bob@example.com');
  });

  it('follows @odata.nextLink up to five pages', async () => {
    const client = fakeClient([
      page([event('a')], 'https://graph.microsoft.com/v1.0/me/calendarView?next=1'),
      page([event('b')], 'https://graph.microsoft.com/v1.0/me/calendarView?next=2'),
      page([event('c')]),
    ]);
    const signals = await fetchCalendarSignals(client, { nowMs: now, horizonHours: 24 });
    expect(client.calls.map((c) => c.path)).toEqual([
      '/me/calendarView',
      'https://graph.microsoft.com/v1.0/me/calendarView?next=1',
      'https://graph.microsoft.com/v1.0/me/calendarView?next=2',
    ]);
    expect(client.calls[1]?.query).toBeUndefined();
    expect(signals.map((s) => s.id)).toEqual(['outlook:a', 'outlook:b', 'outlook:c']);
  });

  it('stops after five pages even if nextLink keeps coming', async () => {
    const pages = Array.from({ length: 7 }, (_, i) =>
      page([event(String(i))], `https://graph.microsoft.com/v1.0/me/calendarView?next=${i + 1}`),
    );
    const client = fakeClient(pages);
    const signals = await fetchCalendarSignals(client, { nowMs: now, horizonHours: 24 });
    expect(client.calls).toHaveLength(5);
    expect(signals).toHaveLength(5);
  });

  it('skips a malformed event while keeping the rest of the page', async () => {
    const client = fakeClient([page([event('a'), { id: 'broken' }, event('b')])]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const signals = await fetchCalendarSignals(client, { nowMs: now, horizonHours: 24 });
    expect(signals.map((s) => s.id)).toEqual(['outlook:a', 'outlook:b']);
    expect(warn).toHaveBeenCalledWith(
      'outlook: skipped 1 calendar events that did not match the schema',
    );
    warn.mockRestore();
  });

  it('skips a cancelled event entirely', async () => {
    const client = fakeClient([page([event('a', { isCancelled: true }), event('b')])]);
    const signals = await fetchCalendarSignals(client, { nowMs: now, horizonHours: 24 });
    expect(signals.map((s) => s.id)).toEqual(['outlook:b']);
  });

  it('keeps an all-day event with allDay: true', async () => {
    const client = fakeClient([
      page([
        event('a', {
          isAllDay: true,
          start: { dateTime: '2026-09-05T00:00:00.0000000' },
          end: { dateTime: '2026-09-06T00:00:00.0000000' },
        }),
      ]),
    ]);
    const [signal] = await fetchCalendarSignals(client, { nowMs: now, horizonHours: 240 });
    expect(signal?.meeting?.allDay).toBe(true);
  });

  it('keeps a declined event with accepted: false', async () => {
    const client = fakeClient([page([event('a', { responseStatus: { response: 'declined' } })])]);
    const [signal] = await fetchCalendarSignals(client, { nowMs: now, horizonHours: 24 });
    expect(signal?.status).toBe('declined');
    expect(signal?.meeting?.accepted).toBe(false);
  });

  it('treats the organizer response as accepted', async () => {
    const client = fakeClient([page([event('a', { responseStatus: { response: 'organizer' } })])]);
    const [signal] = await fetchCalendarSignals(client, { nowMs: now, horizonHours: 24 });
    expect(signal?.meeting?.accepted).toBe(true);
  });

  it('treats showAs "oof" as busy', async () => {
    const client = fakeClient([page([event('a', { showAs: 'oof' })])]);
    const [signal] = await fetchCalendarSignals(client, { nowMs: now, horizonHours: 24 });
    expect(signal?.meeting?.busy).toBe(true);
  });

  it('throws when the page itself does not match the schema', async () => {
    const client = fakeClient([{ notValue: true }]);
    await expect(fetchCalendarSignals(client, { nowMs: now, horizonHours: 24 })).rejects.toThrow(
      /unexpected response/,
    );
  });
});
