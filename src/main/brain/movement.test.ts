import { describe, expect, it } from 'vitest';

import { WALK_ACCEL_PX_S2, directionTo, groundY, step, walk } from './movement';
import type { DisplayArea, MovementState, Target } from './movement';

const primary: DisplayArea = { id: 1, x: 0, y: 0, width: 1920, height: 1080 };
const tallRight: DisplayArea = { id: 2, x: 1920, y: 0, width: 1080, height: 1920 };
const size = 96;

function target(...displays: DisplayArea[]): Target {
  return { displays, width: size, height: size };
}

function run(state: MovementState, t: Target, dtMs: number, steps: number): MovementState {
  let s = state;
  for (let i = 0; i < steps; i++) s = step(s, t, dtMs);
  return s;
}

describe('step', () => {
  it('moves at a constant speed regardless of dt', () => {
    const start: MovementState = { x: 100, y: 500, vx: 120, displayId: 1 };
    const t = target(primary);
    const coarse = step(start, t, 1000);
    const fine = run(start, t, 10, 100);
    expect(coarse.x).toBeCloseTo(220, 6);
    expect(fine.x).toBeCloseTo(220, 6);
    expect(coarse.vx).toBe(120);
  });

  it('does not move when dt is zero', () => {
    const start: MovementState = { x: 100, y: 500, vx: 120, displayId: 1 };
    expect(step(start, target(primary), 0)).toEqual(start);
  });

  it('bounces off the right edge when there is no neighbour', () => {
    const start: MovementState = { x: 1920 - size - 10, y: 500, vx: 100, displayId: 1 };
    const next = step(start, target(primary), 200);
    expect(next.vx).toBe(-100);
    expect(next.x).toBeCloseTo(1920 - size - 10, 6);
    expect(next.displayId).toBe(1);
  });

  it('bounces off the left edge when there is no neighbour', () => {
    const start: MovementState = { x: 10, y: 500, vx: -100, displayId: 1 };
    const next = step(start, target(primary), 200);
    expect(next.vx).toBe(100);
    expect(next.x).toBeCloseTo(10, 6);
  });

  it('stays inside the display after a very long stall', () => {
    const start: MovementState = { x: 1000, y: 500, vx: 100, displayId: 1 };
    const next = step(start, target(primary), 60_000);
    expect(next.x).toBeGreaterThanOrEqual(0);
    expect(next.x).toBeLessThanOrEqual(1920 - size);
  });

  it('crosses to the right neighbour and maps y proportionally', () => {
    const t = target(primary, tallRight);
    const start: MovementState = {
      x: 1920 - size / 2 - 1,
      y: (1080 - size) / 2,
      vx: 100,
      displayId: 1,
    };
    const next = step(start, t, 100);
    expect(next.displayId).toBe(2);
    expect(next.vx).toBe(100);
    expect(next.x).toBeCloseTo(start.x + 10, 6);
    expect(next.y).toBeCloseTo((1920 - size) / 2, 6);
  });

  it('crosses back to the left neighbour and maps y proportionally', () => {
    const t = target(primary, tallRight);
    const start: MovementState = { x: 1920 - size / 2 + 1, y: 1920 - size, vx: -100, displayId: 2 };
    const next = step(start, t, 100);
    expect(next.displayId).toBe(1);
    expect(next.y).toBeCloseTo(1080 - size, 6);
  });

  it('bounces at the far edge of the neighbour instead of leaving the desktop', () => {
    const t = target(primary, tallRight);
    const start: MovementState = { x: 3000 - size - 5, y: 100, vx: 100, displayId: 2 };
    const next = step(start, t, 100);
    expect(next.displayId).toBe(2);
    expect(next.vx).toBe(-100);
    expect(next.x).toBeLessThanOrEqual(3000 - size);
  });

  it('ignores a display that does not touch the current one', () => {
    const detached: DisplayArea = { id: 3, x: 2500, y: 0, width: 1920, height: 1080 };
    const start: MovementState = { x: 1920 - size - 5, y: 100, vx: 100, displayId: 1 };
    const next = step(start, target(primary, detached), 100);
    expect(next.displayId).toBe(1);
    expect(next.vx).toBe(-100);
  });

  it('recovers when the remembered display disappears', () => {
    const start: MovementState = { x: 2000, y: 100, vx: 100, displayId: 99 };
    const next = step(start, target(primary, tallRight), 33);
    expect(next.displayId).toBe(2);
  });

  it('keeps y inside the display', () => {
    const start: MovementState = { x: 100, y: 5000, vx: 100, displayId: 1 };
    const next = step(start, target(primary), 33);
    expect(next.y).toBe(1080 - size);
  });
});

describe('walk', () => {
  const t = target(primary);

  it('accelerates toward the goal at WALK_ACCEL_PX_S2', () => {
    const start: MovementState = { x: 100, y: 500, vx: 0, displayId: 1 };
    const next = walk(start, t, 100, 70);
    expect(next.vx).toBeCloseTo(WALK_ACCEL_PX_S2 * 0.1, 6);
  });

  it('never overshoots the goal speed', () => {
    const start: MovementState = { x: 100, y: 500, vx: 60, displayId: 1 };
    expect(walk(start, t, 100, 70).vx).toBe(70);
    expect(walk(walk(start, t, 100, 70), t, 1000, 70).vx).toBe(70);
  });

  it('brakes to a full stop with goal 0', () => {
    let s: MovementState = { x: 100, y: 500, vx: 70, displayId: 1 };
    const speeds: number[] = [];
    for (let i = 0; i < 10; i++) {
      s = walk(s, t, 50, 0);
      speeds.push(s.vx);
    }
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] ?? 0);
    }
    expect(s.vx).toBe(0);
  });

  it('eases a negative goal symmetrically', () => {
    const start: MovementState = { x: 100, y: 500, vx: 0, displayId: 1 };
    expect(walk(start, t, 100, -70).vx).toBeCloseTo(-24, 6);
  });

  it('moves with the eased speed', () => {
    const start: MovementState = { x: 100, y: 500, vx: 70, displayId: 1 };
    const next = walk(start, t, 1000, 70);
    expect(next.x).toBeCloseTo(170, 6);
  });
});

describe('groundY', () => {
  it('is the bottom of the work area minus the mascot height', () => {
    expect(groundY(primary, size)).toBe(1080 - size);
    expect(groundY({ id: 5, x: 0, y: 200, width: 100, height: 700 }, size)).toBe(900 - size);
  });
});

describe('step with grounded', () => {
  it('lands a grounded mascot on the ground of a taller neighbour instead of mapping y', () => {
    const t = target(primary, tallRight);
    const start: MovementState = {
      x: 1920 - size / 2 - 1,
      y: groundY(primary, size),
      vx: 100,
      displayId: 1,
    };
    const next = step(start, t, 100, { grounded: true });
    expect(next.displayId).toBe(2);
    expect(next.y).toBe(groundY(tallRight, size));
  });

  it('lands a grounded mascot on the ground of a shorter neighbour', () => {
    const t = target(primary, tallRight);
    const start: MovementState = {
      x: 1920 - size / 2 + 1,
      y: groundY(tallRight, size),
      vx: -100,
      displayId: 2,
    };
    const next = walk(start, t, 100, -100, { grounded: true });
    expect(next.displayId).toBe(1);
    expect(next.y).toBe(groundY(primary, size));
  });
});

describe('directionTo', () => {
  const displays = [primary, tallRight];

  it('points right toward a display whose centre is further right', () => {
    expect(directionTo(displays, 1, 2)).toBe(1);
  });

  it('points left toward a display whose centre is further left', () => {
    expect(directionTo(displays, 2, 1)).toBe(-1);
  });

  it('is 0 for the same or an unknown display', () => {
    expect(directionTo(displays, 1, 1)).toBe(0);
    expect(directionTo(displays, 1, 42)).toBe(0);
    expect(directionTo(displays, 42, 1)).toBe(0);
  });
});

describe('walking into a neighbour', () => {
  it('does not bounce at the edge of a display that has a neighbour', () => {
    const t = target(primary, tallRight);
    let s: MovementState = { x: 1800, y: 500, vx: 70, displayId: 1 };
    for (let i = 0; i < 40; i++) s = step(s, t, 50);
    expect(s.displayId).toBe(2);
    expect(s.vx).toBe(70);
  });
});
