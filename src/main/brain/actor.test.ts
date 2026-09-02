import { describe, expect, it } from 'vitest';

import {
  ALERT_MS,
  DEFAULT_IDLE_MS,
  IDLE_MS,
  SLEEP_AFTER_MS,
  WALK_MS,
  WALK_SPEED_PX_S,
  createActor,
  reduce,
} from './actor';
import type { ActorAction, ActorState, Cursor, Rng } from './actor';
import { groundY } from './movement';
import type { DisplayArea, Target } from './movement';

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
): ActorState {
  const action: ActorAction = { type: 'tick', dtMs, rng, cursor, followCursor: follow };
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
): ActorState {
  let s = state;
  for (let t = 0; t < totalMs; t += dtMs) s = tick(s, target, dtMs, rng, cursor, follow);
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
  it('picks a walk duration in range from a fixed rng', () => {
    const rng = fixed(0.5);
    const start = { ...grounded(), poseUntilMs: 1000 };
    const s = tick(start, one, 1000, rng);
    expect(s.pose).toBe('walk');
    expect(s.poseUntilMs).toBeCloseTo((WALK_MS[0] + WALK_MS[1]) / 2, 6);
    expect(s.poseUntilMs).toBeGreaterThanOrEqual(WALK_MS[0]);
    expect(s.poseUntilMs).toBeLessThanOrEqual(WALK_MS[1]);
  });

  it('goes to sit for a roll between 0.65 and 0.9', () => {
    const start = { ...grounded(), poseUntilMs: 1000 };
    expect(tick(start, one, 1000, fixed(0.7)).pose).toBe('sit');
    expect(tick(start, one, 1000, fixed(0.95)).pose).toBe('idle');
  });

  it('walks left when the direction roll is below 0.5', () => {
    const start = { ...grounded(), poseUntilMs: 1000 };
    const s = run(tick(start, one, 1000, fixed(0.1)), one, 1000, 50, fixed(0.1));
    expect(s.pose).toBe('walk');
    expect(s.facing).toBe('left');
    expect(s.vx).toBe(-WALK_SPEED_PX_S);
  });
});

describe('walk', () => {
  it('reaches cruise speed and stops with easing before the pose ends', () => {
    const rng = fixed(0.5);
    let s = tick({ ...grounded(), poseUntilMs: 1000 }, one, 1000, rng);
    expect(s.pose).toBe('walk');
    const duration = s.poseUntilMs;
    const speeds: number[] = [];
    for (let t = 0; t < duration - 50; t += 50) {
      s = tick(s, one, 50, rng);
      speeds.push(s.vx);
    }
    expect(s.pose).toBe('walk');
    expect(Math.max(...speeds)).toBe(WALK_SPEED_PX_S);
    const peak = speeds.lastIndexOf(WALK_SPEED_PX_S);
    const braking = speeds.slice(peak);
    for (let i = 1; i < braking.length; i++) {
      expect(braking[i]).toBeLessThanOrEqual(braking[i - 1] ?? 0);
    }
    expect(s.vx).toBe(0);
    expect(tick(s, one, 50, rng).pose).toBe('idle');
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

  it('never yields a goal from alternating known and stale cursor samples', () => {
    let s = { ...grounded(1, 1800), poseUntilMs: 60_000 };
    for (let i = 0; i < 200; i++) {
      const cursor: Cursor = { displayId: i % 2 === 0 ? 2 : undefined, idleMs: 0 };
      s = tick(s, two, 100, fixed(0.5), cursor, true);
    }
    expect(s.goalDisplayId).toBeUndefined();
    expect(s.pose).toBe('idle');
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
