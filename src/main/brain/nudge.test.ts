import { describe, expect, it } from 'vitest';

import type { NudgeRecord, SilenceWindow } from '../../shared/nudges';
import type { Meeting, Signal } from '../../shared/signals';
import { meetingWindows } from './meetings';
import { RULES, decideNudges } from './nudge';
import type { NudgeInput } from './nudge';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const now = Date.UTC(2026, 8, 2, 10);
const midnight = Date.UTC(2026, 8, 2);
const dueSoonMs = 30 * minute;
const meetingWarnMs = 10 * minute;

function sig(id: string, dueAt: number): Signal {
  return {
    id: `clickup:${id}`,
    source: 'clickup',
    kind: 'task-due',
    title: id,
    dueAt,
    url: `https://app.clickup.com/t/${id}`,
    status: 'to do',
    listName: 'Inbox',
  };
}

function meetingSig(id: string, dueAt: number, overrides: Partial<Meeting> = {}): Signal {
  return {
    id: `outlook:${id}`,
    source: 'outlook',
    kind: 'meeting',
    title: id,
    dueAt,
    url: `https://outlook.office.com/calendar/item/${id}`,
    status: 'confirmed',
    listName: 'Calendar',
    meeting: {
      endsAt: dueAt + 30 * minute,
      accepted: true,
      allDay: false,
      organizer: 'boss@example.com',
      busy: true,
      ...overrides,
    },
  };
}

function record(
  id: string,
  kind: NudgeRecord['kind'],
  at: number,
  source: 'clickup' | 'outlook' = 'clickup',
): NudgeRecord {
  return { signalId: `${source}:${id}`, kind, at };
}

function decide(overrides: Partial<NudgeInput>) {
  return decideNudges({
    signals: [],
    nowMs: now,
    history: [],
    silence: [],
    budget: { maxPerHour: 10, maxPerDay: 100 },
    dueSoonMs,
    meetingWarnMs,
    tzOffsetMinutes: 0,
    ...overrides,
  });
}

const kinds = (input: Partial<NudgeInput>) =>
  decide(input).nudges.map((n) => [n.signalId, n.kind, n.urgency, n.minutesLeft, n.repeat]);

describe('RULES', () => {
  it('has one row per kind in priority order', () => {
    expect(RULES.map((r) => r.kind)).toEqual([
      'due-now',
      'due-soon',
      'overdue',
      'due-today',
      'meeting-now',
      'meeting-soon',
    ]);
  });

  it('gates task rules to task-due signals and meeting rules to meeting signals', () => {
    const taskRules = RULES.filter((r) => r.kind.startsWith('due') || r.kind === 'overdue');
    const meetingRules = RULES.filter((r) => r.kind.startsWith('meeting'));
    expect(taskRules.every((r) => r.signalKind === 'task-due')).toBe(true);
    expect(meetingRules.every((r) => r.signalKind === 'meeting')).toBe(true);
  });
});

describe('decideNudges rules', () => {
  it('returns nothing for empty input', () => {
    expect(decide({})).toEqual({ nudges: [], silenced: [], overBudget: [] });
  });

  it('due-now: within the last minute, urgent, once', () => {
    expect(kinds({ signals: [sig('a', now - 30_000)] })).toEqual([
      ['clickup:a', 'due-now', 'urgent', 0, 0],
    ]);
    expect(kinds({ signals: [sig('a', now)] })).toEqual([['clickup:a', 'due-now', 'urgent', 0, 0]]);
    expect(
      kinds({ signals: [sig('a', now)], history: [record('a', 'due-now', now - 20_000)] }),
    ).toEqual([]);
  });

  it('due-soon: inside the warning window, normal, once', () => {
    expect(kinds({ signals: [sig('a', now + 10 * minute)] })).toEqual([
      ['clickup:a', 'due-soon', 'normal', 10, 0],
    ]);
    expect(kinds({ signals: [sig('a', now + dueSoonMs)] })).toEqual([
      ['clickup:a', 'due-soon', 'normal', 30, 0],
    ]);
    expect(
      kinds({
        signals: [sig('a', now + 10 * minute)],
        history: [record('a', 'due-soon', now - 5 * minute)],
      }),
    ).toEqual([]);
  });

  it('overdue: a minute or more past due, normal', () => {
    expect(kinds({ signals: [sig('a', now - minute)] })).toEqual([
      ['clickup:a', 'overdue', 'normal', -1, 0],
    ]);
    expect(kinds({ signals: [sig('a', now - 3 * day)] })).toEqual([
      ['clickup:a', 'overdue', 'normal', -3 * 24 * 60, 0],
    ]);
  });

  it('overdue: escalates at 1 h, then 4 h, then every 24 h', () => {
    const signals = [sig('a', now - 5 * day)];

    const first = [record('a', 'overdue', now - hour + 1)];
    expect(decide({ signals, history: first }).nudges).toEqual([]);
    expect(
      decide({ signals, history: [record('a', 'overdue', now - hour)] }).nudges[0]?.repeat,
    ).toBe(1);

    const second = [
      record('a', 'overdue', now - 6 * hour),
      record('a', 'overdue', now - 4 * hour + 1),
    ];
    expect(decide({ signals, history: second }).nudges).toEqual([]);
    second[1] = record('a', 'overdue', now - 4 * hour);
    expect(decide({ signals, history: second }).nudges[0]?.repeat).toBe(2);

    const third = [
      record('a', 'overdue', now - 3 * day),
      record('a', 'overdue', now - 2 * day),
      record('a', 'overdue', now - day + 1),
    ];
    expect(decide({ signals, history: third }).nudges).toEqual([]);
    third[2] = record('a', 'overdue', now - day);
    expect(decide({ signals, history: third }).nudges[0]?.repeat).toBe(3);

    const fifth = [
      ...third,
      record('a', 'overdue', now - 2 * day),
      record('a', 'overdue', now - day),
    ];
    expect(decide({ signals, history: fifth }).nudges[0]?.repeat).toBe(5);
  });

  it('overdue: ignores tasks more than 14 days late', () => {
    expect(kinds({ signals: [sig('a', now - 14 * day)] })).toEqual([]);
    expect(kinds({ signals: [sig('a', now - 14 * day + 1)] })).toEqual([
      ['clickup:a', 'overdue', 'normal', -14 * 24 * 60, 0],
    ]);
  });

  it('due-today: later today beyond the warning window, low, once per local day', () => {
    const signals = [sig('a', now + 5 * hour)];
    expect(kinds({ signals })).toEqual([['clickup:a', 'due-today', 'low', 300, 0]]);
    expect(kinds({ signals, history: [record('a', 'due-today', midnight)] })).toEqual([]);
    expect(kinds({ signals, history: [record('a', 'due-today', midnight - 1)] })).toEqual([
      ['clickup:a', 'due-today', 'low', 300, 1],
    ]);
  });

  it('due-today: not for tomorrow, and local midnight follows the offset', () => {
    expect(kinds({ signals: [sig('a', midnight + day)] })).toEqual([]);
    expect(kinds({ signals: [sig('a', midnight + day - 1)] })).toEqual([
      ['clickup:a', 'due-today', 'low', 840, 0],
    ]);
    // UTC-3: local midnight is at 03:00 UTC, so 02:00 UTC tomorrow is still today.
    expect(kinds({ signals: [sig('a', midnight + day + 2 * hour)], tzOffsetMinutes: 180 })).toEqual(
      [['clickup:a', 'due-today', 'low', 960, 0]],
    );
  });

  it('due-now beats due-soon beats due-today', () => {
    expect(kinds({ signals: [sig('a', now)] }).map((r) => r[1])).toEqual(['due-now']);
    expect(kinds({ signals: [sig('a', now + 1)] }).map((r) => r[1])).toEqual(['due-soon']);
    expect(kinds({ signals: [sig('a', now + dueSoonMs + 1)] }).map((r) => r[1])).toEqual([
      'due-today',
    ]);
  });
});

describe('decideNudges meeting rules', () => {
  it('meeting-now: within the last minute, urgent, once', () => {
    expect(kinds({ signals: [meetingSig('a', now - 30_000)] })).toEqual([
      ['outlook:a', 'meeting-now', 'urgent', 0, 0],
    ]);
    expect(kinds({ signals: [meetingSig('a', now)] })).toEqual([
      ['outlook:a', 'meeting-now', 'urgent', 0, 0],
    ]);
    expect(
      kinds({
        signals: [meetingSig('a', now)],
        history: [record('a', 'meeting-now', now - 20_000, 'outlook')],
      }),
    ).toEqual([]);
  });

  it('meeting-soon: inside the warning window, normal, once', () => {
    expect(kinds({ signals: [meetingSig('a', now + 5 * minute)] })).toEqual([
      ['outlook:a', 'meeting-soon', 'normal', 5, 0],
    ]);
    expect(kinds({ signals: [meetingSig('a', now + meetingWarnMs)] })).toEqual([
      ['outlook:a', 'meeting-soon', 'normal', meetingWarnMs / minute, 0],
    ]);
    expect(
      kinds({
        signals: [meetingSig('a', now + 5 * minute)],
        history: [record('a', 'meeting-soon', now - 2 * minute, 'outlook')],
      }),
    ).toEqual([]);
  });

  it('meeting-soon never matches when meetingWarnMs is 0, only meeting-now', () => {
    expect(kinds({ signals: [meetingSig('a', now + minute)], meetingWarnMs: 0 })).toEqual([]);
    expect(kinds({ signals: [meetingSig('a', now)], meetingWarnMs: 0 })).toEqual([
      ['outlook:a', 'meeting-now', 'urgent', 0, 0],
    ]);
  });

  it('skips a meeting that is all day', () => {
    expect(kinds({ signals: [meetingSig('a', now, { allDay: true })] })).toEqual([]);
    expect(kinds({ signals: [meetingSig('a', now + 5 * minute, { allDay: true })] })).toEqual([]);
  });

  it('skips a meeting that was declined or never answered', () => {
    expect(kinds({ signals: [meetingSig('a', now, { accepted: false })] })).toEqual([]);
    expect(
      kinds({ signals: [meetingSig('a', now + 5 * minute, { accepted: false })] }),
    ).toEqual([]);
  });

  it('still warns for a meeting marked free rather than busy', () => {
    expect(kinds({ signals: [meetingSig('a', now + 5 * minute, { busy: false })] })).toEqual([
      ['outlook:a', 'meeting-soon', 'normal', 5, 0],
    ]);
  });

  it('a task signal never matches the meeting rules', () => {
    expect(kinds({ signals: [sig('a', now)] }).map((r) => r[1])).toEqual(['due-now']);
  });
});

describe('decideNudges ordering', () => {
  it('sorts urgent, normal, low, then by dueAt', () => {
    const out = decide({
      signals: [
        sig('today-late', now + 6 * hour),
        sig('soon-b', now + 20 * minute),
        sig('overdue', now - 10 * minute),
        sig('now', now),
        sig('soon-a', now + 5 * minute),
        sig('today-early', now + 2 * hour),
      ],
      budget: { maxPerHour: 10, maxPerDay: 10 },
    });
    const all = [...out.nudges, ...out.overBudget].map((n) => n.title);
    expect(all).toEqual(['now', 'overdue', 'soon-a', 'soon-b', 'today-early', 'today-late']);
    expect(out.nudges).toHaveLength(3);
  });
});

describe('decideNudges silence', () => {
  const quiet: SilenceWindow = {
    from: now - hour,
    to: now + hour,
    source: 'quiet-hours',
    allowUrgent: true,
  };
  const snooze: SilenceWindow = {
    from: now - minute,
    to: now + minute,
    source: 'snooze',
    allowUrgent: false,
  };

  it('moves normal nudges aside but lets urgent through quiet hours', () => {
    const out = decide({ signals: [sig('now', now), sig('soon', now + minute)], silence: [quiet] });
    expect(out.nudges.map((n) => n.title)).toEqual(['now']);
    expect(out.silenced.map((n) => n.title)).toEqual(['soon']);
  });

  it('a snooze blocks urgent too', () => {
    const out = decide({ signals: [sig('now', now)], silence: [quiet, snooze] });
    expect(out.nudges).toEqual([]);
    expect(out.silenced.map((n) => n.title)).toEqual(['now']);
  });

  it('silenced nudges do not consume budget', () => {
    const out = decide({
      signals: [sig('soon', now + minute), sig('now', now)],
      silence: [quiet],
      budget: { maxPerHour: 1, maxPerDay: 1 },
    });
    expect(out.nudges.map((n) => n.title)).toEqual(['now']);
    expect(out.overBudget).toEqual([]);
  });

  it('a meeting window silences a normal task nudge but lets an urgent one through', () => {
    const meeting = meetingSig('standup', now - 5 * minute, { endsAt: now + 25 * minute });
    const windows = meetingWindows([meeting], { enabled: true });
    const out = decide({
      signals: [sig('urgent-task', now), sig('normal-task', now + 10 * minute)],
      silence: windows,
    });
    expect(out.nudges.map((n) => n.title)).toEqual(['urgent-task']);
    expect(out.silenced.map((n) => n.title)).toEqual(['normal-task']);
  });
});

describe('decideNudges budget', () => {
  const signals = [sig('a', now), sig('b', now + 30_000), sig('c', now + minute)];

  it('caps per hour counting history and nudges accepted now', () => {
    const out = decide({
      signals,
      history: [
        record('x', 'due-soon', now - 59 * minute),
        record('y', 'due-soon', now - 61 * minute),
      ],
      budget: { maxPerHour: 2, maxPerDay: 100 },
    });
    expect(out.nudges.map((n) => n.title)).toEqual(['a']);
    expect(out.overBudget.map((n) => n.title)).toEqual(['b', 'c']);
  });

  it('caps per day counting history and nudges accepted now', () => {
    const out = decide({
      signals,
      history: [record('x', 'due-soon', now - 20 * hour), record('y', 'due-soon', now - 25 * hour)],
      budget: { maxPerHour: 100, maxPerDay: 3 },
    });
    expect(out.nudges.map((n) => n.title)).toEqual(['a', 'b']);
    expect(out.overBudget.map((n) => n.title)).toEqual(['c']);
  });

  it('applies the hard cap to urgent nudges as well', () => {
    const out = decide({ signals, budget: { maxPerHour: 0, maxPerDay: 100 } });
    expect(out.nudges).toEqual([]);
    expect(out.overBudget).toHaveLength(3);
  });

  it('shows at most three per decision', () => {
    const out = decide({
      signals: [...signals, sig('d', now + 2 * minute), sig('e', now + 3 * minute)],
    });
    expect(out.nudges).toHaveLength(3);
    expect(out.overBudget.map((n) => n.title)).toEqual(['d', 'e']);
  });
});
