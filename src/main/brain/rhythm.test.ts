import { describe, expect, it } from 'vitest';

import { DEFAULT_RHYTHM, dayKey, initialRhythm, step } from './rhythm';
import type { RhythmState } from './rhythm';

// The suite runs with TZ pinned to UTC, so a local hour here is the hour in the string.
const at = (iso: string): number => new Date(iso).getTime();
const active = 0;
const away = DEFAULT_RHYTHM.awayMs + 1000;

const run = (state: RhythmState, iso: string, idleMs: number): ReturnType<typeof step> =>
  step(state, { nowMs: at(iso), idleMs });

describe('dayKey', () => {
  it('is the local calendar day', () => {
    expect(dayKey(at('2026-09-03T09:00:00Z'))).toBe('2026-09-03');
  });
});

describe('rhythm', () => {
  it('greets on the first look of the morning', () => {
    const r = run(initialRhythm, '2026-09-03T09:00:00Z', active);
    expect(r.event).toBe('morning');
  });

  it('greets once a day and again the next day', () => {
    const first = run(initialRhythm, '2026-09-03T09:00:00Z', active);
    expect(run(first.state, '2026-09-03T10:00:00Z', active).event).toBeUndefined();
    expect(run(first.state, '2026-09-04T09:00:00Z', active).event).toBe('morning');
  });

  it('does not greet in the afternoon when the machine was switched on late', () => {
    const r = run(initialRhythm, '2026-09-03T14:00:00Z', active);
    expect(r.event).toBeUndefined();
    // And the greeting must not surface later that same day either.
    expect(run(r.state, '2026-09-03T16:00:00Z', active).event).toBeUndefined();
  });

  it('still greets when the day starts before five', () => {
    const early = run(initialRhythm, '2026-09-03T03:00:00Z', active);
    expect(early.event).toBeUndefined();
    expect(run(early.state, '2026-09-03T07:00:00Z', active).event).toBe('morning');
  });

  it('welcomes you back after a long absence', () => {
    const gone = run(initialRhythm, '2026-09-03T14:00:00Z', away);
    const back = run(gone.state, '2026-09-03T14:40:00Z', active);
    expect(back.event).toBe('welcomeBack');
  });

  it('does not welcome you back for a short pause', () => {
    const paused = run(initialRhythm, '2026-09-03T14:00:00Z', 60_000);
    expect(run(paused.state, '2026-09-03T14:05:00Z', active).event).toBeUndefined();
  });

  it('treats the first return of the morning as arriving rather than returning', () => {
    const overnight = run(initialRhythm, '2026-09-03T06:00:00Z', away);
    expect(run(overnight.state, '2026-09-03T09:00:00Z', active).event).toBe('morning');
  });

  it('welcomes you back only once per absence', () => {
    const gone = run(initialRhythm, '2026-09-03T14:00:00Z', away);
    const back = run(gone.state, '2026-09-03T14:40:00Z', active);
    expect(run(back.state, '2026-09-03T14:41:00Z', active).event).toBeUndefined();
  });

  it('marks the end of the day once', () => {
    const evening = run(initialRhythm, '2026-09-03T18:30:00Z', active);
    expect(evening.event).toBe('endOfDay');
    expect(run(evening.state, '2026-09-03T19:30:00Z', active).event).toBeUndefined();
  });

  it('says something on a Friday afternoon before the end of the day', () => {
    // 2026-09-04 is a Friday.
    const opened = run(initialRhythm, '2026-09-04T14:00:00Z', active);
    const friday = run(opened.state, '2026-09-04T15:30:00Z', active);
    expect(friday.event).toBe('friday');
    expect(run(friday.state, '2026-09-04T18:30:00Z', active).event).toBe('endOfDay');
  });

  it('says nothing about Friday on a Thursday', () => {
    const opened = run(initialRhythm, '2026-09-03T14:00:00Z', active);
    expect(run(opened.state, '2026-09-03T15:30:00Z', active).event).toBeUndefined();
  });

  it('never returns the same event twice in one day whatever the order of the samples', () => {
    let state = initialRhythm;
    const seen: string[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const iso = `2026-09-04T${String(hour).padStart(2, '0')}:00:00Z`;
      for (const idle of [active, away, active]) {
        const r = step(state, { nowMs: at(iso), idleMs: idle });
        state = r.state;
        if (r.event !== undefined) seen.push(r.event);
      }
    }
    const once = seen.filter((e) => e !== 'welcomeBack');
    expect(new Set(once).size).toBe(once.length);
  });
});
