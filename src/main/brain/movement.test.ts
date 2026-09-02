import { describe, expect, it } from 'vitest';

import { step } from './movement';
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
