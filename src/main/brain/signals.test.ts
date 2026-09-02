import { describe, expect, it } from 'vitest';

import type { Signal } from '../../shared/signals';
import { dueAnnouncements } from './signals';

const minute = 60_000;
const now = 1_000_000 * minute;

function sig(id: string, dueAt: number): Signal {
  return {
    id: `clickup:${id}`,
    source: 'clickup',
    kind: 'task-due',
    title: id,
    dueAt,
    url: '',
    status: 'to do',
    listName: 'Inbox',
  };
}

const never = () => false;

describe('dueAnnouncements', () => {
  it('classifies due-soon, due-now and overdue', () => {
    const out = dueAnnouncements(
      [sig('soon', now + 10 * minute), sig('now', now - 30_000), sig('late', now - 5 * minute)],
      now,
      { dueSoonMs: 30 * minute, announced: never },
    );
    expect(out.map((a) => [a.signal.id, a.kind, a.minutesLeft])).toEqual([
      ['clickup:late', 'overdue', -5],
      ['clickup:now', 'due-now', 0],
      ['clickup:soon', 'due-soon', 10],
    ]);
  });

  it('honours the boundaries', () => {
    const at = (dueAt: number) =>
      dueAnnouncements([sig('x', dueAt)], now, { dueSoonMs: 30 * minute, announced: never }).map(
        (a) => a.kind,
      );
    expect(at(now + 30 * minute)).toEqual(['due-soon']);
    expect(at(now + 30 * minute + 1)).toEqual([]);
    expect(at(now + 1)).toEqual(['due-soon']);
    expect(at(now)).toEqual(['due-now']);
    expect(at(now - minute + 1)).toEqual(['due-now']);
    expect(at(now - minute)).toEqual(['overdue']);
  });

  it('skips kinds already announced for that signal', () => {
    const announced = (id: string, kind: string) => id === 'clickup:a' && kind === 'due-soon';
    const out = dueAnnouncements([sig('a', now + minute), sig('b', now + minute)], now, {
      dueSoonMs: 30 * minute,
      announced,
    });
    expect(out.map((a) => a.signal.id)).toEqual(['clickup:b']);
  });

  it('announces overdue only once per task', () => {
    const announced = (_id: string, kind: string) => kind === 'overdue';
    const out = dueAnnouncements([sig('a', now - 2 * minute)], now, {
      dueSoonMs: 30 * minute,
      announced,
    });
    expect(out).toEqual([]);
  });

  it('sorts by dueAt and returns at most 3', () => {
    const out = dueAnnouncements(
      [
        sig('d', now + 4 * minute),
        sig('b', now + 2 * minute),
        sig('a', now + minute),
        sig('c', now + 3 * minute),
      ],
      now,
      { dueSoonMs: 30 * minute, announced: never },
    );
    expect(out.map((a) => a.signal.id)).toEqual(['clickup:a', 'clickup:b', 'clickup:c']);
  });
});
