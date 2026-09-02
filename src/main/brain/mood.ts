import { MOODS } from '../../shared/mood';
import type { Mood, MoodEvent, MoodEventKind, MoodModifiers } from '../../shared/mood';
import type { NudgeBudget } from '../../shared/nudges';

export interface MoodState {
  level: number;
  since: number;
  events: MoodEvent[];
}

export const initialMood: MoodState = { level: 3, since: 0, events: [] };

export const RECENCY_MS = 8 * 60 * 60 * 1000;
export const MIN_DWELL_MS = 20 * 60 * 1000;
export const DEJECTED_DECAY_MS = 2 * 60 * 60 * 1000;

const CALM_LEVEL = 3;
const TOP_LEVEL = MOODS.length - 1;

const WEIGHT: Record<MoodEventKind, number> = {
  'task-done': 2,
  'task-done-late': 1,
  'overdue-new': -2,
  'nudge-shown': -1,
  'quiet-hour': 1,
};

const MODIFIERS: Record<Mood, MoodModifiers> = {
  dejected: { expression: 'low', speedFactor: 0.6, pauseFactor: 1.8 },
  stressed: { expression: 'low', speedFactor: 0.75, pauseFactor: 1.4 },
  uneasy: { expression: 'plain', speedFactor: 0.9, pauseFactor: 1.15 },
  calm: { expression: 'plain', speedFactor: 1, pauseFactor: 1 },
  cheerful: { expression: 'bright', speedFactor: 1.1, pauseFactor: 0.85 },
  elated: { expression: 'bright', speedFactor: 1.25, pauseFactor: 0.7 },
};

export function recordEvents(state: MoodState, events: MoodEvent[]): MoodState {
  if (events.length === 0) return state;
  const merged = [...state.events, ...events].sort((a, b) => a.at - b.at);
  return { ...state, events: merged };
}

function negative(event: MoodEvent): boolean {
  return WEIGHT[event.kind] < 0;
}

function targetLevel(events: MoodEvent[]): number {
  const score = events.reduce((sum, e) => sum + WEIGHT[e.kind], 0);
  return Math.min(Math.max(CALM_LEVEL + Math.round(score / 3), 0), TOP_LEVEL);
}

export function stepMood(state: MoodState, nowMs: number): MoodState {
  const events = state.events.filter((e) => nowMs - e.at < RECENCY_MS);
  const rested = { ...state, events };
  const settled = state.since === 0 || nowMs - state.since >= MIN_DWELL_MS;
  if (!settled) return rested;

  const quiet = events.every((e) => !negative(e) || nowMs - e.at >= DEJECTED_DECAY_MS);
  if (state.level === 0 && quiet) return { ...rested, level: 1, since: nowMs };

  const target = targetLevel(events);
  if (target === state.level) return rested;
  const level = state.level + Math.sign(target - state.level);
  return { ...rested, level, since: nowMs };
}

export function moodOf(state: MoodState): Mood {
  return MOODS[Math.min(Math.max(state.level, 0), TOP_LEVEL)] ?? 'calm';
}

function within(cap: number, value: number): number {
  return Math.min(cap, Math.max(1, value));
}

export function moodBudget(mood: Mood, budget: NudgeBudget): NudgeBudget {
  const hour = budget.maxPerHour;
  switch (mood) {
    case 'uneasy':
      return { ...budget, maxPerHour: within(hour, Math.floor(hour * 0.75)) };
    case 'stressed':
      return { ...budget, maxPerHour: within(hour, Math.floor(hour / 2)) };
    case 'dejected':
      return { maxPerHour: within(hour, 1), maxPerDay: Math.min(budget.maxPerDay, 4) };
    case 'calm':
    case 'cheerful':
    case 'elated':
      return budget;
  }
}

export function moodModifiers(mood: Mood): MoodModifiers {
  return MODIFIERS[mood];
}
