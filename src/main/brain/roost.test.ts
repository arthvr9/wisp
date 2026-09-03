import { describe, expect, it } from 'vitest';

import type { DisplayArea } from './movement';
import {
  EDGE_PX,
  LEG_PX,
  LOOK_MS,
  MIN_TRAVEL_PX,
  ROOST_MS,
  chooseSpot,
  fleeSpot,
  lookMs,
  nearestEdgeSpot,
  nextLeg,
  roostMs,
  spotKind,
  usableRange,
} from './roost';
import type { Rng, Spot } from './roost';

const primary: DisplayArea = { id: 1, x: 0, y: 0, width: 1920, height: 1080 };
const right: DisplayArea = { id: 2, x: 1920, y: 0, width: 1080, height: 1920 };
const narrow: DisplayArea = { id: 3, x: 0, y: 0, width: 400, height: 800 };
const size = 96;

function lcg(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function fixed(value: number): Rng {
  return () => value;
}

function sample(display: DisplayArea, fromX: number, count: number): Spot[] {
  const rng = lcg(7);
  const spots: Spot[] = [];
  for (let i = 0; i < count; i++) spots.push(chooseSpot(display, size, fromX, rng));
  return spots;
}

describe('usableRange', () => {
  it('spans every left coordinate that keeps the mascot on the display', () => {
    expect(usableRange(primary, size)).toEqual({ min: 0, max: 1920 - size });
    expect(usableRange(right, size)).toEqual({ min: 1920, max: 3000 - size });
  });

  it('collapses to a point when the mascot is wider than the display', () => {
    expect(usableRange(narrow, 900)).toEqual({ min: 0, max: 0 });
  });
});

describe('spotKind', () => {
  const range = usableRange(primary, size);

  it('reads the two ends as corners and the middle as open', () => {
    expect(spotKind(range.min, range)).toBe('corner');
    expect(spotKind(range.max, range)).toBe('corner');
    expect(spotKind(range.min + 300, range)).toBe('edge');
    expect(spotKind((range.min + range.max) / 2, range)).toBe('open');
  });
});

describe('chooseSpot', () => {
  it('stays inside the usable area', () => {
    const range = usableRange(primary, size);
    for (const spot of sample(primary, 900, 400)) {
      expect(spot.x).toBeGreaterThanOrEqual(range.min);
      expect(spot.x).toBeLessThanOrEqual(range.max);
      expect(spot.displayId).toBe(1);
      expect(spot.kind).toBe(spotKind(spot.x, range));
    }
  });

  it('favours edges and corners over the middle of the screen', () => {
    const spots = sample(primary, 900, 2000);
    const sides = spots.filter((s) => s.kind !== 'open').length;
    expect(sides / spots.length).toBeGreaterThan(0.7);
    const range = usableRange(primary, size);
    const nearASide = spots.filter(
      (s) => Math.min(s.x - range.min, range.max - s.x) <= EDGE_PX,
    ).length;
    expect(nearASide / spots.length).toBeGreaterThan(0.7);
  });

  it('picks both ends of the screen, not only one', () => {
    const spots = sample(primary, 900, 2000);
    const range = usableRange(primary, size);
    const middle = (range.min + range.max) / 2;
    expect(spots.some((s) => s.x < middle)).toBe(true);
    expect(spots.some((s) => s.x > middle)).toBe(true);
  });

  it('never picks the spot it is already sitting on', () => {
    const range = usableRange(primary, size);
    const least = Math.min(MIN_TRAVEL_PX, (range.max - range.min) / 3);
    for (const fromX of [range.min, 300, 900, 1500, range.max]) {
      for (const spot of sample(primary, fromX, 300)) {
        expect(Math.abs(spot.x - fromX)).toBeGreaterThanOrEqual(least);
      }
    }
  });

  it('walks away even when the draw lands under its feet', () => {
    const range = usableRange(primary, size);
    const centre = (range.min + range.max) / 2;
    // Both the draw and its mirror land in the middle, so only the fallback can answer.
    const spot = chooseSpot(primary, size, centre, fixed(0.5));
    expect(Math.abs(spot.x - centre)).toBeGreaterThan(MIN_TRAVEL_PX);
  });

  it('answers on a display narrower than the travel it would like', () => {
    const range = usableRange(narrow, size);
    for (const spot of sample(narrow, 150, 200)) {
      expect(spot.x).toBeGreaterThanOrEqual(range.min);
      expect(spot.x).toBeLessThanOrEqual(range.max);
      expect(spot.x).not.toBe(150);
    }
  });

  it('reports the display it chose on', () => {
    expect(sample(right, 2400, 20).every((s) => s.displayId === 2)).toBe(true);
  });
});

describe('nearestEdgeSpot', () => {
  it('picks the side the mascot is already closest to', () => {
    expect(nearestEdgeSpot(primary, size, 200).x).toBe(0);
    expect(nearestEdgeSpot(primary, size, 1700).x).toBe(1920 - size);
    expect(nearestEdgeSpot(primary, size, 200).kind).toBe('corner');
  });
});

describe('fleeSpot', () => {
  it('moves away from the cursor', () => {
    const spot = fleeSpot(primary, size, 900, 1200, 260);
    expect(spot.x).toBeLessThan(900);
    expect(fleeSpot(primary, size, 900, 600, 260).x).toBeGreaterThan(900);
  });

  it('turns around rather than leaving the display', () => {
    const spot = fleeSpot(primary, size, 40, 900, 260);
    expect(spot.x).toBeGreaterThan(40);
    expect(spot.x).toBeLessThanOrEqual(1920 - size);
  });
});

describe('nextLeg', () => {
  it('goes straight to a destination that is close enough', () => {
    expect(nextLeg(100, 400, fixed(0.5))).toBe(400);
  });

  it('breaks a long crossing into a leg no longer than the maximum', () => {
    const leg = nextLeg(0, 1800, fixed(0.5));
    expect(leg).toBeLessThanOrEqual(LEG_PX[1]);
    expect(leg).toBeGreaterThanOrEqual(LEG_PX[0]);
  });

  it('keeps the direction of the destination', () => {
    expect(nextLeg(1800, 0, fixed(0))).toBeLessThan(1800);
    expect(nextLeg(1800, 0, fixed(0))).toBeGreaterThan(0);
  });

  it('needs at most a bounded number of legs to arrive', () => {
    let x = 0;
    let legs = 0;
    const rng = lcg(3);
    while (x !== 1824 && legs < 100) {
      x = nextLeg(x, 1824, rng);
      legs++;
    }
    expect(x).toBe(1824);
    expect(legs).toBeLessThanOrEqual(1824 / LEG_PX[0] + 1);
  });
});

describe('durations', () => {
  it('rests longest at a corner and shortest in the open', () => {
    const rng = fixed(0.5);
    expect(roostMs('corner', rng)).toBeGreaterThan(roostMs('edge', rng));
    expect(roostMs('edge', rng)).toBeGreaterThan(roostMs('open', rng));
    expect(roostMs('open', rng)).toBeGreaterThanOrEqual(ROOST_MS.open[0]);
    expect(roostMs('corner', rng)).toBeLessThanOrEqual(ROOST_MS.corner[1]);
  });

  it('keeps the look around between legs short', () => {
    expect(lookMs(fixed(0))).toBe(LOOK_MS[0]);
    expect(lookMs(fixed(1))).toBe(LOOK_MS[1]);
    expect(lookMs(fixed(0.5))).toBeLessThan(ROOST_MS.open[0]);
  });
});
