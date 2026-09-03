import { describe, expect, it, vi } from 'vitest';

import { fetchGruplySignals } from './tasks';
import type { GruplyClient } from './client';

interface Call {
  path: string;
  query?: Record<string, string>;
}

function fakeClient(
  handler: (path: string, query: Record<string, string> | undefined) => unknown,
  opts: { delayMs?: number; track?: { inFlight: number; max: number } } = {},
): GruplyClient & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async get<T>(path: string, query?: Record<string, string>): Promise<T> {
      calls.push({ path, query });
      if (opts.track !== undefined) {
        opts.track.inFlight += 1;
        opts.track.max = Math.max(opts.track.max, opts.track.inFlight);
      }
      try {
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs ?? 0));
        return handler(path, query) as T;
      } finally {
        if (opts.track !== undefined) opts.track.inFlight -= 1;
      }
    },
  };
}

function envelope(data: unknown[], totalPages = 1): { data: unknown[]; totalPages: number } {
  return { data, totalPages };
}

function project(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name: `Project ${id}`, status: 'active', ...over };
}

const email = 'arthur.cardoso@grancoffee.com.br';

function task(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    project_id: 'p1',
    title: `Task ${id}`,
    due_date: '2026-09-05T00:00:00.000Z',
    completed_at: null,
    status: { id: 's1', name: 'In progress', category: 'active' },
    assignees: [{ user_id: 'u1', name: 'Arthur', email }],
    is_deleted: false,
    ...over,
  };
}

const DAY_MS = 86_400_000;
const now = new Date(2026, 8, 2, 12, 0, 0).getTime();

describe('fetchGruplySignals', () => {
  it('paginates the projects list using totalPages', async () => {
    const client = fakeClient((path, query) => {
      if (path === '/projects') {
        if (query?.page === '1') return envelope([project('p1')], 2);
        if (query?.page === '2') return envelope([project('p2')], 2);
        throw new Error(`unexpected projects page ${String(query?.page)}`);
      }
      return envelope([]);
    });
    await fetchGruplySignals(client, { nowMs: now, email });
    const projectCalls = client.calls.filter((c) => c.path === '/projects');
    expect(projectCalls.map((c) => c.query?.page)).toEqual(['1', '2']);
    expect(client.calls.some((c) => c.path === '/projects/p1/tasks')).toBe(true);
    expect(client.calls.some((c) => c.path === '/projects/p2/tasks')).toBe(true);
  });

  it("paginates a project's tasks using totalPages", async () => {
    const client = fakeClient((path, query) => {
      if (path === '/projects') return envelope([project('p1')]);
      if (path === '/projects/p1/tasks') {
        if (query?.page === '1') return envelope([task('a')], 2);
        if (query?.page === '2') return envelope([task('b')], 2);
        throw new Error(`unexpected tasks page ${String(query?.page)}`);
      }
      throw new Error(`unexpected path ${path}`);
    });
    const signals = await fetchGruplySignals(client, { nowMs: now, email });
    expect(signals.map((s) => s.id).sort()).toEqual(['gruply:a', 'gruply:b']);
  });

  it('keeps only tasks assigned to the configured email, case-insensitively', async () => {
    const client = fakeClient((path) => {
      if (path === '/projects') return envelope([project('p1')]);
      if (path === '/projects/p1/tasks') {
        return envelope([
          task('mine', { assignees: [{ email: email.toUpperCase() }] }),
          task('other', { assignees: [{ email: 'someone-else@grancoffee.com.br' }] }),
          task('none', { assignees: [] }),
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });
    const signals = await fetchGruplySignals(client, { nowMs: now, email });
    expect(signals.map((s) => s.id)).toEqual(['gruply:mine']);
  });

  it('keeps only tasks with a due date inside the configured window', async () => {
    const client = fakeClient((path) => {
      if (path === '/projects') return envelope([project('p1')]);
      if (path === '/projects/p1/tasks') {
        return envelope([
          task('past', { due_date: new Date(now - 40 * DAY_MS).toISOString() }),
          task('inrange', { due_date: new Date(now - 10 * DAY_MS).toISOString() }),
          task('future', { due_date: new Date(now + 20 * DAY_MS).toISOString() }),
          task('nodue', { due_date: null }),
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });
    const signals = await fetchGruplySignals(client, { nowMs: now, email });
    expect(signals.map((s) => s.id)).toEqual(['gruply:inrange']);
  });

  it('skips malformed projects and tasks instead of failing the batch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = fakeClient((path) => {
      if (path === '/projects') return envelope([project('p1'), { bad: true }]);
      if (path === '/projects/p1/tasks') return envelope([task('good'), { bad: true }]);
      throw new Error(`unexpected path ${path}`);
    });
    const signals = await fetchGruplySignals(client, { nowMs: now, email });
    expect(signals.map((s) => s.id)).toEqual(['gruply:good']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipped 2'));
    warn.mockRestore();
  });

  it('skips a task marked is_deleted', async () => {
    const client = fakeClient((path) => {
      if (path === '/projects') return envelope([project('p1')]);
      if (path === '/projects/p1/tasks') {
        return envelope([task('gone', { is_deleted: true }), task('kept')]);
      }
      throw new Error(`unexpected path ${path}`);
    });
    const signals = await fetchGruplySignals(client, { nowMs: now, email });
    expect(signals.map((s) => s.id)).toEqual(['gruply:kept']);
  });

  it('keeps a completed task as a signal with closedAt from completed_at', async () => {
    const client = fakeClient((path) => {
      if (path === '/projects') return envelope([project('p1')]);
      if (path === '/projects/p1/tasks') {
        return envelope([
          task('done', {
            completed_at: '2026-08-30T00:00:00.000Z',
            status: { id: 's2', name: 'Done', category: 'done' },
          }),
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });
    const signals = await fetchGruplySignals(client, { nowMs: now, email });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.closedAt).toBe(Date.parse('2026-08-30T00:00:00.000Z'));
  });

  it('falls back to updated_at as closedAt when only the status category looks done', async () => {
    const client = fakeClient((path) => {
      if (path === '/projects') return envelope([project('p1')]);
      if (path === '/projects/p1/tasks') {
        return envelope([
          task('done', {
            completed_at: null,
            updated_at: '2026-08-29T00:00:00.000Z',
            status: { id: 's2', name: 'Done', category: 'done' },
          }),
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });
    const signals = await fetchGruplySignals(client, { nowMs: now, email });
    expect(signals[0]?.closedAt).toBe(Date.parse('2026-08-29T00:00:00.000Z'));
  });

  it('leaves closedAt unset for an open task with no completed_at', async () => {
    const client = fakeClient((path) => {
      if (path === '/projects') return envelope([project('p1')]);
      if (path === '/projects/p1/tasks') return envelope([task('open')]);
      throw new Error(`unexpected path ${path}`);
    });
    const signals = await fetchGruplySignals(client, { nowMs: now, email });
    expect(signals[0]?.closedAt).toBeUndefined();
  });

  it('stops collecting projects once maxProjects is reached', async () => {
    const client = fakeClient((path) => {
      if (path === '/projects') return envelope([project('p1'), project('p2'), project('p3')]);
      return envelope([]);
    });
    await fetchGruplySignals(client, { nowMs: now, email, maxProjects: 2 });
    const taskPaths = new Set(
      client.calls.filter((c) => c.path.endsWith('/tasks')).map((c) => c.path),
    );
    expect(taskPaths.size).toBe(2);
  });

  it('never runs more than `concurrency` task requests at once', async () => {
    const projects = Array.from({ length: 8 }, (_, i) => project(`p${String(i)}`));
    const track = { inFlight: 0, max: 0 };
    const client = fakeClient(
      (path) => {
        if (path === '/projects') return envelope(projects);
        return envelope([]);
      },
      { delayMs: 5, track },
    );
    await fetchGruplySignals(client, { nowMs: now, email, concurrency: 3, maxProjects: 8 });
    expect(track.max).toBeLessThanOrEqual(3);
    expect(track.max).toBeGreaterThan(1);
  });
});

describe('a project that cannot be read', () => {
  it('is skipped without losing the other projects', async () => {
    const client: GruplyClient = {
      get: <T>(path: string): Promise<T> => {
        if (path === '/projects') {
          return Promise.resolve({
            data: [
              { id: 'p1', name: 'Broken', status: 'active' },
              { id: 'p2', name: 'Fine', status: 'active' },
            ],
            total: 2,
            page: 1,
            perPage: 100,
            totalPages: 1,
          } as T);
        }
        if (path === '/projects/p1/tasks') return Promise.reject(new Error('403 out of scope'));
        return Promise.resolve({
          data: [
            {
              id: 't1',
              project_id: 'p2',
              title: 'Survivor',
              due_date: new Date(now + 60_000).toISOString(),
              completed_at: null,
              status: { id: 's', name: 'Doing', color: '#000', category: 'active' },
              assignees: [{ user_id: 'u', name: 'A', email, avatar_url: null }],
            },
          ],
          total: 1,
          page: 1,
          perPage: 100,
          totalPages: 1,
        } as T);
      },
    };
    const signals = await fetchGruplySignals(client, { nowMs: now, email });
    expect(signals.map((s) => s.title)).toEqual(['Survivor']);
  });
});
