import { describe, expect, it } from 'vitest';

import { followCursor, initialFollow } from './follow';
import type { FollowState } from './follow';

function hold(state: FollowState, cursor: number, ms: number, dt = 100): FollowState {
  let s = followCursor(state, 1, cursor, 0).state;
  for (let t = 0; t < ms; t += dt) s = followCursor(s, 1, cursor, dt).state;
  return s;
}

describe('followCursor', () => {
  it('has no candidate while the cursor is on the mascot display', () => {
    const r = followCursor({ candidate: 2, heldMs: 2000 }, 1, 1, 100);
    expect(r.state).toEqual(initialFollow);
    expect(r.goal).toBeUndefined();
  });

  it('yields no goal before 3 s', () => {
    const s = hold(initialFollow, 2, 2900);
    const r = followCursor(s, 1, 2, 50);
    expect(r.goal).toBeUndefined();
    expect(r.state.heldMs).toBeCloseTo(2950, 6);
  });

  it('yields the goal at 3 s', () => {
    const s = hold(initialFollow, 2, 2900);
    const r = followCursor(s, 1, 2, 100);
    expect(r.goal).toBe(2);
  });

  it('keeps yielding the goal while the cursor stays', () => {
    const s = hold(initialFollow, 2, 5000);
    expect(followCursor(s, 1, 2, 100).goal).toBe(2);
  });

  it('resets when the cursor returns at 2.9 s', () => {
    const s = hold(initialFollow, 2, 2900);
    const back = followCursor(s, 1, 1, 100).state;
    expect(back.heldMs).toBe(0);
    expect(back.candidate).toBeUndefined();
    expect(followCursor(hold(back, 2, 2900), 1, 2, 50).goal).toBeUndefined();
  });

  it('does not accumulate while the cursor bounces between two other displays', () => {
    let s = initialFollow;
    for (let i = 0; i < 100; i++) {
      s = followCursor(s, 1, i % 2 === 0 ? 2 : 3, 100).state;
    }
    expect(s.heldMs).toBe(0);
    expect(followCursor(s, 1, 2, 100).goal).toBeUndefined();
  });

  it('honours a custom hold time', () => {
    const s = followCursor(initialFollow, 1, 2, 100).state;
    expect(followCursor(s, 1, 2, 500, 500).goal).toBe(2);
  });
});
