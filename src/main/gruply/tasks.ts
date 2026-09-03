import { z } from 'zod';

import type { Signal } from '../../shared/signals';
import type { GruplyClient } from './client';

const envelopeSchema = z.looseObject({
  data: z.array(z.unknown()),
  totalPages: z.number().optional(),
});

const projectSchema = z.looseObject({
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  status: z.string(),
});

const statusSchema = z.looseObject({
  name: z.string(),
  category: z.string().optional(),
});

const assigneeSchema = z.looseObject({
  email: z.string().optional(),
});

const taskSchema = z.looseObject({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  due_date: z.string().nullable(),
  completed_at: z.string().nullable().optional(),
  updated_at: z.string().optional(),
  status: statusSchema,
  assignees: z.array(z.unknown()).optional(),
  is_deleted: z.boolean().optional(),
});

type Project = z.infer<typeof projectSchema>;
type Task = z.infer<typeof taskSchema>;

export interface FetchOptions {
  nowMs: number;
  email: string;
  pastDays?: number;
  horizonDays?: number;
  maxProjects?: number;
  concurrency?: number;
}

const DAY_MS = 86_400_000;
const DEFAULT_PAST_DAYS = 30;
const DEFAULT_HORIZON_DAYS = 14;
// There is no endpoint that lists a user's tasks directly, so every sync walks active projects
// and asks each one for its tasks. These caps keep that walk from turning into a hundred
// requests when the workspace grows.
const DEFAULT_MAX_PROJECTS = 40;
const DEFAULT_CONCURRENCY = 4;
// A generous but finite bound on pagination, in case a broken totalPages value would otherwise
// loop forever.
const MAX_PAGES = 10;

// A category name that reads as "done" in some form; the API does not document the possible
// category values, so this is a best guess pending a real example of a closed task's status.
const DONE_CATEGORY_HINTS = ['done', 'complete', 'closed'];

function isDoneCategory(category: string | undefined): boolean {
  if (category === undefined) return false;
  const c = category.toLowerCase();
  return DONE_CATEGORY_HINTS.some((hint) => c.includes(hint));
}

function hasAssignee(rawAssignees: unknown[] | undefined, email: string): boolean {
  if (rawAssignees === undefined) return false;
  return rawAssignees.some((raw) => {
    const parsed = assigneeSchema.safeParse(raw);
    return parsed.success && parsed.data.email?.toLowerCase() === email;
  });
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const queue = items.map((item, index) => ({ item, index }));
  const results = new Array<R>(items.length);
  async function worker(): Promise<void> {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;
      results[next.index] = await fn(next.item);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function fetchActiveProjects(
  client: GruplyClient,
  maxProjects: number,
  onSkip: () => void,
): Promise<Project[]> {
  const projects: Project[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const raw = await client.get<unknown>('/projects', {
      perPage: '100',
      status: 'active',
      page: String(page),
    });
    const parsedPage = envelopeSchema.safeParse(raw);
    if (!parsedPage.success) throw new Error('unexpected response from Gruply projects');
    for (const item of parsedPage.data.data) {
      const parsed = projectSchema.safeParse(item);
      if (!parsed.success) {
        onSkip();
        continue;
      }
      projects.push(parsed.data);
      if (projects.length >= maxProjects) return projects;
    }
    const totalPages = parsedPage.data.totalPages ?? page;
    if (page >= totalPages || parsedPage.data.data.length === 0) break;
  }
  return projects;
}

function toSignal(
  project: Project,
  task: Task,
  windowStart: number,
  windowEnd: number,
): Signal | undefined {
  if (task.due_date === null) return undefined;
  const dueAt = Date.parse(task.due_date);
  if (!Number.isFinite(dueAt) || dueAt < windowStart || dueAt > windowEnd) return undefined;

  const completedAt = task.completed_at == null ? undefined : Date.parse(task.completed_at);
  const updatedAt = task.updated_at === undefined ? undefined : Date.parse(task.updated_at);
  // completed_at is the real signal that a task closed. When only the status category looks
  // done and completed_at is missing, updated_at is the closest thing to a closing time the
  // API offers, so it stands in rather than leaving a done task without a closedAt.
  const closedAt =
    completedAt !== undefined && Number.isFinite(completedAt)
      ? completedAt
      : isDoneCategory(task.status.category) &&
          updatedAt !== undefined &&
          Number.isFinite(updatedAt)
        ? updatedAt
        : undefined;

  return {
    id: `gruply:${task.id}`,
    source: 'gruply',
    kind: 'task-due',
    dueAt,
    title: task.title,
    // The API returns no web link for a task, so this URL is assembled from the project and
    // task ids and may need adjusting once the real app routes are confirmed.
    url: `https://app.gruply.com.br/projects/${String(project.id)}/tasks/${String(task.id)}`,
    status: task.status.name,
    listName: project.name,
    ...(closedAt !== undefined ? { closedAt } : {}),
  };
}

async function fetchProjectTaskSignals(
  client: GruplyClient,
  project: Project,
  email: string,
  windowStart: number,
  windowEnd: number,
  onSkip: () => void,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let raw: unknown;
    try {
      raw = await client.get<unknown>(`/projects/${String(project.id)}/tasks`, {
        perPage: '100',
        page: String(page),
      });
    } catch {
      // A project the key cannot read, or one request that times out, costs that project only.
      // Throwing here would drop the tasks already collected from every other project.
      onSkip();
      break;
    }
    const parsedPage = envelopeSchema.safeParse(raw);
    if (!parsedPage.success) {
      // One project with an unexpected shape should not sink the tasks already found in every
      // other project, so it is counted and skipped rather than thrown.
      onSkip();
      break;
    }
    for (const item of parsedPage.data.data) {
      const parsed = taskSchema.safeParse(item);
      if (!parsed.success) {
        onSkip();
        continue;
      }
      const task = parsed.data;
      if (task.is_deleted === true) continue;
      if (!hasAssignee(task.assignees, email)) continue;
      const signal = toSignal(project, task, windowStart, windowEnd);
      if (signal !== undefined) signals.push(signal);
    }
    const totalPages = parsedPage.data.totalPages ?? page;
    if (page >= totalPages || parsedPage.data.data.length === 0) break;
  }
  return signals;
}

export async function fetchGruplySignals(
  client: GruplyClient,
  opts: FetchOptions,
): Promise<Signal[]> {
  const pastDays = opts.pastDays ?? DEFAULT_PAST_DAYS;
  const horizonDays = opts.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const maxProjects = opts.maxProjects ?? DEFAULT_MAX_PROJECTS;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const email = opts.email.trim().toLowerCase();

  let skipped = 0;
  const projects = await fetchActiveProjects(client, maxProjects, () => {
    skipped += 1;
  });

  const windowStart = opts.nowMs - pastDays * DAY_MS;
  const windowEnd = opts.nowMs + horizonDays * DAY_MS;
  const perProject = await mapWithConcurrency(projects, concurrency, (project) =>
    fetchProjectTaskSignals(client, project, email, windowStart, windowEnd, () => {
      skipped += 1;
    }),
  );

  if (skipped > 0) {
    console.warn(`gruply: skipped ${skipped} records that did not match the schema`);
  }
  return perProject.flat();
}
