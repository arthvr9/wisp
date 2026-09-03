import { describe, expect, it } from 'vitest';

import type { MoodModifiers } from '../../shared/mood';
import {
  ALERT_MS,
  ARRIVE_PX,
  CELEBRATE_MS,
  DEFAULT_IDLE_MS,
  IDLE_MS,
  PET_MS,
  SIT_MS,
  SLEEP_AFTER_MS,
  STARTLE_MS,
  WALK_SPEED_PX_S,
  WALK_TIMEOUT_MS,
  createActor,
  reduce,
} from './actor';
import type { ActorAction, ActorState, Cursor, Rng } from './actor';
import { FLING_HARD_PX_S, groundY } from './movement';
import type { DisplayArea, Target } from './movement';
import { EDGE_PX, LOOK_MS, ROOST_MS, usableRange } from './roost';

const primary: DisplayArea = { id: 1, x: 0, y: 0, width: 1920, height: 1080 };
const tallRight: DisplayArea = { id: 2, x: 1920, y: 0, width: 1080, height: 1920 };
const size = 96;
const one: Target = { displays: [primary], width: size, height: size };
const two: Target = { displays: [primary, tallRight], width: size, height: size };

const still: Cursor = { displayId: 1, idleMs: 0 };

function fixed(value: number): Rng {
  return () => value;
}

function sequence(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

function tick(
  state: ActorState,
  target: Target,
  dtMs: number,
  rng: Rng = fixed(0),
  cursor: Cursor = still,
  follow = false,
  mood?: MoodModifiers,
): ActorState {
  const action: ActorAction = { type: 'tick', dtMs, rng, cursor, followCursor: follow, mood };
  return reduce(state, action, target);
}

function run(
  state: ActorState,
  target: Target,
  totalMs: number,
  dtMs: number,
  rng: Rng = fixed(0),
  cursor: Cursor = still,
  follow = false,
  mood?: MoodModifiers,
): ActorState {
  let s = state;
  for (let t = 0; t < totalMs; t += dtMs) s = tick(s, target, dtMs, rng, cursor, follow, mood);
  return s;
}

function grounded(displayId = 1, x = 500): ActorState {
  const display = displayId === 1 ? primary : tallRight;
  return createActor(displayId, x, groundY(display, size));
}

describe('createActor', () => {
  it('starts idle, facing right, unpaused', () => {
    const s = createActor(1, 10, 20);
    expect(s.pose).toBe('idle');
    expect(s.facing).toBe('right');
    expect(s.paused).toBe(false);
    expect(s.poseUntilMs).toBe(DEFAULT_IDLE_MS);
  });
});

describe('idle to walk', () => {
  it('picks a destination on the current display instead of a duration', () => {
    const rng = fixed(0.5);
    const start = { ...grounded(), poseUntilMs: 1000 };
    const s = tick(start, one, 1000, rng);
    expect(s.pose).toBe('walk');
    expect(s.spot?.displayId).toBe(1);
    expect(s.legX).toBeDefined();
    // The only timer on a walk is the cap that catches a destination it cannot reach.
    expect(s.poseUntilMs).toBe(WALK_TIMEOUT_MS);
  });

  it('goes to sit for a roll between 0.65 and 0.9', () => {
    const start = { ...grounded(), poseUntilMs: 1000 };
    expect(tick(start, one, 1000, fixed(0.7)).pose).toBe('sit');
    expect(tick(start, one, 1000, fixed(0.95)).pose).toBe('idle');
  });

  it('walks left when the destination is to its left', () => {
    const start = { ...grounded(), poseUntilMs: 1000 };
    const first = tick(start, one, 1000, fixed(0.1));
    expect(first.spot?.x).toBeLessThan(start.x);
    const s = run(first, one, 1000, 50, fixed(0.1));
    expect(s.pose).toBe('walk');
    expect(s.facing).toBe('left');
    expect(s.vx).toBe(-WALK_SPEED_PX_S);
  });
});

describe('walk', () => {
  it('reaches cruise speed and brakes to a stop on arrival', () => {
    const rng = fixed(0.5);
    let s = tick({ ...grounded(), poseUntilMs: 1000 }, one, 1000, rng);
    expect(s.pose).toBe('walk');
    const destination = s.spot?.x ?? 0;
    const speeds: number[] = [];
    let steps = 0;
    while (s.pose === 'walk' && steps < 1000) {
      s = tick(s, one, 50, rng);
      speeds.push(s.vx);
      steps++;
    }
    expect(s.pose).not.toBe('walk');
    expect(Math.max(...speeds)).toBe(WALK_SPEED_PX_S);
    const peak = speeds.lastIndexOf(WALK_SPEED_PX_S);
    const braking = speeds.slice(peak);
    for (let i = 1; i < braking.length; i++) {
      expect(braking[i]).toBeLessThanOrEqual(braking[i - 1] ?? 0);
    }
    expect(s.vx).toBe(0);
    expect(Math.abs(s.x - destination)).toBeLessThanOrEqual(ARRIVE_PX);
    expect(s.spot).toBeUndefined();
    expect(s.poseMs).toBeLessThan(s.poseUntilMs);
  });

  it('keeps facing in sync with a bounce', () => {
    const start: ActorState = {
      ...grounded(1, 1920 - size - 5),
      pose: 'walk',
      poseUntilMs: 5000,
      vx: WALK_SPEED_PX_S,
    };
    const s = tick(start, one, 200);
    expect(s.vx).toBeLessThan(0);
    expect(s.facing).toBe('left');
  });
});

describe('walk distance', () => {
  const walking: ActorState = {
    ...grounded(),
    pose: 'walk',
    poseUntilMs: 9000,
    vx: WALK_SPEED_PX_S,
  };

  it('accumulates the ground covered while walking', () => {
    const s = run(walking, one, 1000, 50);
    expect(s.walkDistance).toBeCloseTo(Math.abs(s.x - walking.x), 6);
    expect(s.walkDistance).toBeGreaterThan(60);
  });

  it('grows faster with a quicker mood and slower with a sluggish one', () => {
    const slow: MoodModifiers = { expression: 'low', speedFactor: 0.6, pauseFactor: 1 };
    const quick: MoodModifiers = { expression: 'bright', speedFactor: 1.25, pauseFactor: 1 };
    const a = run(walking, one, 2000, 50, fixed(0.5), still, false, slow);
    const b = run(walking, one, 2000, 50, fixed(0.5), still, false, quick);
    expect(b.walkDistance / a.walkDistance).toBeCloseTo(1.25 / 0.6, 1);
  });

  it('never moves backwards, however small the tick', () => {
    let s: ActorState = walking;
    let last = 0;
    for (let t = 0; t < 500; t += 1) {
      s = tick(s, one, 1);
      expect(s.walkDistance).toBeGreaterThanOrEqual(last);
      last = s.walkDistance;
    }
    expect(last).toBeGreaterThan(0);
  });

  it('stays at zero while idle and while sitting', () => {
    expect(run(grounded(), one, 1500, 50, fixed(0.95)).walkDistance).toBe(0);
    const sat = run({ ...grounded(), pose: 'sit', poseUntilMs: 60_000 }, one, 1500, 50);
    expect(sat.pose).toBe('sit');
    expect(sat.walkDistance).toBe(0);
  });

  it('keeps counting across a bounce off the screen edge', () => {
    const start: ActorState = {
      ...grounded(1, 1920 - size - 5),
      pose: 'walk',
      poseUntilMs: 5000,
      vx: WALK_SPEED_PX_S,
    };
    const bounced = tick(start, one, 200);
    expect(bounced.vx).toBeLessThan(0);
    expect(bounced.walkDistance).toBeGreaterThan(0);
    const after = tick(bounced, one, 200);
    expect(after.walkDistance).toBeGreaterThan(bounced.walkDistance);
  });

  it('resets when the pose changes', () => {
    const walked = run(walking, one, 1000, 50);
    expect(walked.walkDistance).toBeGreaterThan(0);
    expect(reduce(walked, { type: 'alert' }, one).walkDistance).toBe(0);
    expect(reduce(walked, { type: 'drag-start' }, one).walkDistance).toBe(0);
  });
});

describe('follow', () => {
  const cursorOnRight: Cursor = { displayId: 2, idleMs: 0 };

  it('makes an idle mascot walk toward the goal and clears the goal on arrival', () => {
    let s = { ...grounded(1, 1800), poseUntilMs: 60_000 };
    s = run(s, two, 3000, 100, fixed(0.5), cursorOnRight, true);
    expect(s.goalDisplayId).toBeUndefined();
    s = tick(s, two, 100, fixed(0.5), cursorOnRight, true);
    expect(s.goalDisplayId).toBe(2);
    expect(s.pose).toBe('walk');
    expect(s.facing).toBe('right');
    s = run(s, two, 3000, 50, fixed(0.5), cursorOnRight, true);
    expect(s.displayId).toBe(2);
    expect(s.goalDisplayId).toBeUndefined();
    expect(s.y).toBe(groundY(tallRight, size));
  });

  it('wakes a sleeping mascot', () => {
    let s: ActorState = { ...grounded(), pose: 'sleep', poseUntilMs: 0 };
    s = run(s, two, 3100, 100, fixed(0.5), { displayId: 2, idleMs: 0 }, true);
    expect(s.pose).toBe('walk');
  });

  it('freezes the hold on a stale cursor sample instead of dropping it', () => {
    let s = { ...grounded(1, 1800), poseUntilMs: 60_000 };
    const stale: Cursor = { displayId: undefined, idleMs: 0 };
    s = run(s, two, 2000, 100, fixed(0.5), { displayId: 2, idleMs: 0 }, true);
    expect(s.follow.heldMs).toBeGreaterThan(1800);
    const held = s.follow.heldMs;
    s = run(s, two, 5000, 100, fixed(0.5), stale, true);
    expect(s.follow.heldMs).toBe(held);
    expect(s.goalDisplayId).toBeUndefined();
    s = run(s, two, 1500, 100, fixed(0.5), { displayId: 2, idleMs: 0 }, true);
    expect(s.goalDisplayId).toBe(2);
  });

  it('drops the goal when the cursor comes back before the walk arrives', () => {
    let s = { ...grounded(1, 1800), poseUntilMs: 60_000 };
    s = run(s, two, 3200, 100, fixed(0.5), { displayId: 2, idleMs: 0 }, true);
    expect(s.goalDisplayId).toBe(2);
    s = tick(s, two, 100, fixed(0.5), { displayId: 1, idleMs: 0 }, true);
    expect(s.goalDisplayId).toBeUndefined();
  });

  it('resets follow state when following is disabled', () => {
    let s = run(
      { ...grounded(), poseUntilMs: 60_000 },
      two,
      2000,
      100,
      fixed(0.5),
      cursorOnRight,
      true,
    );
    expect(s.follow.heldMs).toBeGreaterThan(0);
    s = tick(s, two, 100, fixed(0.5), cursorOnRight, false);
    expect(s.follow.heldMs).toBe(0);
  });
});

describe('sleep', () => {
  const asleepCursor: Cursor = { displayId: 1, idleMs: SLEEP_AFTER_MS };

  it('falls asleep after 5 minutes of cursor idle and wakes on movement', () => {
    let s = tick(grounded(), one, 100, fixed(0.5), { displayId: 1, idleMs: SLEEP_AFTER_MS - 1 });
    expect(s.pose).toBe('idle');
    s = tick(s, one, 100, fixed(0.5), asleepCursor);
    expect(s.pose).toBe('sleep');
    s = run(s, one, 60_000, 1000, fixed(0.5), asleepCursor);
    expect(s.pose).toBe('sleep');
    s = tick(s, one, 100, fixed(0.5), { displayId: 1, idleMs: 0 });
    expect(s.pose).toBe('idle');
    expect(s.poseUntilMs).toBeCloseTo((IDLE_MS[0] + IDLE_MS[1]) / 2, 6);
  });

  it('does not fall asleep while walking', () => {
    const s: ActorState = { ...grounded(), pose: 'walk', poseUntilMs: 5000 };
    expect(tick(s, one, 100, fixed(0.5), asleepCursor).pose).toBe('walk');
  });
});

describe('drag and drop', () => {
  it('freezes while dragged', () => {
    const s = reduce({ ...grounded(), vx: 50 }, { type: 'drag-start' }, one);
    expect(s.pose).toBe('drag');
    expect(s.vx).toBe(0);
    expect(tick(s, one, 1000)).toEqual(s);
  });

  it('falls after a drop and lands exactly on the ground as idle', () => {
    let s = reduce(grounded(), { type: 'drag-start' }, one);
    s = reduce(s, { type: 'drag-end', x: 300, y: 200, displayId: 1 }, one);
    expect(s.pose).toBe('drag');
    s = tick(s, one, 100, fixed(0.5));
    expect(s.pose).toBe('drag');
    expect(s.y).toBeGreaterThan(200);
    expect(s.vy).toBeGreaterThan(0);
    s = run(s, one, 1500, 16, fixed(0.5));
    expect(s.y).toBe(groundY(primary, size));
    expect(s.vy).toBe(0);
    expect(s.x).toBe(300);
    expect(s.pose).toBe('idle');
  });

  it('lands idle immediately when dropped on the ground', () => {
    const s = reduce(grounded(), { type: 'drag-end', x: 300, y: 5000, displayId: 1 }, one);
    expect(s.pose).toBe('idle');
    expect(s.y).toBe(groundY(primary, size));
  });
});

describe('pause', () => {
  it('freezes horizontal motion and keeps the pose', () => {
    const walking: ActorState = {
      ...grounded(),
      pose: 'walk',
      poseUntilMs: 5000,
      vx: WALK_SPEED_PX_S,
    };
    let s = reduce(walking, { type: 'pause' }, one);
    expect(s.paused).toBe(true);
    s = run(s, one, 1000, 50);
    expect(s.pose).toBe('walk');
    expect(s.vx).toBe(0);
    const x = s.x;
    s = run(s, one, 10_000, 50);
    expect(s.x).toBe(x);
    expect(s.pose).toBe('walk');
  });

  it('still lands a paused mascot in the air', () => {
    let s = reduce(grounded(), { type: 'drag-end', x: 300, y: 100, displayId: 1 }, one);
    s = reduce(s, { type: 'pause' }, one);
    s = run(s, one, 5000, 16, fixed(0.5));
    expect(s.y).toBe(groundY(primary, size));
  });

  it('resumes with a fresh idle', () => {
    const s = reduce({ ...grounded(), pose: 'sit', paused: true }, { type: 'resume' }, one);
    expect(s.paused).toBe(false);
    expect(s.pose).toBe('idle');
    expect(s.poseMs).toBe(0);
  });
});

describe('alert', () => {
  it('interrupts sleep and returns to idle after 1.5 s', () => {
    const sleeping: ActorState = { ...grounded(), pose: 'sleep', poseUntilMs: 0 };
    const asleep: Cursor = { displayId: 1, idleMs: SLEEP_AFTER_MS };
    let s = reduce(sleeping, { type: 'alert' }, one);
    expect(s.pose).toBe('alert');
    expect(s.poseUntilMs).toBe(ALERT_MS);
    s = run(s, one, ALERT_MS - 100, 100, fixed(0.5), asleep);
    expect(s.pose).toBe('alert');
    s = tick(s, one, 100, fixed(0.5), asleep);
    expect(s.pose).toBe('idle');
  });

  it('is ignored in the air', () => {
    const falling = reduce(grounded(), { type: 'drag-end', x: 300, y: 100, displayId: 1 }, one);
    expect(reduce(falling, { type: 'alert' }, one).pose).toBe('drag');
  });
});

describe('displays-changed', () => {
  it('recovers from a removed display onto the ground of the containing one', () => {
    const s = reduce(grounded(2, 2000), { type: 'displays-changed' }, one);
    expect(s.displayId).toBe(1);
    expect(s.y).toBe(groundY(primary, size));
    expect(s.x).toBeLessThanOrEqual(1920 - size);
    expect(s.x).toBeGreaterThanOrEqual(0);
  });

  it('keeps a still valid display untouched', () => {
    const start = grounded(1, 700);
    expect(reduce(start, { type: 'displays-changed' }, two)).toEqual(start);
  });

  it('drops a goal whose display disappeared', () => {
    const start = { ...grounded(1, 700), goalDisplayId: 2 };
    expect(reduce(start, { type: 'displays-changed' }, one).goalDisplayId).toBeUndefined();
  });
});

describe('determinism', () => {
  it('produces the same trajectory for the same rng sequence', () => {
    const values = [0.1, 0.8, 0.3, 0.6, 0.95, 0.2];
    const a = run(grounded(), two, 60_000, 33, sequence(values));
    const b = run(grounded(), two, 60_000, 33, sequence(values));
    expect(a).toEqual(b);
  });
});

describe('alert with a custom duration', () => {
  it('stays alert for the requested time and then idles', () => {
    let s = reduce(grounded(), { type: 'alert', ms: 8000 }, one);
    expect(s.pose).toBe('alert');
    expect(s.poseUntilMs).toBe(8000);
    s = run(s, one, 7900, 100);
    expect(s.pose).toBe('alert');
    s = run(s, one, 300, 100);
    expect(s.pose).toBe('idle');
  });
});

describe('celebrate', () => {
  const asleep: Cursor = { displayId: 1, idleMs: SLEEP_AFTER_MS };

  it('enters celebrate for the duration of its intensity and then idles', () => {
    for (const intensity of [1, 2, 3] as const) {
      let s = reduce(grounded(), { type: 'celebrate', intensity }, one);
      expect(s.pose).toBe('celebrate');
      expect(s.celebrateIntensity).toBe(intensity);
      expect(s.poseUntilMs).toBe(CELEBRATE_MS[intensity]);
      s = run(s, one, CELEBRATE_MS[intensity] - 100, 100, fixed(0.5));
      expect(s.pose).toBe('celebrate');
      s = tick(s, one, 100, fixed(0.5));
      expect(s.pose).toBe('idle');
      expect(s.celebrateIntensity).toBeUndefined();
    }
  });

  it('interrupts sleep and does not fall back asleep mid-celebration', () => {
    const sleeping: ActorState = { ...grounded(), pose: 'sleep', poseUntilMs: 0 };
    let s = reduce(sleeping, { type: 'celebrate', intensity: 2 }, one);
    expect(s.pose).toBe('celebrate');
    s = run(s, one, CELEBRATE_MS[2] - 100, 100, fixed(0.5), asleep);
    expect(s.pose).toBe('celebrate');
  });

  it('works while paused and still times out', () => {
    let s = reduce(grounded(), { type: 'pause' }, one);
    s = reduce(s, { type: 'celebrate', intensity: 1 }, one);
    expect(s.pose).toBe('celebrate');
    expect(s.paused).toBe(true);
    s = run(s, one, CELEBRATE_MS[1], 100);
    expect(s.pose).toBe('idle');
    expect(s.paused).toBe(true);
    expect(s.celebrateIntensity).toBeUndefined();
    const x = s.x;
    s = run(s, one, 10_000, 100);
    expect(s.x).toBe(x);
  });

  it('is ignored in the air and while dragging', () => {
    const falling = reduce(grounded(), { type: 'drag-end', x: 300, y: 100, displayId: 1 }, one);
    expect(reduce(falling, { type: 'celebrate', intensity: 3 }, one)).toEqual(falling);
    const dragging = reduce(grounded(), { type: 'drag-start' }, one);
    expect(reduce(dragging, { type: 'celebrate', intensity: 3 }, one)).toEqual(dragging);
  });

  it('clears the intensity when another pose takes over', () => {
    const s = reduce(grounded(), { type: 'celebrate', intensity: 2 }, one);
    expect(reduce(s, { type: 'alert' }, one).celebrateIntensity).toBeUndefined();
    expect(reduce(s, { type: 'drag-start' }, one).celebrateIntensity).toBeUndefined();
  });
});

describe('mood modifiers on tick', () => {
  const slow: MoodModifiers = { expression: 'low', speedFactor: 0.6, pauseFactor: 1.8 };
  const quick: MoodModifiers = { expression: 'bright', speedFactor: 1.25, pauseFactor: 0.7 };

  it('scales the walk cruise speed', () => {
    const walking: ActorState = { ...grounded(), pose: 'walk', poseUntilMs: 9000 };
    const s = run(walking, one, 3000, 50, fixed(0.5), still, false, slow);
    expect(s.vx).toBeCloseTo(WALK_SPEED_PX_S * 0.6, 6);
    const fast = run(walking, one, 3000, 50, fixed(0.5), still, false, quick);
    expect(fast.vx).toBeCloseTo(WALK_SPEED_PX_S * 1.25, 6);
  });

  it('scales idle and sit durations when they are picked', () => {
    const start = { ...grounded(), poseUntilMs: 1000 };
    const sat = tick(start, one, 1000, fixed(0.7), still, false, slow);
    expect(sat.pose).toBe('sit');
    expect(sat.poseUntilMs).toBeCloseTo((SIT_MS[0] + 0.7 * (SIT_MS[1] - SIT_MS[0])) * 1.8, 6);
    const idled = tick(start, one, 1000, fixed(0.95), still, false, quick);
    expect(idled.pose).toBe('idle');
    expect(idled.poseUntilMs).toBeCloseTo((IDLE_MS[0] + 0.95 * (IDLE_MS[1] - IDLE_MS[0])) * 0.7, 6);
  });

  it('leaves the walk cap alone whatever the mood', () => {
    const start = { ...grounded(), poseUntilMs: 1000 };
    const s = tick(start, one, 1000, fixed(0.5), still, false, slow);
    expect(s.pose).toBe('walk');
    expect(s.poseUntilMs).toBe(WALK_TIMEOUT_MS);
    expect(tick(start, one, 1000, fixed(0.5), still, false, quick).poseUntilMs).toBe(
      WALK_TIMEOUT_MS,
    );
  });

  it('stretches the rest at an arrival by the pause factor', () => {
    const range = usableRange(primary, size);
    const spot = { x: range.min, displayId: 1, kind: 'corner' as const };
    const start: ActorState = { ...grounded(1, range.min + 10), poseUntilMs: 1, spot };
    const plain = run(tick(start, one, 10, fixed(0.5)), one, 3000, 50, fixed(0.5));
    const slowed = run(
      tick(start, one, 10, fixed(0.5), still, false, slow),
      one,
      3000,
      50,
      fixed(0.5),
      still,
      false,
      slow,
    );
    expect(plain.pose).toBe('sit');
    expect(slowed.pose).toBe('sit');
    expect(slowed.poseUntilMs).toBeCloseTo(plain.poseUntilMs * 1.8, 6);
  });

  it('behaves exactly as without a mood when given neutral factors', () => {
    const neutral: MoodModifiers = { expression: 'plain', speedFactor: 1, pauseFactor: 1 };
    const values = [0.1, 0.8, 0.3, 0.6, 0.95, 0.2];
    let a = grounded();
    let b = grounded();
    const ra = sequence(values);
    const rb = sequence(values);
    for (let t = 0; t < 60_000; t += 33) {
      a = tick(a, two, 33, ra);
      b = tick(b, two, 33, rb, still, false, neutral);
    }
    expect(a).toEqual(b);
  });
});

describe('roosting', () => {
  const range = usableRange(primary, size);

  function lcg(seed: number): Rng {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  it('breaks a long crossing into legs and looks around between them', () => {
    const spot = { x: range.max, displayId: 1, kind: 'corner' as const };
    let s: ActorState = { ...grounded(1, range.min), poseUntilMs: 1, spot };
    const pauses: number[] = [];
    let last = s.pose;
    for (let i = 0; i < 4000 && s.pose !== 'sit'; i++) {
      s = tick(s, one, 50, fixed(0.5));
      if (s.pose !== last) {
        if (s.pose === 'idle') pauses.push(s.poseUntilMs);
        last = s.pose;
      }
    }
    expect(pauses.length).toBeGreaterThanOrEqual(2);
    for (const pause of pauses) {
      expect(pause).toBeGreaterThanOrEqual(LOOK_MS[0]);
      expect(pause).toBeLessThanOrEqual(LOOK_MS[1]);
    }
    expect(s.pose).toBe('sit');
    expect(Math.abs(s.x - range.max)).toBeLessThanOrEqual(ARRIVE_PX);
  });

  it('rests at an arrival far longer than an ordinary idle', () => {
    const spot = { x: range.max, displayId: 1, kind: 'corner' as const };
    let s: ActorState = { ...grounded(1, range.max - 300), poseUntilMs: 1, spot };
    for (let i = 0; i < 2000 && s.pose !== 'sit'; i++) s = tick(s, one, 50, fixed(0.5));
    expect(s.pose).toBe('sit');
    expect(s.poseUntilMs).toBeGreaterThanOrEqual(ROOST_MS.corner[0]);
    expect(s.poseUntilMs).toBeGreaterThan(IDLE_MS[1]);
    expect(s.spot).toBeUndefined();
    expect(s.legX).toBeUndefined();
  });

  it('spends most of its resting time near a side of the screen', () => {
    const rng = lcg(11);
    let s = grounded();
    let resting = 0;
    let nearASide = 0;
    for (let i = 0; i < 30_000; i++) {
      s = tick(s, one, 50, rng);
      expect(s.x).toBeGreaterThanOrEqual(range.min);
      expect(s.x).toBeLessThanOrEqual(range.max);
      if (s.pose === 'sit' || s.pose === 'sleep' || s.pose === 'idle') {
        resting++;
        if (Math.min(s.x - range.min, range.max - s.x) <= EDGE_PX) nearASide++;
      }
    }
    expect(resting).toBeGreaterThan(0);
    expect(nearASide / resting).toBeGreaterThan(0.7);
  });

  it('picks a destination on the display it has just crossed to', () => {
    let s = { ...grounded(1, 1800), poseUntilMs: 60_000 };
    const onRight: Cursor = { displayId: 2, idleMs: 0 };
    s = run(s, two, 3200, 100, fixed(0.5), onRight, true);
    expect(s.goalDisplayId).toBe(2);
    expect(s.spot).toBeUndefined();
    s = run(s, two, 3000, 50, fixed(0.5), onRight, true);
    expect(s.displayId).toBe(2);
    expect(s.spot?.displayId).toBe(2);
    expect(s.spot?.x).toBeGreaterThanOrEqual(tallRight.x);
  });
});

describe('fling', () => {
  const floor = groundY(primary, size);
  const range = usableRange(primary, size);

  function atRest(s: ActorState): boolean {
    return (
      (s.pose === 'idle' || s.pose === 'sit' || s.pose === 'sleep') &&
      s.spot === undefined &&
      s.legX === undefined &&
      s.vy === 0 &&
      s.y === floor
    );
  }

  it('carries the release velocity into an arc and bounces before it settles', () => {
    let s = reduce(grounded(1, 900), { type: 'drag-start' }, one);
    s = reduce(s, { type: 'drag-end', x: 900, y: 300, displayId: 1, vx: 900, vy: -300 }, one);
    expect(s.pose).toBe('drag');
    expect(s.flung).toBe(true);
    let contacts = 0;
    let liftedAgain = false;
    for (let i = 0; i < 400 && s.pose === 'drag'; i++) {
      const before = s;
      s = tick(s, one, 16, fixed(0.5));
      if (before.y < floor && s.y >= floor) contacts++;
      if (contacts > 0 && s.y < floor) liftedAgain = true;
    }
    expect(s.x).toBeGreaterThan(900);
    expect(contacts).toBeGreaterThanOrEqual(1);
    expect(liftedAgain).toBe(true);
    expect(s.y).toBe(floor);
    expect(s.pose).toBe('idle');
    expect(s.flung).toBe(false);
  });

  it('puts itself back against the nearest side after a hard throw', () => {
    let s = reduce(grounded(1, 1400), { type: 'drag-start' }, one);
    s = reduce(s, { type: 'drag-end', x: 1400, y: 300, displayId: 1, vx: 500, vy: -500 }, one);
    expect(s.spot).toBeUndefined();
    for (let i = 0; i < 4000 && !atRest(s); i++) s = tick(s, one, 20, fixed(0.5));
    expect(atRest(s)).toBe(true);
    expect(Math.min(s.x - range.min, range.max - s.x)).toBeLessThanOrEqual(ARRIVE_PX);
  });

  it('still drops straight down without a bounce when the release is gentle', () => {
    let s = reduce(grounded(), { type: 'drag-start' }, one);
    s = reduce(s, { type: 'drag-end', x: 300, y: 200, displayId: 1, vx: 20, vy: 40 }, one);
    expect(s.flung).toBe(false);
    let contacts = 0;
    for (let i = 0; i < 400 && s.pose === 'drag'; i++) {
      const before = s;
      s = tick(s, one, 16, fixed(0.5));
      if (before.y < floor && s.y >= floor) contacts++;
    }
    expect(contacts).toBe(1);
    expect(s.pose).toBe('idle');
    expect(s.spot).toBeUndefined();
    expect(s.y).toBe(floor);
  });

  it('needs a real throw to count as one', () => {
    const soft = reduce(
      grounded(),
      { type: 'drag-end', x: 300, y: 200, displayId: 1, vx: FLING_HARD_PX_S - 1, vy: 0 },
      one,
    );
    expect(soft.flung).toBe(false);
    const hard = reduce(
      grounded(),
      { type: 'drag-end', x: 300, y: 200, displayId: 1, vx: FLING_HARD_PX_S, vy: 0 },
      one,
    );
    expect(hard.flung).toBe(true);
  });

  it('reaches a resting pose from any release velocity within a bounded number of steps', () => {
    for (const vx of [-1800, -700, 0, 700, 1800]) {
      for (const vy of [-1500, -600, 0, 600, 1500]) {
        let s = reduce(
          grounded(1, 900),
          { type: 'drag-end', x: 900, y: 400, displayId: 1, vx, vy },
          one,
        );
        let steps = 0;
        while (steps < 3000 && !atRest(s)) {
          s = tick(s, one, 20, fixed(0.5));
          steps++;
        }
        expect(atRest(s)).toBe(true);
        expect(steps).toBeLessThan(3000);
        expect(s.x).toBeGreaterThanOrEqual(range.min);
        expect(s.x).toBeLessThanOrEqual(range.max);
      }
    }
  });
});

describe('dance', () => {
  it('does not fall asleep while the music is still on', () => {
    let s = reduce(grounded(), { type: 'dance-start' }, one);
    // Well past the idle threshold: nobody has touched the mouse, but something is playing.
    for (let i = 0; i < 40; i += 1) {
      s = tick(s, one, 20_000, fixed(0.5), { displayId: 1, idleMs: SLEEP_AFTER_MS * 4 });
    }
    expect(s.pose).toBe('dance');
    s = reduce(s, { type: 'dance-stop' }, one);
    s = tick(s, one, 1000, fixed(0.5), { displayId: 1, idleMs: SLEEP_AFTER_MS * 4 });
    expect(s.pose).toBe('sleep');
  });

  it('holds through every idle and walk roll until it is told to stop', () => {
    let s = reduce(grounded(), { type: 'dance-start' }, one);
    expect(s.pose).toBe('dance');
    s = run(s, one, 120_000, 100, fixed(0.5));
    expect(s.pose).toBe('dance');
    expect(s.x).toBe(500);
    s = reduce(s, { type: 'dance-stop' }, one);
    expect(s.pose).toBe('idle');
  });

  it('gives way to a nudge, a drag and sleep', () => {
    const dancing = reduce(grounded(), { type: 'dance-start' }, one);
    expect(reduce(dancing, { type: 'alert' }, one).pose).toBe('alert');
    expect(reduce(dancing, { type: 'drag-start' }, one).pose).toBe('drag');
    // Sleep is the exception: music playing means somebody is there, so a still cursor is not
    // evidence of an empty chair while it is on.
    const asleep: Cursor = { displayId: 1, idleMs: SLEEP_AFTER_MS };
    expect(tick(dancing, one, 100, fixed(0.5), asleep).pose).toBe('dance');
  });

  it('drops the journey it was on', () => {
    const walking: ActorState = {
      ...grounded(),
      pose: 'walk',
      poseUntilMs: 9000,
      spot: { x: 1800, displayId: 1, kind: 'corner' },
      legX: 1800,
    };
    const s = reduce(walking, { type: 'dance-start' }, one);
    expect(s.spot).toBeUndefined();
    expect(s.legX).toBeUndefined();
  });

  it('is ignored in the air and does nothing when it is not dancing', () => {
    const falling = reduce(grounded(), { type: 'drag-end', x: 300, y: 100, displayId: 1 }, one);
    expect(reduce(falling, { type: 'dance-start' }, one)).toEqual(falling);
    const idle = grounded();
    expect(reduce(idle, { type: 'dance-stop' }, one)).toEqual(idle);
  });
});

describe('pet', () => {
  it('lasts between two and three seconds', () => {
    expect(PET_MS).toBeGreaterThanOrEqual(2000);
    expect(PET_MS).toBeLessThanOrEqual(3000);
  });

  it('returns to the pose it interrupted with the time it had left', () => {
    const sitting: ActorState = { ...grounded(), pose: 'sit', poseUntilMs: 10_000, poseMs: 4000 };
    let s = reduce(sitting, { type: 'pet' }, one);
    expect(s.pose).toBe('pet');
    expect(s.poseUntilMs).toBe(PET_MS);
    s = run(s, one, PET_MS - 100, 100, fixed(0.5));
    expect(s.pose).toBe('pet');
    s = tick(s, one, 200, fixed(0.5));
    expect(s.pose).toBe('sit');
    expect(s.poseUntilMs).toBe(6000);
  });

  it('keeps the destination it was walking to', () => {
    const spot = { x: 1600, displayId: 1, kind: 'corner' as const };
    const walking: ActorState = {
      ...grounded(),
      pose: 'walk',
      poseUntilMs: 30_000,
      spot,
      legX: 1600,
    };
    let s = reduce(walking, { type: 'pet' }, one);
    expect(s.spot).toEqual(spot);
    s = run(s, one, PET_MS + 200, 100, fixed(0.5));
    expect(s.pose).toBe('walk');
    expect(s.spot).toEqual(spot);
  });

  it('goes back to dancing', () => {
    let s = reduce(grounded(), { type: 'dance-start' }, one);
    s = reduce(s, { type: 'pet' }, one);
    expect(s.pose).toBe('pet');
    s = run(s, one, PET_MS + 200, 100, fixed(0.5));
    expect(s.pose).toBe('dance');
    expect(s.poseUntilMs).toBe(0);
  });

  it('is ignored while dragging and in the air', () => {
    const dragging = reduce(grounded(), { type: 'drag-start' }, one);
    expect(reduce(dragging, { type: 'pet' }, one)).toEqual(dragging);
    const falling = reduce(grounded(), { type: 'drag-end', x: 300, y: 100, displayId: 1 }, one);
    expect(reduce(falling, { type: 'pet' }, one)).toEqual(falling);
  });
});

describe('startle', () => {
  it('reacts for about a second and a half', () => {
    expect(STARTLE_MS).toBeGreaterThanOrEqual(1000);
    expect(STARTLE_MS).toBeLessThanOrEqual(2000);
    const s = reduce(grounded(), { type: 'startle', cursorX: 600 }, one);
    expect(s.pose).toBe('startle');
    expect(s.poseUntilMs).toBe(STARTLE_MS);
  });

  it('then moves a short way away from the cursor', () => {
    let s = reduce(grounded(1, 900), { type: 'startle', cursorX: 1200 }, one);
    const away = s.spot?.x ?? 0;
    expect(away).toBeLessThan(900);
    s = run(s, one, STARTLE_MS - 100, 100, fixed(0.5));
    expect(s.pose).toBe('startle');
    s = tick(s, one, 200, fixed(0.5));
    expect(s.pose).toBe('walk');
    expect(s.facing).toBe('left');
    s = run(s, one, 8000, 50, fixed(0.5));
    expect(Math.abs(s.x - away)).toBeLessThanOrEqual(ARRIVE_PX);
  });

  it('flees to the right when the cursor is on its left', () => {
    const s = reduce(grounded(1, 900), { type: 'startle', cursorX: 400 }, one);
    expect(s.spot?.x ?? 0).toBeGreaterThan(900);
  });

  it('is ignored while dragging and in the air', () => {
    const dragging = reduce(grounded(), { type: 'drag-start' }, one);
    expect(reduce(dragging, { type: 'startle' }, one)).toEqual(dragging);
    const falling = reduce(grounded(), { type: 'drag-end', x: 300, y: 100, displayId: 1 }, one);
    expect(reduce(falling, { type: 'startle' }, one)).toEqual(falling);
  });
});
