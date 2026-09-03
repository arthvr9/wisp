import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Signal } from '../../shared/signals';
import { SignalStore } from './store';

function sig(id: string, dueAt: number, extra: Partial<Signal> = {}): Signal {
  return {
    id: `clickup:${id}`,
    source: 'clickup',
    kind: 'task-due',
    title: `Task ${id}`,
    dueAt,
    url: `https://app.clickup.com/t/${id}`,
    status: 'to do',
    listName: 'Inbox',
    ...extra,
  };
}

describe('SignalStore', () => {
  let store: SignalStore;

  beforeEach(() => {
    store = new SignalStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('reports every signal as added on the first sync', () => {
    const a = sig('a', 3000);
    const b = sig('b', 1000);
    const diff = store.replaceAll('clickup', [a, b], 10);
    expect(diff.added).toEqual([a, b]);
    expect(diff.changed).toEqual([]);
    expect(diff.gone).toEqual([]);
  });

  it('lists live signals sorted by dueAt', () => {
    store.replaceAll('clickup', [sig('a', 3000), sig('b', 1000), sig('c', 2000)], 10);
    expect(store.list().map((s) => s.id)).toEqual(['clickup:b', 'clickup:c', 'clickup:a']);
    expect(store.list('clickup')).toHaveLength(3);
  });

  it('reports changed signals when title, dueAt or status differ', () => {
    store.replaceAll(
      'clickup',
      [sig('a', 1000), sig('b', 2000), sig('c', 3000), sig('d', 4000)],
      10,
    );
    const diff = store.replaceAll(
      'clickup',
      [
        sig('a', 1000, { title: 'Renamed' }),
        sig('b', 2500),
        sig('c', 3000, { status: 'in progress' }),
        sig('d', 4000, { listName: 'Other' }),
      ],
      20,
    );
    expect(diff.added).toEqual([]);
    expect(diff.changed.map((s) => s.id)).toEqual(['clickup:a', 'clickup:b', 'clickup:c']);
    expect(diff.gone).toEqual([]);
    expect(store.list().find((s) => s.id === 'clickup:a')?.title).toBe('Renamed');
  });

  it('marks missing signals gone and hides them from list', () => {
    const a = sig('a', 1000);
    store.replaceAll('clickup', [a, sig('b', 2000)], 10);
    const diff = store.replaceAll('clickup', [sig('b', 2000)], 20);
    expect(diff.gone).toEqual([a]);
    expect(store.list().map((s) => s.id)).toEqual(['clickup:b']);

    const again = store.replaceAll('clickup', [sig('b', 2000)], 30);
    expect(again.gone).toEqual([]);
  });

  it('counts a returning signal as added', () => {
    const a = sig('a', 1000);
    store.replaceAll('clickup', [a], 10);
    store.replaceAll('clickup', [], 20);
    const diff = store.replaceAll('clickup', [a], 30);
    expect(diff.added).toEqual([a]);
    expect(diff.changed).toEqual([]);
    expect(store.list()).toEqual([a]);
  });

  it('keeps every nudge record inside the retention window', () => {
    const hour = 60 * 60 * 1000;
    const now = 100 * hour;
    store.recordNudge({ signalId: 'clickup:a', kind: 'overdue', at: now - 50 * hour });
    store.recordNudge({ signalId: 'clickup:a', kind: 'overdue', at: now - 30 * hour });
    store.recordNudge({ signalId: 'clickup:b', kind: 'due-soon', at: now - hour });
    const history = store.nudgeHistory(now);
    expect(history).toEqual([
      { signalId: 'clickup:a', kind: 'overdue', at: now - 50 * hour },
      { signalId: 'clickup:a', kind: 'overdue', at: now - 30 * hour },
      { signalId: 'clickup:b', kind: 'due-soon', at: now - hour },
    ]);
    expect(store.nudgeHistory(now, 2 * hour)).toHaveLength(1);
  });

  it('prunes records older than the retention window when writing', () => {
    const now = 40 * 24 * 60 * 60 * 1000;
    store.recordNudge({ signalId: 'clickup:a', kind: 'overdue', at: 0 });
    store.recordNudge({ signalId: 'clickup:a', kind: 'overdue', at: now });
    expect(store.nudgeHistory(now)).toEqual([{ signalId: 'clickup:a', kind: 'overdue', at: now }]);
  });

  it('stores meta values', () => {
    expect(store.getMeta('last-sync')).toBeUndefined();
    store.setMeta('last-sync', '123');
    expect(store.getMeta('last-sync')).toBe('123');
    store.setMeta('last-sync', '456');
    expect(store.getMeta('last-sync')).toBe('456');
  });
});

describe('snoozes', () => {
  let store: SignalStore;
  // The prune on write compares against the real clock, so every test pins it with fake
  // timers instead of leaving it to whatever Date.now() happens to be.
  const base = 1_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(base);
    store = new SignalStore(':memory:');
  });

  afterEach(() => {
    store.close();
    vi.useRealTimers();
  });

  it('reports undefined for a signal that was never snoozed', () => {
    expect(store.snoozedUntil('clickup:a', base)).toBeUndefined();
  });

  it('reports the stored expiry while it is still in the future', () => {
    store.snooze('clickup:a', base + 5000);
    expect(store.snoozedUntil('clickup:a', base + 1000)).toBe(base + 5000);
  });

  it('reports undefined once the expiry has passed', () => {
    store.snooze('clickup:a', base + 5000);
    expect(store.snoozedUntil('clickup:a', base + 6000)).toBeUndefined();
  });

  it('replaces the expiry when snoozed again', () => {
    store.snooze('clickup:a', base + 5000);
    store.snooze('clickup:a', base + 9000);
    expect(store.snoozedUntil('clickup:a', base + 6000)).toBe(base + 9000);
  });

  it('clears a snooze explicitly', () => {
    store.snooze('clickup:a', base + 5000);
    store.clearSnooze('clickup:a');
    expect(store.snoozedUntil('clickup:a', base + 1000)).toBeUndefined();
  });

  it('does not prune a snooze that is still active when another signal is snoozed', () => {
    store.snooze('clickup:a', base + 60 * 60_000);
    vi.setSystemTime(base + 10 * 60_000);
    store.snooze('clickup:b', base + 10 * 60_000 + 60 * 60_000);
    expect(store.snoozedUntil('clickup:a', base + 20 * 60_000)).toBe(base + 60 * 60_000);
  });

  it('prunes an expired row on the next write, without needing it read first', () => {
    store.snooze('clickup:a', base + 2000);
    vi.setSystemTime(base + 5000);
    // Nothing ever calls snoozedUntil('clickup:a', ...) here, so the only way this can come
    // back undefined is if the write to `b` pruned the expired row for `a`.
    store.snooze('clickup:b', base + 6000);
    expect(store.snoozedUntil('clickup:a', 0)).toBeUndefined();
  });
});

describe('SignalStore on disk', () => {
  it('persists meta and signals across instances', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wisp-store-'));
    const path = join(dir, 'signals.db');
    try {
      const first = new SignalStore(path);
      first.setMeta('k', 'v');
      first.replaceAll('clickup', [sig('a', 1000)], 10);
      first.recordNudge({ signalId: 'clickup:a', kind: 'due-soon', at: 10 });
      first.close();

      const second = new SignalStore(path);
      expect(second.getMeta('k')).toBe('v');
      expect(second.list().map((s) => s.id)).toEqual(['clickup:a']);
      expect(second.nudgeHistory(20)).toHaveLength(1);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('completed tasks', () => {
  it('reports a task that went from open to closed once, and hides it from list', () => {
    const store = new SignalStore(':memory:');
    const open: Signal = {
      id: 'clickup:z',
      source: 'clickup',
      kind: 'task-due',
      title: 'Ship it',
      dueAt: 1000,
      url: 'https://x',
      status: 'to do',
      listName: 'L',
    };
    expect(store.replaceAll('clickup', [open], 1).added).toHaveLength(1);
    const closed = { ...open, status: 'complete', closedAt: 900 };
    const diff = store.replaceAll('clickup', [closed], 2);
    expect(diff.completed.map((s) => s.id)).toEqual(['clickup:z']);
    expect(diff.changed).toHaveLength(0);
    expect(store.list()).toHaveLength(0);
    expect(store.replaceAll('clickup', [closed], 3).completed).toHaveLength(0);
    store.close();
  });

  it('marks a signal closed directly, without waiting for a sync', () => {
    const store = new SignalStore(':memory:');
    store.replaceAll('clickup', [sig('a', 1000)], 10);
    expect(store.list()).toHaveLength(1);
    store.markClosed('clickup:a', 20);
    expect(store.list()).toHaveLength(0);
    store.close();
  });
});

describe('meeting payload', () => {
  it('survives a round trip through the database', () => {
    const store = new SignalStore(':memory:');
    const meeting: Signal = {
      id: 'outlook:m1',
      source: 'outlook',
      kind: 'meeting',
      title: 'Standup',
      dueAt: 1000,
      url: 'https://outlook',
      status: 'accepted',
      listName: 'Calendar',
      meeting: { endsAt: 2000, accepted: true, allDay: false, organizer: 'a@b.c', busy: true },
    };
    store.replaceAll('outlook', [meeting], 1);
    expect(store.list('outlook')[0]?.meeting).toEqual(meeting.meeting);
    store.close();
  });
});
