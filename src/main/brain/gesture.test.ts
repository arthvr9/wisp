import { describe, expect, it } from 'vitest';

import { DEFAULT_SHAKE, feed, initialShake } from './gesture';
import type { ShakeState } from './gesture';

// Feeds a run of samples and reports how many times a shake was detected.
const play = (
  samples: readonly { x: number; y: number; tMs: number }[],
  from: ShakeState = initialShake,
): { state: ShakeState; hits: number } => {
  let state = from;
  let hits = 0;
  for (const s of samples) {
    const r = feed(state, s);
    state = r.state;
    if (r.shook) hits += 1;
  }
  return { state, hits };
};

// A shake: swings of `amplitude` px alternating sides, one sample every `stepMs`.
const shake = (swings: number, amplitude = 90, stepMs = 40, startMs = 1000) =>
  Array.from({ length: swings + 1 }, (_, i) => ({
    x: 500 + (i % 2 === 0 ? 0 : amplitude),
    y: 400,
    tMs: startMs + i * stepMs,
  }));

describe('shake detection', () => {
  it('fires on a real shake', () => {
    expect(play(shake(6)).hits).toBe(1);
  });

  it('ignores a straight drag across the screen', () => {
    const drag = Array.from({ length: 20 }, (_, i) => ({
      x: 200 + i * 40,
      y: 400,
      tMs: 1000 + i * 30,
    }));
    expect(play(drag).hits).toBe(0);
  });

  it('ignores a slow wiggle that covers no ground', () => {
    expect(play(shake(8, 10)).hits).toBe(0);
  });

  it('ignores swings spread out over more than the window', () => {
    expect(play(shake(8, 90, 400)).hits).toBe(0);
  });

  it('ignores a cursor that does not move', () => {
    const still = Array.from({ length: 30 }, (_, i) => ({ x: 500, y: 400, tMs: 1000 + i * 30 }));
    expect(play(still).hits).toBe(0);
  });

  it('does not fire twice for one shake as the samples age out', () => {
    const long = shake(20);
    expect(play(long).hits).toBe(1);
  });

  it('holds off during the cooldown and fires again after it', () => {
    const first = play(shake(6));
    expect(first.hits).toBe(1);
    const during = play(shake(6, 90, 40, 1000 + DEFAULT_SHAKE.cooldownMs - 1000), first.state);
    expect(during.hits).toBe(0);
    const after = play(shake(6, 90, 40, 1000 + DEFAULT_SHAKE.cooldownMs + 500), during.state);
    expect(after.hits).toBe(1);
  });

  it('keeps the window bounded however long it runs', () => {
    const long = Array.from({ length: 5000 }, (_, i) => ({
      x: 500 + (i % 2) * 3,
      y: 400,
      tMs: 1000 + i * 30,
    }));
    const { state } = play(long);
    expect(state.samples.length).toBeLessThan(40);
  });
});
