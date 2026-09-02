import { describe, expect, it } from 'vitest';

import { fetchClickUpSignals } from './clickup';
import type { ToolCaller } from './tools';

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function fakeTools(
  names: string[],
  handler: (name: string, args: Record<string, unknown>) => unknown,
): ToolCaller & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    listTools: () => Promise.resolve(names.map((name) => ({ name }))),
    callTool: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve(handler(name, args));
    },
  };
}

function task(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    custom_id: null,
    name: `Task ${id}`,
    status: 'to do',
    url: `https://app.clickup.com/t/${id}`,
    priority: null,
    assignees: [{ id: 7, username: 'arthur' }],
    tags: [],
    due_date: '1700000000000',
    date_closed: null,
    list: { id: 'l1', name: 'Inbox' },
    ...over,
  };
}

function page(tasks: Record<string, unknown>[], pageNo: number, hasMore: boolean) {
  return {
    tasks,
    count: tasks.length,
    page: pageNo,
    has_more: hasMore,
    next_page: hasMore ? pageNo + 1 : null,
  };
}

const now = new Date(2026, 8, 2, 12, 0, 0).getTime();

describe('fetchClickUpSignals', () => {
  it('discovers tools by suffix and maps tasks to signals', async () => {
    const tools = fakeTools(['clickup_filter_tasks', 'clickup_resolve_assignees', 'other'], (n) =>
      n === 'clickup_resolve_assignees' ? { userIds: ['42'] } : page([task('a')], 0, false),
    );
    const signals = await fetchClickUpSignals(tools, { nowMs: now, horizonDays: 3 });
    expect(tools.calls[0]).toEqual({
      name: 'clickup_resolve_assignees',
      args: { assignees: ['me'] },
    });
    expect(tools.calls[1]?.name).toBe('clickup_filter_tasks');
    expect(tools.calls[1]?.args).toEqual({
      assignees: ['42'],
      due_date_from: '2026-08-26',
      due_date_to: '2026-09-05',
      order_by: 'due_date',
      include_closed: false,
      page: 0,
    });
    expect(signals).toEqual([
      {
        id: 'clickup:a',
        source: 'clickup',
        kind: 'task-due',
        title: 'Task a',
        dueAt: 1700000000000,
        url: 'https://app.clickup.com/t/a',
        status: 'to do',
        listName: 'Inbox',
      },
    ]);
  });

  it('accepts any prefix on the tool names', async () => {
    const tools = fakeTools(['mcp__x__filter_tasks', 'y_resolve_assignees'], (n) =>
      n === 'y_resolve_assignees' ? { userIds: ['1'] } : page([], 0, false),
    );
    await expect(fetchClickUpSignals(tools, { nowMs: now, horizonDays: 1 })).resolves.toEqual([]);
  });

  it('throws naming the tools seen when required tools are missing', async () => {
    const tools = fakeTools(['clickup_get_task', 'clickup_search'], () => ({}));
    await expect(fetchClickUpSignals(tools, { nowMs: now, horizonDays: 1 })).rejects.toThrow(
      /filter_tasks, resolve_assignees.*clickup_get_task, clickup_search/,
    );
  });

  it('follows pagination using next_page and stops at has_more false', async () => {
    const tools = fakeTools(['f_filter_tasks', 'r_resolve_assignees'], (n, args) => {
      if (n === 'r_resolve_assignees') return { userIds: ['1'] };
      const p = args.page as number;
      if (p === 0) return page([task('a')], 0, true);
      if (p === 1) return page([task('b')], 1, true);
      return page([task('c')], 2, false);
    });
    const signals = await fetchClickUpSignals(tools, { nowMs: now, horizonDays: 1 });
    expect(signals.map((s) => s.id)).toEqual(['clickup:a', 'clickup:b', 'clickup:c']);
    expect(tools.calls.filter((c) => c.name === 'f_filter_tasks').map((c) => c.args.page)).toEqual([
      0, 1, 2,
    ]);
  });

  it('caps pagination at 10 pages', async () => {
    const tools = fakeTools(['f_filter_tasks', 'r_resolve_assignees'], (n, args) =>
      n === 'r_resolve_assignees'
        ? { userIds: ['1'] }
        : page([task(`t${String(args.page)}`)], args.page as number, true),
    );
    const signals = await fetchClickUpSignals(tools, { nowMs: now, horizonDays: 1 });
    expect(signals).toHaveLength(10);
    expect(tools.calls.filter((c) => c.name === 'f_filter_tasks')).toHaveLength(10);
  });

  it('skips tasks without a due date or already closed', async () => {
    const tools = fakeTools(['f_filter_tasks', 'r_resolve_assignees'], (n) =>
      n === 'r_resolve_assignees'
        ? { userIds: ['1'] }
        : page(
            [
              task('a', { due_date: null }),
              task('b', { date_closed: '1700000000000' }),
              task('c', { due_date: 'not-a-number' }),
              task('d'),
            ],
            0,
            false,
          ),
    );
    const signals = await fetchClickUpSignals(tools, { nowMs: now, horizonDays: 1 });
    expect(signals.map((s) => s.id)).toEqual(['clickup:d']);
  });

  it('unwraps MCP text content carrying JSON', async () => {
    const tools = fakeTools(['f_filter_tasks', 'r_resolve_assignees'], (n) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            n === 'r_resolve_assignees' ? { userIds: ['1'] } : page([task('a')], 0, false),
          ),
        },
      ],
    }));
    const signals = await fetchClickUpSignals(tools, { nowMs: now, horizonDays: 1 });
    expect(signals.map((s) => s.id)).toEqual(['clickup:a']);
  });

  it('reports a validation error naming the tool and the field', async () => {
    const tools = fakeTools(['f_filter_tasks', 'r_resolve_assignees'], (n) =>
      n === 'r_resolve_assignees'
        ? { userIds: ['1'] }
        : page([task('a', { list: { id: 'l1' } })], 0, false),
    );
    await expect(fetchClickUpSignals(tools, { nowMs: now, horizonDays: 1 })).rejects.toThrow(
      /Unexpected response from f_filter_tasks: tasks\.0\.list\.name/,
    );
  });

  it('fails when the assignee lookup returns no id', async () => {
    const tools = fakeTools(['f_filter_tasks', 'r_resolve_assignees'], () => ({ userIds: [] }));
    await expect(fetchClickUpSignals(tools, { nowMs: now, horizonDays: 1 })).rejects.toThrow(
      /Unexpected response from r_resolve_assignees/,
    );
  });
});
