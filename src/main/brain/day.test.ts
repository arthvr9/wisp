import { describe, expect, it } from 'vitest';

import type { DayItem, Meeting, Signal, SignalSource } from '../../shared/signals';
import { dayItems } from './day';
import type { DayOptions } from './day';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
// A Wednesday, so the week group covers Friday through Tuesday.
const now = Date.UTC(2026, 8, 2, 10);
const endOfDay = Date.UTC(2026, 8, 2, 24);
const endOfTomorrow = endOfDay + day;
const endOfWeek = endOfDay + 6 * day;

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
    endOfTomorrowMs: endOfTomorrow,
    endOfWeekMs: endOfWeek,
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

  it('keeps a task due long after the end of the day', () => {
    const task = taskSig('a', endOfDay + 9 * day);
    const [item] = dayItems([task], opts());
    expect(item?.signal.id).toBe('clickup:a');
    expect(item?.overdue).toBe(false);
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

  it('keeps a meeting starting tomorrow', () => {
    const meeting = meetingSig('a', endOfDay + hour);
    const [item] = dayItems([meeting], opts());
    expect(item?.group).toBe('tomorrow');
  });

  it('drops a meeting starting after tomorrow', () => {
    const meeting = meetingSig('a', endOfTomorrow + hour);
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

  it('files each task under the group its due date falls in', () => {
    const late = taskSig('late', now - hour);
    const today = taskSig('today', now + 2 * hour);
    const tomorrow = taskSig('tomorrow', endOfDay + hour);
    const week = taskSig('week', endOfTomorrow + hour);
    const later = taskSig('later', endOfWeek + hour);
    const items = dayItems([later, week, tomorrow, today, late], opts());
    expect(items.map((i) => i.group)).toEqual(['late', 'today', 'tomorrow', 'week', 'later']);
    expect(ids(items)).toEqual([
      'clickup:late',
      'clickup:today',
      'clickup:tomorrow',
      'clickup:week',
      'clickup:later',
    ]);
  });

  it('files a task due on the last minute of the week under week, not later', () => {
    const edge = taskSig('a', endOfWeek - minute);
    const [item] = dayItems([edge], opts());
    expect(item?.group).toBe('week');
  });

  it('files a meeting already under way under today', () => {
    const meeting = meetingSig('a', now - 10 * minute, { endsAt: now + 20 * minute });
    const [item] = dayItems([meeting], opts());
    expect(item?.group).toBe('today');
    expect(item?.overdue).toBe(false);
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
