import { describe, expect, it } from 'vitest';

import { MOODS } from '../../shared/mood';
import type { MoodEvent, MoodEventKind } from '../../shared/mood';
import type { NudgeBudget } from '../../shared/nudges';
import {
  DEJECTED_DECAY_MS,
  MIN_DWELL_MS,
  RECENCY_MS,
  initialMood,
  moodBudget,
  moodModifiers,
  moodOf,
  recordEvents,
  stepMood,
} from './mood';
import type { MoodState } from './mood';

const HOUR = 60 * 60 * 1000;

function events(kind: MoodEventKind, count: number, at: number): MoodEvent[] {
  return Array.from({ length: count }, () => ({ kind, at }));
}

describe('recordEvents', () => {
  it('appends and keeps events sorted by time', () => {
    let s = recordEvents(initialMood, [{ kind: 'task-done', at: 500 }]);
    s = recordEvents(s, [
      { kind: 'nudge-shown', at: 100 },
      { kind: 'quiet-hour', at: 900 },
    ]);
    expect(s.events.map((e) => e.at)).toEqual([100, 500, 900]);
  });

  it('returns the same state for no events', () => {
    expect(recordEvents(initialMood, [])).toBe(initialMood);
  });
});

describe('stepMood', () => {
  it('starts calm', () => {
    expect(moodOf(initialMood)).toBe('calm');
  });

  it('climbs one step per call and respects the dwell time', () => {
    const t0 = 10 * HOUR;
    let s = recordEvents(initialMood, events('task-done', 6, t0));
    s = stepMood(s, t0);
    expect(s.level).toBe(4);
    expect(s.since).toBe(t0);
    s = stepMood(s, t0 + MIN_DWELL_MS / 2);
    expect(s.level).toBe(4);
    s = stepMood(s, t0 + MIN_DWELL_MS);
    expect(s.level).toBe(5);
    expect(s.since).toBe(t0 + MIN_DWELL_MS);
    expect(moodOf(s)).toBe('elated');
  });

  it('cannot jump two steps at once after a burst of completions', () => {
    const s = recordEvents(initialMood, events('task-done', 20, 0));
    expect(stepMood(s, 0).level).toBe(4);
  });

  it('descends one step at a time under pressure', () => {
    let s = recordEvents(initialMood, events('overdue-new', 5, 0));
    s = stepMood(s, 0);
    expect(s.level).toBe(2);
    s = stepMood(s, MIN_DWELL_MS);
    expect(s.level).toBe(1);
    s = stepMood(s, 2 * MIN_DWELL_MS);
    expect(s.level).toBe(0);
    expect(moodOf(s)).toBe('dejected');
  });

  it('drops events outside the recency window', () => {
    const s = recordEvents(initialMood, [
      ...events('task-done', 3, 0),
      { kind: 'nudge-shown', at: RECENCY_MS },
    ]);
    const stepped = stepMood(s, RECENCY_MS);
    expect(stepped.events).toEqual([{ kind: 'nudge-shown', at: RECENCY_MS }]);
    expect(stepped.level).toBe(3);
  });

  it('holds the level when the target matches', () => {
    const s: MoodState = { level: 3, since: 0, events: [] };
    expect(stepMood(s, HOUR)).toEqual(s);
  });

  it('decays from dejected after two quiet hours', () => {
    const negatives = events('overdue-new', 6, 0);
    const s: MoodState = { level: 0, since: 0, events: negatives };
    const before = stepMood(s, DEJECTED_DECAY_MS - 1);
    expect(before.level).toBe(0);
    const after = stepMood(s, DEJECTED_DECAY_MS);
    expect(after.level).toBe(1);
    expect(after.since).toBe(DEJECTED_DECAY_MS);
  });

  it('does not decay while a nudge was shown recently', () => {
    const s: MoodState = {
      level: 0,
      since: 0,
      events: [...events('overdue-new', 6, 0), { kind: 'nudge-shown', at: 3 * HOUR }],
    };
    expect(stepMood(s, 4 * HOUR).level).toBe(0);
  });

  it('is deterministic', () => {
    const s = recordEvents(initialMood, [
      ...events('task-done', 4, 0),
      ...events('nudge-shown', 2, 1000),
    ]);
    expect(stepMood(s, 5000)).toEqual(stepMood(s, 5000));
  });
});

describe('moodBudget', () => {
  const budgets: NudgeBudget[] = [
    { maxPerHour: 4, maxPerDay: 20 },
    { maxPerHour: 1, maxPerDay: 3 },
    { maxPerHour: 0, maxPerDay: 0 },
    { maxPerHour: 10, maxPerDay: 100 },
  ];

  it('never exceeds the input cap', () => {
    for (const mood of MOODS) {
      for (const budget of budgets) {
        const out = moodBudget(mood, budget);
        expect(out.maxPerHour).toBeLessThanOrEqual(budget.maxPerHour);
        expect(out.maxPerDay).toBeLessThanOrEqual(budget.maxPerDay);
      }
    }
  });

  it('leaves calm and the bright moods alone', () => {
    const budget = { maxPerHour: 4, maxPerDay: 20 };
    expect(moodBudget('calm', budget)).toEqual(budget);
    expect(moodBudget('cheerful', budget)).toEqual(budget);
    expect(moodBudget('elated', budget)).toEqual(budget);
  });

  it('withdraws as the mood darkens', () => {
    const budget = { maxPerHour: 4, maxPerDay: 20 };
    expect(moodBudget('uneasy', budget)).toEqual({ maxPerHour: 3, maxPerDay: 20 });
    expect(moodBudget('stressed', budget)).toEqual({ maxPerHour: 2, maxPerDay: 20 });
    expect(moodBudget('dejected', budget)).toEqual({ maxPerHour: 1, maxPerDay: 4 });
  });
});

describe('moodModifiers', () => {
  it('maps each mood to its expression and factors', () => {
    expect(moodModifiers('elated')).toEqual({
      expression: 'bright',
      speedFactor: 1.25,
      pauseFactor: 0.7,
    });
    expect(moodModifiers('cheerful')).toEqual({
      expression: 'bright',
      speedFactor: 1.1,
      pauseFactor: 0.85,
    });
    expect(moodModifiers('calm')).toEqual({ expression: 'plain', speedFactor: 1, pauseFactor: 1 });
    expect(moodModifiers('uneasy')).toEqual({
      expression: 'plain',
      speedFactor: 0.9,
      pauseFactor: 1.15,
    });
    expect(moodModifiers('stressed')).toEqual({
      expression: 'low',
      speedFactor: 0.75,
      pauseFactor: 1.4,
    });
    expect(moodModifiers('dejected')).toEqual({
      expression: 'low',
      speedFactor: 0.6,
      pauseFactor: 1.8,
    });
  });
});
