import { z } from 'zod';

import type { Signal } from '../../shared/signals';
import type { ToolCaller } from './tools';

const assigneesSchema = z.looseObject({ userIds: z.array(z.string()).min(1) });

const taskSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  url: z.string(),
  due_date: z.string().nullable(),
  date_closed: z.string().nullable().optional(),
  list: z.looseObject({ name: z.string() }),
});

const pageSchema = z.looseObject({
  tasks: z.array(taskSchema),
  has_more: z.boolean().optional(),
  next_page: z.number().nullable().optional(),
});

const maxPages = 10;
const overdueDays = 7;

function localDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function pick(names: string[], suffix: string): string | undefined {
  return names.find((n) => n.endsWith(suffix));
}

function unwrap(result: unknown): unknown {
  if (typeof result !== 'object' || result === null || !('content' in result)) return result;
  const content: unknown = result.content;
  if (!Array.isArray(content)) return result;
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const p = part as { type?: unknown; text?: unknown };
    if (p.type === 'text' && typeof p.text === 'string') {
      try {
        return JSON.parse(p.text);
      } catch {
        return result;
      }
    }
  }
  return result;
}

function parse<T>(schema: z.ZodType<T>, tool: string, raw: unknown): T {
  const r = schema.safeParse(unwrap(raw));
  if (r.success) return r.data;
  const issues = r.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || '<root>'}: ${i.message}`)
    .join('; ');
  throw new Error(`Unexpected response from ${tool}: ${issues}`);
}

export async function fetchClickUpSignals(
  tools: ToolCaller,
  opts: { nowMs: number; horizonDays: number },
): Promise<Signal[]> {
  const names = (await tools.listTools()).map((t) => t.name);
  const filterTasks = pick(names, 'filter_tasks');
  const resolveAssignees = pick(names, 'resolve_assignees');
  if (filterTasks === undefined || resolveAssignees === undefined) {
    const missing = [
      filterTasks === undefined ? 'filter_tasks' : undefined,
      resolveAssignees === undefined ? 'resolve_assignees' : undefined,
    ]
      .filter((n) => n !== undefined)
      .join(', ');
    throw new Error(
      `ClickUp MCP server lacks required tools (${missing}). Tools seen: ${
        names.length > 0 ? names.join(', ') : 'none'
      }`,
    );
  }

  const who = parse(
    assigneesSchema,
    resolveAssignees,
    await tools.callTool(resolveAssignees, { assignees: ['me'] }),
  );
  const userId = who.userIds[0];
  if (userId === undefined) throw new Error(`${resolveAssignees} returned no user id`);

  const from = localDate(shiftDays(opts.nowMs, -overdueDays));
  const to = localDate(shiftDays(opts.nowMs, opts.horizonDays));

  const signals: Signal[] = [];
  let page = 0;
  for (let i = 0; i < maxPages; i += 1) {
    const res = parse(
      pageSchema,
      filterTasks,
      await tools.callTool(filterTasks, {
        assignees: [userId],
        due_date_from: from,
        due_date_to: to,
        order_by: 'due_date',
        include_closed: true,
        page,
      }),
    );
    for (const t of res.tasks) {
      if (t.due_date === null) continue;
      const dueAt = Number(t.due_date);
      if (!Number.isFinite(dueAt)) continue;
      const closedAt = t.date_closed == null ? undefined : Number(t.date_closed);
      signals.push({
        ...(closedAt !== undefined && Number.isFinite(closedAt) ? { closedAt } : {}),
        id: `clickup:${t.id}`,
        source: 'clickup',
        kind: 'task-due',
        title: t.name,
        dueAt,
        url: t.url,
        status: t.status,
        listName: t.list.name,
      });
    }
    if (res.has_more !== true) break;
    page = res.next_page ?? page + 1;
  }
  return signals;
}
