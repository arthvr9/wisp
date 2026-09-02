import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

  it('tracks announcements per signal and kind', () => {
    expect(store.wasAnnounced('clickup:a', 'due-soon')).toBe(false);
    store.markAnnounced('clickup:a', 'due-soon', 10);
    expect(store.wasAnnounced('clickup:a', 'due-soon')).toBe(true);
    expect(store.wasAnnounced('clickup:a', 'overdue')).toBe(false);
    expect(store.wasAnnounced('clickup:b', 'due-soon')).toBe(false);
    store.markAnnounced('clickup:a', 'due-soon', 20);
    expect(store.wasAnnounced('clickup:a', 'due-soon')).toBe(true);
  });

  it('stores meta values', () => {
    expect(store.getMeta('last-sync')).toBeUndefined();
    store.setMeta('last-sync', '123');
    expect(store.getMeta('last-sync')).toBe('123');
    store.setMeta('last-sync', '456');
    expect(store.getMeta('last-sync')).toBe('456');
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
      first.markAnnounced('clickup:a', 'due-soon', 10);
      first.close();

      const second = new SignalStore(path);
      expect(second.getMeta('k')).toBe('v');
      expect(second.list().map((s) => s.id)).toEqual(['clickup:a']);
      expect(second.wasAnnounced('clickup:a', 'due-soon')).toBe(true);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
