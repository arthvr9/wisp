import { describe, expect, it } from 'vitest';

import type { Pose } from '../../shared/actor';
import { composeCustomSheet } from './custom-sheet';
import type { Surface } from './custom-sheet';
import { POSES, frameAtPhase } from './sprites';
import type { Frame, Sheet } from './sprites';

interface FakeImage {
  id: string;
}

interface Draw {
  source: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const SIZE = 32;
const BASE_WIDTH = 256;
const BASE_HEIGHT = 352;
const BASE_STRIDE = 13;

// The built-in sheet as the mascot window sees it: eight idle frames, two walk frames and so on.
const COUNTS: Record<Pose, number> = {
  idle: 8,
  walk: 2,
  sit: 4,
  sleep: 4,
  alert: 4,
  drag: 4,
  celebrate: 5,
  dance: 8,
  pet: 5,
  startle: 5,
};

function builtIn(): Sheet {
  const animations: Partial<Record<Pose, Frame[]>> = {};
  let at = 0;
  for (const pose of POSES) {
    animations[pose] = Array.from({ length: COUNTS[pose] }, (_unused, index) => {
      const frame: Frame = {
        x: (at % 8) * SIZE,
        y: Math.floor(at / 8) * SIZE,
        w: SIZE,
        h: SIZE,
        durationMs: 100 + index * 10,
        bobX: 0,
        bobY: index % 2,
      };
      at += 1;
      return frame;
    });
  }
  const expression = (x: number): Frame => ({
    x,
    y: 320,
    w: SIZE,
    h: SIZE,
    durationMs: 100,
    bobX: 0,
    bobY: 0,
  });
  return {
    animations: animations as Record<Pose, Frame[]>,
    expressions: { bright: expression(0), plain: expression(32), low: expression(64) },
    stridePx: BASE_STRIDE,
  };
}

function recorder() {
  const draws: Draw[] = [];
  const surfaces: { width: number; height: number }[] = [];
  const factory = (width: number, height: number): Surface<FakeImage> => {
    surfaces.push({ width, height });
    return {
      image: { id: 'composed' },
      draw(source, x, y, w, h) {
        draws.push({ source: source.id, x, y, w, h });
      },
    };
  };
  return { draws, surfaces, factory };
}

function drawing(pose: Pose, count: number): FakeImage[] {
  return Array.from({ length: count }, (_unused, index) => ({ id: `${pose}-${index + 1}` }));
}

function compose(frames: Partial<Record<Pose, FakeImage[]>>, stridePx = BASE_STRIDE) {
  const base = builtIn();
  const { draws, surfaces, factory } = recorder();
  const composed = composeCustomSheet(
    {
      base,
      baseImage: { id: 'built-in' },
      baseWidth: BASE_WIDTH,
      baseHeight: BASE_HEIGHT,
      frameWidth: SIZE,
      frameHeight: SIZE,
      stridePx,
      frames,
    },
    factory,
  );
  return { base, composed, draws, surfaces };
}

describe('composeCustomSheet', () => {
  it('puts the built-in sheet at the origin and the drawn frames under it', () => {
    const { composed, base, draws, surfaces } = compose({ walk: drawing('walk', 2) });

    expect(surfaces).toEqual([{ width: BASE_WIDTH, height: BASE_HEIGHT + SIZE }]);
    expect(draws[0]).toEqual({
      source: 'built-in',
      x: 0,
      y: 0,
      w: BASE_WIDTH,
      h: BASE_HEIGHT,
    });
    expect(draws.slice(1)).toEqual([
      { source: 'walk-1', x: 0, y: BASE_HEIGHT, w: SIZE, h: SIZE },
      { source: 'walk-2', x: SIZE, y: BASE_HEIGHT, w: SIZE, h: SIZE },
    ]);
    expect(composed.sheet.animations.walk.map((f) => f.x)).toEqual([0, SIZE]);
    expect(composed.image).toEqual({ id: 'composed' });
    // Every pose the user did not draw is the built-in one, untouched.
    expect(composed.sheet.animations.idle).toBe(base.animations.idle);
    expect(composed.sheet.animations.sleep).toBe(base.animations.sleep);
    expect(composed.sheet.expressions).toBe(base.expressions);
  });

  it('takes every pose from a full set', () => {
    const frames: Partial<Record<Pose, FakeImage[]>> = {};
    for (const pose of POSES) frames[pose] = drawing(pose, COUNTS[pose]);
    const { composed, draws } = compose(frames);

    const total = POSES.reduce((sum, pose) => sum + COUNTS[pose], 0);
    expect(draws).toHaveLength(total + 1);
    for (const pose of POSES) {
      expect(composed.sheet.animations[pose]).toHaveLength(COUNTS[pose]);
      expect(composed.sheet.animations[pose].every((f) => f.y === BASE_HEIGHT)).toBe(true);
    }
    // No two frames share a slot, and the row is exactly as wide as the frames need.
    const columns = POSES.flatMap((pose) => composed.sheet.animations[pose].map((f) => f.x));
    expect(new Set(columns).size).toBe(total);
    expect(composed.width).toBe(Math.max(BASE_WIDTH, total * SIZE));
  });

  it('keeps the built-in sheet when nothing was drawn', () => {
    const { base, composed, draws, surfaces } = compose({});

    expect(surfaces).toEqual([]);
    expect(draws).toEqual([]);
    expect(composed.image).toEqual({ id: 'built-in' });
    expect(composed.sheet.animations).toBe(base.animations);
    expect(composed.width).toBe(BASE_WIDTH);
    expect(composed.height).toBe(BASE_HEIGHT);
  });

  it('drops a pose whose frame list is empty', () => {
    const { base, composed } = compose({ walk: [], idle: drawing('idle', 8) });
    expect(composed.sheet.animations.walk).toBe(base.animations.walk);
    expect(composed.sheet.animations.idle).not.toBe(base.animations.idle);
  });

  it('keeps the timing of the pose it replaces', () => {
    const { base, composed } = compose({
      idle: drawing('idle', COUNTS.idle),
      sit: drawing('sit', 2),
    });

    // Frame for frame, the drawing holds each frame exactly as long as the built-in art did.
    expect(composed.sheet.animations.idle.map((f) => f.durationMs)).toEqual(
      base.animations.idle.map((f) => f.durationMs),
    );
    // Two frames in place of four split the same total, so the pose still lasts as long.
    const builtInTotal = base.animations.sit.reduce((sum, f) => sum + f.durationMs, 0);
    const drawnTotal = composed.sheet.animations.sit.reduce((sum, f) => sum + f.durationMs, 0);
    expect(composed.sheet.animations.sit).toHaveLength(2);
    expect(Math.abs(drawnTotal - builtInTotal)).toBeLessThanOrEqual(2);
  });

  it('borrows the expression offsets of the built-in frames', () => {
    const { base, composed } = compose({ idle: drawing('idle', COUNTS.idle) });
    expect(composed.sheet.animations.idle.map((f) => f.bobY)).toEqual(
      base.animations.idle.map((f) => f.bobY),
    );
  });

  it('covers the same ground however many frames the walk was drawn with', () => {
    const { composed } = compose({ walk: drawing('walk', 6) });

    // The stride is what the walk cycle covers on the ground. Six frames in place of two do not
    // make the mascot travel further, they only make each frame a shorter part of the cycle.
    expect(composed.sheet.stridePx).toBe(BASE_STRIDE);
    const walk = composed.sheet.animations.walk;
    expect(walk).toHaveLength(6);
    expect(frameAtPhase(walk, 0)).toBe(walk[0]);
    expect(frameAtPhase(walk, 0.5)).toBe(walk[3]);
    // One stride further along is the same point of the cycle again.
    expect(frameAtPhase(walk, 1.25)).toBe(frameAtPhase(walk, 0.25));
    expect(frameAtPhase(walk, 0.99)).toBe(walk[5]);
  });

  it('falls back to the built-in stride when the drawing declares none', () => {
    const { composed } = compose({ walk: drawing('walk', 4) }, 0);
    expect(composed.sheet.stridePx).toBe(BASE_STRIDE);
  });

  it('keeps a stride the drawing declares', () => {
    const { composed } = compose({ walk: drawing('walk', 4) }, 20);
    expect(composed.sheet.stridePx).toBe(20);
  });
});
