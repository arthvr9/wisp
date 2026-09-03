import type { DisplayArea } from './movement';

export type Rng = () => number;

export type SpotKind = 'corner' | 'edge' | 'open';

export interface Spot {
  x: number;
  displayId: number;
  kind: SpotKind;
}

export interface XRange {
  min: number;
  max: number;
}

// A corner or a side is where a small creature looks like it chose to be. The middle of a
// desktop is where it looks lost, so the middle band draws far below its share of the width.
const WEIGHT: Record<SpotKind, number> = { corner: 3, edge: 2, open: 2 };

export const CORNER_PX = 140;
export const EDGE_PX = 420;
const CORNER_FRACTION = 0.08;
const EDGE_FRACTION = 0.28;

export const MIN_TRAVEL_PX = 200;
export const LEG_PX: readonly [number, number] = [260, 620];
export const LOOK_MS: readonly [number, number] = [700, 1800];
export const ROOST_MS: Record<SpotKind, readonly [number, number]> = {
  corner: [20_000, 45_000],
  edge: [14_000, 30_000],
  open: [6000, 14_000],
};

interface Band {
  from: number;
  to: number;
  kind: SpotKind;
}

export function usableRange(display: DisplayArea, width: number): XRange {
  const min = display.x;
  return { min, max: Math.max(display.x + display.width - width, min) };
}

function clampTo(x: number, range: XRange): number {
  return Math.min(Math.max(x, range.min), range.max);
}

function widths(range: XRange): { corner: number; edge: number } {
  const span = Math.max(range.max - range.min, 0);
  const corner = Math.min(CORNER_PX, span * CORNER_FRACTION);
  const edge = Math.min(EDGE_PX, Math.max(span * EDGE_FRACTION, corner));
  return { corner, edge };
}

export function spotKind(x: number, range: XRange): SpotKind {
  const { corner, edge } = widths(range);
  const fromSide = Math.min(x - range.min, range.max - x);
  if (fromSide <= corner) return 'corner';
  if (fromSide <= edge) return 'edge';
  return 'open';
}

function bands(range: XRange): readonly Band[] {
  const { corner, edge } = widths(range);
  return [
    { from: range.min, to: range.min + corner, kind: 'corner' },
    { from: range.min + corner, to: range.min + edge, kind: 'edge' },
    { from: range.min + edge, to: range.max - edge, kind: 'open' },
    { from: range.max - edge, to: range.max - corner, kind: 'edge' },
    { from: range.max - corner, to: range.max, kind: 'corner' },
  ];
}

function draw(range: XRange, rng: Rng): number {
  const list = bands(range);
  const total = list.reduce((sum, band) => sum + WEIGHT[band.kind], 0);
  let roll = rng() * total;
  let chosen = list[list.length - 1] ?? { from: range.min, to: range.max, kind: 'open' as const };
  for (const band of list) {
    roll -= WEIGHT[band.kind];
    if (roll < 0) {
      chosen = band;
      break;
    }
  }
  const within = rng();
  return clampTo(chosen.from + within * Math.max(chosen.to - chosen.from, 0), range);
}

function spotAt(x: number, range: XRange, displayId: number): Spot {
  const clamped = clampTo(x, range);
  return { x: clamped, displayId, kind: spotKind(clamped, range) };
}

function leastTravel(range: XRange): number {
  return Math.min(MIN_TRAVEL_PX, (range.max - range.min) / 3);
}

export function chooseSpot(display: DisplayArea, width: number, fromX: number, rng: Rng): Spot {
  const range = usableRange(display, width);
  const least = leastTravel(range);
  const first = draw(range, rng);
  if (Math.abs(first - fromX) >= least) return spotAt(first, range, display.id);
  const mirrored = range.min + range.max - first;
  if (Math.abs(mirrored - fromX) >= least) return spotAt(mirrored, range, display.id);
  const far = fromX - range.min >= range.max - fromX ? range.min : range.max;
  return spotAt(far, range, display.id);
}

export function nearestEdgeSpot(display: DisplayArea, width: number, fromX: number): Spot {
  const range = usableRange(display, width);
  const x = fromX - range.min <= range.max - fromX ? range.min : range.max;
  return spotAt(x, range, display.id);
}

export function fleeSpot(
  display: DisplayArea,
  width: number,
  fromX: number,
  awayFromX: number,
  distance: number,
): Spot {
  const range = usableRange(display, width);
  const direction = fromX + width / 2 >= awayFromX ? 1 : -1;
  const wanted = fromX + direction * distance;
  const inside = wanted >= range.min && wanted <= range.max;
  return spotAt(inside ? wanted : fromX - direction * distance, range, display.id);
}

// A long crossing is walked in legs with a look around in between. One unbroken line across
// three thousand pixels reads as a script running, not as an animal going somewhere.
export function nextLeg(fromX: number, toX: number, rng: Rng): number {
  const dx = toX - fromX;
  const leg = LEG_PX[0] + rng() * (LEG_PX[1] - LEG_PX[0]);
  if (Math.abs(dx) <= leg + LEG_PX[0]) return toX;
  return fromX + Math.sign(dx) * leg;
}

export function roostMs(kind: SpotKind, rng: Rng): number {
  const range = ROOST_MS[kind];
  return range[0] + rng() * (range[1] - range[0]);
}

export function lookMs(rng: Rng): number {
  return LOOK_MS[0] + rng() * (LOOK_MS[1] - LOOK_MS[0]);
}
