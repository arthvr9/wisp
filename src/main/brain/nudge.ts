import type {
  Nudge,
  NudgeBudget,
  NudgeKind,
  NudgeRecord,
  SilenceWindow,
  Urgency,
} from '../../shared/nudges';
import type { Signal } from '../../shared/signals';
import { DAY_MS, MINUTE_MS, activeSilence, localDayStart } from './silence';

export interface NudgeInput {
  signals: Signal[];
  nowMs: number;
  history: NudgeRecord[];
  silence: SilenceWindow[];
  budget: NudgeBudget;
  dueSoonMs: number;
  tzOffsetMinutes?: number;
}

export interface NudgeDecision {
  nudges: Nudge[];
  silenced: Nudge[];
  overBudget: Nudge[];
}

export interface RuleContext {
  delta: number;
  nowMs: number;
  dueAt: number;
  dueSoonMs: number;
  dayStart: number;
  dayEnd: number;
}

export interface NudgeRule {
  kind: NudgeKind;
  urgency: Urgency;
  matches: (ctx: RuleContext) => boolean;
  allow: (ctx: RuleContext, previous: NudgeRecord[]) => boolean;
}

export const DUE_NOW_WINDOW_MS = MINUTE_MS;
export const STALE_OVERDUE_MS = 14 * DAY_MS;
export const OVERDUE_SPACING_MS: readonly number[] = [60 * MINUTE_MS, 4 * 60 * MINUTE_MS];
export const OVERDUE_REPEAT_MS = DAY_MS;
export const MAX_NUDGES_PER_DECISION = 3;

const HOUR_MS = 60 * MINUTE_MS;

const once = (_ctx: RuleContext, previous: NudgeRecord[]) => previous.length === 0;

function overdueAllowed(ctx: RuleContext, previous: NudgeRecord[]): boolean {
  const last = previous[previous.length - 1];
  if (last === undefined) return true;
  const spacing = OVERDUE_SPACING_MS[previous.length - 1] ?? OVERDUE_REPEAT_MS;
  return ctx.nowMs - last.at >= spacing;
}

export const RULES: readonly NudgeRule[] = [
  {
    kind: 'due-now',
    urgency: 'urgent',
    matches: ({ delta }) => delta > -DUE_NOW_WINDOW_MS && delta <= 0,
    allow: once,
  },
  {
    kind: 'due-soon',
    urgency: 'normal',
    matches: ({ delta, dueSoonMs }) => delta > 0 && delta <= dueSoonMs,
    allow: once,
  },
  {
    kind: 'overdue',
    urgency: 'normal',
    matches: ({ delta }) => delta <= -DUE_NOW_WINDOW_MS && delta > -STALE_OVERDUE_MS,
    allow: overdueAllowed,
  },
  {
    kind: 'due-today',
    urgency: 'low',
    matches: ({ delta, dueSoonMs, dueAt, dayEnd }) => delta > dueSoonMs && dueAt < dayEnd,
    allow: (ctx, previous) => !previous.some((r) => r.at >= ctx.dayStart),
  },
];

const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, normal: 1, low: 2 };

function byPriority(a: Nudge, b: Nudge): number {
  return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.dueAt - b.dueAt;
}

function wanted(signal: Signal, input: NudgeInput, dayStart: number): Nudge | undefined {
  const ctx: RuleContext = {
    delta: signal.dueAt - input.nowMs,
    nowMs: input.nowMs,
    dueAt: signal.dueAt,
    dueSoonMs: input.dueSoonMs,
    dayStart,
    dayEnd: dayStart + DAY_MS,
  };
  const rule = RULES.find((r) => r.matches(ctx));
  if (rule === undefined) return undefined;

  const previous = input.history
    .filter((r) => r.signalId === signal.id && r.kind === rule.kind)
    .sort((a, b) => a.at - b.at);
  if (!rule.allow(ctx, previous)) return undefined;

  const minutesLeft = Math.round(ctx.delta / MINUTE_MS);
  return {
    signalId: signal.id,
    kind: rule.kind,
    urgency: rule.urgency,
    title: signal.title,
    url: signal.url,
    dueAt: signal.dueAt,
    minutesLeft: minutesLeft === 0 ? 0 : minutesLeft,
    repeat: previous.length,
  };
}

function countSince(history: NudgeRecord[], sinceMs: number): number {
  return history.filter((r) => r.at > sinceMs).length;
}

export function decideNudges(input: NudgeInput): NudgeDecision {
  const tz = input.tzOffsetMinutes ?? new Date(input.nowMs).getTimezoneOffset();
  const dayStart = localDayStart(input.nowMs, tz);
  const candidates = input.signals
    .map((s) => wanted(s, input, dayStart))
    .filter((n): n is Nudge => n !== undefined)
    .sort(byPriority);

  let inHour = countSince(input.history, input.nowMs - HOUR_MS);
  let inDay = countSince(input.history, input.nowMs - DAY_MS);
  const decision: NudgeDecision = { nudges: [], silenced: [], overBudget: [] };

  for (const nudge of candidates) {
    if (activeSilence(input.silence, input.nowMs, nudge.urgency) !== undefined) {
      decision.silenced.push(nudge);
      continue;
    }
    const underCap =
      inHour < input.budget.maxPerHour &&
      inDay < input.budget.maxPerDay &&
      decision.nudges.length < MAX_NUDGES_PER_DECISION;
    if (!underCap) {
      decision.overBudget.push(nudge);
      continue;
    }
    decision.nudges.push(nudge);
    inHour += 1;
    inDay += 1;
  }
  return decision;
}
