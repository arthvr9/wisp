import { describe, expect, it } from 'vitest';

import type { DayItem, Meeting, Signal, SignalSource } from '../../shared/signals';
import { dayItems } from './day';
import type { DayOptions } from './day';

const minute = 60_000;
const hour = 60 * minute;
const now = Date.UTC(2026, 8, 2, 10);
const endOfDay = Date.UTC(2026, 8, 2, 24);

function taskSig(id: string, dueAt: number, overrides: Partial<Signal> = {}): Signal {
  return {
    id: `clickup:${id}`,
    source: 'clickup',
    kind: 'task-due',
    title: id,
    dueAt,
    url: `https://app.clickup.com/t/${id}`,
    status: 'to do',
    listName: 'Inbox',
    ...overrides,
  };
}

function meetingSig(id: string, dueAt: number, overrides: Partial<Meeting> = {}): Signal {
  return {
    id: `calendar:${id}`,
    source: 'calendar',
    kind: 'meeting',
    title: id,
    dueAt,
    url: `https://outlook.office.com/calendar/item/${id}`,
    status: 'confirmed',
    listName: 'Calendar',
    meeting: {
      endsAt: dueAt + 30 * minute,
      accepted: true,
      allDay: false,
      organizer: 'boss@example.com',
      busy: true,
      ...overrides,
    },
  };
}

function opts(overrides: Partial<DayOptions> = {}): DayOptions {
  return {
    nowMs: now,
    endOfDayMs: endOfDay,
    snoozedUntil: () => undefined,
    canComplete: () => true,
    ...overrides,
  };
}

function ids(items: DayItem[]): string[] {
  return items.map((i) => i.signal.id);
}

describe('dayItems', () => {
  it('drops closed signals', () => {
    const closed = taskSig('a', now - hour, { closedAt: now - minute });
    expect(dayItems([closed], opts())).toEqual([]);
  });

  it('keeps an overdue task', () => {
    const task = taskSig('a', now - hour);
    const [item] = dayItems([task], opts());
    expect(item?.overdue).toBe(true);
    expect(item?.minutesLeft).toBe(-60);
  });

  it('keeps a task due later today', () => {
    const task = taskSig('a', now + 2 * hour);
    const [item] = dayItems([task], opts());
    expect(item?.overdue).toBe(false);
    expect(item?.minutesLeft).toBe(120);
  });

  it('drops a task due after the end of the day', () => {
    const task = taskSig('a', endOfDay + hour);
    expect(dayItems([task], opts())).toEqual([]);
  });

  it('keeps a meeting starting before the end of the day', () => {
    const meeting = meetingSig('a', now + hour);
    const [item] = dayItems([meeting], opts());
    expect(item?.signal.id).toBe('calendar:a');
    expect(item?.overdue).toBe(false);
  });

  it('drops a meeting that already ended', () => {
    const meeting = meetingSig('a', now - 2 * hour, { endsAt: now - hour });
    expect(dayItems([meeting], opts())).toEqual([]);
  });

  it('drops a meeting starting after the end of the day', () => {
    const meeting = meetingSig('a', endOfDay + hour);
    expect(dayItems([meeting], opts())).toEqual([]);
  });

  it('sorts overdue first, then by dueAt ascending', () => {
    const a = taskSig('a', now + 3 * hour);
    const b = taskSig('b', now - hour);
    const c = taskSig('c', now + hour);
    expect(ids(dayItems([a, b, c], opts()))).toEqual(['clickup:b', 'clickup:c', 'clickup:a']);
  });

  it('lists a snoozed item marked with snoozedUntil', () => {
    const task = taskSig('a', now + hour);
    const until = now + hour * 2;
    const [item] = dayItems(
      [task],
      opts({ snoozedUntil: (id) => (id === 'clickup:a' ? until : undefined) }),
    );
    expect(item?.snoozedUntil).toBe(until);
  });

  it('leaves snoozedUntil unset for a signal with no snooze', () => {
    const [item] = dayItems([taskSig('a', now + hour)], opts());
    expect(item?.snoozedUntil).toBeUndefined();
  });

  it('offers complete only for task-due signals whose source can write', () => {
    const task = taskSig('a', now + hour, { source: 'clickup' });
    const meeting = meetingSig('b', now + hour);
    const canComplete = (source: SignalSource) => source === 'clickup';
    const items = dayItems([task, meeting], opts({ canComplete }));
    expect(items.find((i) => i.signal.id === 'clickup:a')?.actions.complete).toBe(true);
    expect(items.find((i) => i.signal.id === 'calendar:b')?.actions.complete).toBe(false);
  });

  it('withholds complete when the source cannot write', () => {
    const task = taskSig('a', now + hour);
    const [item] = dayItems([task], opts({ canComplete: () => false }));
    expect(item?.actions.complete).toBe(false);
  });
});
