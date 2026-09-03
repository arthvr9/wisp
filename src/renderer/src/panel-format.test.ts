import { describe, expect, it } from 'vitest';

import { translator } from '../../shared/i18n';
import type { DayGroup, DayItem, Signal } from '../../shared/signals';
import { formatTimeLeft, groupRows, panelTitle } from './panel-format';

const t = translator('en');
const minute = 60_000;
const hour = 60 * minute;

function taskSignal(dueAt: number): Signal {
  return {
    id: 'clickup:a',
    source: 'clickup',
    kind: 'task-due',
    title: 'Write the report',
    dueAt,
    url: 'https://app.clickup.com/t/a',
    status: 'to do',
    listName: 'Inbox',
  };
}

function taskItem(dueAt: number, nowMs: number, group: DayGroup = 'today'): DayItem {
  const minutesLeft = Math.round((dueAt - nowMs) / minute);
  const overdue = minutesLeft < 0;
  return {
    signal: taskSignal(dueAt),
    minutesLeft,
    overdue,
    group: overdue ? 'late' : group,
    actions: { complete: true },
  };
}

function meetingSignal(dueAt: number, endsAt: number, allDay = false): Signal {
  return {
    id: 'calendar:a',
    source: 'calendar',
    kind: 'meeting',
    title: 'Team sync',
    dueAt,
    url: 'https://outlook.office.com/calendar/item/a',
    status: 'confirmed',
    listName: 'Calendar',
    meeting: { endsAt, accepted: true, allDay, organizer: 'boss@example.com', busy: true },
  };
}

function meetingItem(dueAt: number, endsAt: number, allDay = false): DayItem {
  return {
    signal: meetingSignal(dueAt, endsAt, allDay),
    minutesLeft: Math.round((dueAt - Date.now()) / minute),
    overdue: false,
    group: 'today',
    actions: { complete: false },
  };
}

describe('formatTimeLeft', () => {
  it('shows minutes for a task due soon', () => {
    const now = Date.UTC(2026, 8, 2, 10, 0);
    const item = taskItem(now + 25 * minute, now);
    expect(formatTimeLeft(item, t)).toBe('in 25 min');
  });

  it('shows now for a task due this minute', () => {
    const now = Date.UTC(2026, 8, 2, 10, 0);
    const item = taskItem(now, now);
    expect(formatTimeLeft(item, t)).toBe('now');
  });

  it('shows hours late for an overdue task', () => {
    const now = Date.UTC(2026, 8, 2, 10, 0);
    const item = taskItem(now - 2 * hour, now);
    expect(formatTimeLeft(item, t)).toBe('2 h late');
  });

  it('shows the clock time for a task due later today', () => {
    const now = new Date(2026, 8, 2, 10, 0).getTime();
    const dueAt = new Date(2026, 8, 2, 16, 45).getTime();
    const item = taskItem(dueAt, now);
    expect(formatTimeLeft(item, t)).toBe('16:45');
  });

  it('shows All day for an all day meeting', () => {
    const now = Date.UTC(2026, 8, 2, 10, 0);
    const item = meetingItem(now, now + 24 * hour, true);
    expect(formatTimeLeft(item, t)).toBe('All day');
  });

  it('shows the start and end time for a timed meeting', () => {
    const start = new Date(2026, 8, 2, 14, 0).getTime();
    const end = new Date(2026, 8, 2, 14, 30).getTime();
    const item = meetingItem(start, end);
    expect(formatTimeLeft(item, t)).toBe('14:00-14:30');
  });

  it('shows the weekday and the time for a task due tomorrow', () => {
    const now = new Date(2026, 8, 2, 10, 0).getTime();
    const dueAt = new Date(2026, 8, 3, 9, 0).getTime();
    expect(formatTimeLeft(taskItem(dueAt, now, 'tomorrow'), t)).toBe('Thu 09:00');
  });

  it('shows the weekday and the time for a task due later this week', () => {
    const now = new Date(2026, 8, 2, 10, 0).getTime();
    const dueAt = new Date(2026, 8, 7, 17, 0).getTime();
    expect(formatTimeLeft(taskItem(dueAt, now, 'week'), t)).toBe('Mon 17:00');
  });

  it('shows a short date for a task due beyond the week', () => {
    const now = new Date(2026, 8, 2, 10, 0).getTime();
    const dueAt = new Date(2026, 8, 11, 17, 0).getTime();
    expect(formatTimeLeft(taskItem(dueAt, now, 'later'), t)).toBe('11 Sep');
  });

  it('keeps the countdown for something due within the hour but past midnight', () => {
    const now = new Date(2026, 8, 2, 23, 50).getTime();
    const dueAt = new Date(2026, 8, 3, 0, 20).getTime();
    expect(formatTimeLeft(taskItem(dueAt, now, 'tomorrow'), t)).toBe('in 30 min');
  });
});

describe('groupRows', () => {
  it('keeps the group order and drops the empty groups', () => {
    const now = new Date(2026, 8, 2, 10, 0).getTime();
    const items = [
      taskItem(now - hour, now),
      taskItem(now + 3 * hour, now, 'today'),
      taskItem(now + 9 * 24 * hour, now, 'later'),
    ];
    expect(groupRows(items).map((s) => s.group)).toEqual(['late', 'today', 'later']);
    expect(groupRows(items).map((s) => s.items.length)).toEqual([1, 1, 1]);
  });

  it('returns nothing for an empty list', () => {
    expect(groupRows([])).toEqual([]);
  });
});

describe('panelTitle', () => {
  const now = new Date(2026, 8, 2, 10, 0).getTime();
  const late = () => taskItem(now - hour, now);
  const today = () => taskItem(now + 3 * hour, now, 'today');
  const later = () => taskItem(now + 9 * 24 * hour, now, 'later');

  it('counts late and today together when both exist', () => {
    expect(panelTitle([late(), late(), today()], t)).toBe('2 late, 1 today');
  });

  it('counts only what is late when nothing is due today', () => {
    expect(panelTitle([late(), later()], t)).toBe('1 late');
  });

  it('counts what is due today when nothing is late', () => {
    expect(panelTitle([today(), later()], t)).toBe('1 due today');
  });

  it('falls back to the whole list when nothing is late or due today', () => {
    expect(panelTitle([later(), later()], t)).toBe('2 coming up');
  });

  it('says the list is empty when it is', () => {
    expect(panelTitle([], t)).toBe('Nothing open');
  });
});
