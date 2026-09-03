import { describe, expect, it } from 'vitest';

import { translator } from '../../shared/i18n';
import type { DayItem, Signal } from '../../shared/signals';
import { formatTimeLeft } from './panel-format';

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

function taskItem(dueAt: number, nowMs: number): DayItem {
  const minutesLeft = Math.round((dueAt - nowMs) / minute);
  return {
    signal: taskSignal(dueAt),
    minutesLeft,
    overdue: minutesLeft < 0,
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
});
