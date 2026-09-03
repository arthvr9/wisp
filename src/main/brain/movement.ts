export interface DisplayArea {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MovementState {
  x: number;
  y: number;
  vx: number;
  displayId: number;
}

export interface Target {
  displays: readonly DisplayArea[];
  width: number;
  height: number;
}

export interface StepOptions {
  grounded?: boolean;
}

export const WALK_ACCEL_PX_S2 = 240;
export const GRAVITY_PX_S2 = 2400;
export const TERMINAL_PX_S = 1500;
export const BOUNCE_DAMPING = 0.45;
export const BOUNCE_FRICTION = 0.6;
export const BOUNCE_MIN_PX_S = 220;
export const MAX_BOUNCES = 2;
export const FLING_HARD_PX_S = 700;

const EDGE_TOLERANCE = 2;

export function groundY(display: DisplayArea, height: number): number {
  return display.y + display.height - height;
}

export function directionTo(
  displays: readonly DisplayArea[],
  fromDisplayId: number,
  toDisplayId: number,
): -1 | 1 | 0 {
  const from = displays.find((d) => d.id === fromDisplayId);
  const to = displays.find((d) => d.id === toDisplayId);
  if (!from || !to || from.id === to.id) return 0;
  const fromCentre = from.x + from.width / 2;
  const toCentre = to.x + to.width / 2;
  if (toCentre > fromCentre) return 1;
  if (toCentre < fromCentre) return -1;
  return 0;
}

function currentDisplay(state: MovementState, displays: readonly DisplayArea[]): DisplayArea {
  const byId = displays.find((d) => d.id === state.displayId);
  if (byId) return byId;
  const cx = state.x;
  const cy = state.y;
  const containing = displays.find(
    (d) => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height,
  );
  const fallback = displays[0];
  if (containing) return containing;
  if (fallback) return fallback;
  throw new Error('movement.step needs at least one display');
}

function neighbour(
  from: DisplayArea,
  side: 'left' | 'right',
  displays: readonly DisplayArea[],
): DisplayArea | undefined {
  return displays.find((d) => {
    if (d.id === from.id) return false;
    const touching =
      side === 'right'
        ? Math.abs(d.x - (from.x + from.width)) <= EDGE_TOLERANCE
        : Math.abs(d.x + d.width - from.x) <= EDGE_TOLERANCE;
    const verticalOverlap = d.y < from.y + from.height && d.y + d.height > from.y;
    return touching && verticalOverlap;
  });
}

function mapY(y: number, from: DisplayArea, to: DisplayArea, height: number): number {
  const fromRange = Math.max(from.height - height, 1);
  const toRange = Math.max(to.height - height, 0);
  const ratio = (y - from.y) / fromRange;
  return to.y + Math.min(Math.max(ratio, 0), 1) * toRange;
}

function clampY(y: number, display: DisplayArea, height: number): number {
  const min = display.y;
  const max = Math.max(display.y + display.height - height, min);
  return Math.min(Math.max(y, min), max);
}

function landing(
  y: number,
  from: DisplayArea,
  to: DisplayArea,
  height: number,
  grounded: boolean,
): number {
  return grounded ? groundY(to, height) : mapY(y, from, to, height);
}

export function step(
  state: MovementState,
  target: Target,
  dtMs: number,
  options: StepOptions = {},
): MovementState {
  const grounded = options.grounded ?? false;
  const display = currentDisplay(state, target.displays);
  const dt = Math.max(dtMs, 0) / 1000;
  let x = state.x + state.vx * dt;
  let y = clampY(state.y, display, target.height);
  let vx = state.vx;
  let displayId = display.id;

  const left = display.x;
  const right = display.x + display.width;
  const centre = x + target.width / 2;

  if (centre >= right) {
    const next = neighbour(display, 'right', target.displays);
    if (next) {
      displayId = next.id;
      y = landing(y, display, next, target.height, grounded);
    }
  } else if (centre < left) {
    const next = neighbour(display, 'left', target.displays);
    if (next) {
      displayId = next.id;
      y = landing(y, display, next, target.height, grounded);
    }
  }

  if (displayId === display.id) {
    const maxX = right - target.width;
    if (x > maxX && !neighbour(display, 'right', target.displays)) {
      x = Math.max(2 * maxX - x, left);
      vx = -Math.abs(vx);
    } else if (x < left && !neighbour(display, 'left', target.displays)) {
      x = Math.min(2 * left - x, maxX);
      vx = Math.abs(vx);
    }
  }

  return { x, y, vx, displayId };
}

function ease(vx: number, goalVx: number, dt: number): number {
  const delta = goalVx - vx;
  const maxDelta = WALK_ACCEL_PX_S2 * dt;
  if (Math.abs(delta) <= maxDelta) return goalVx;
  return vx + Math.sign(delta) * maxDelta;
}

export function walk(
  state: MovementState,
  target: Target,
  dtMs: number,
  goalVx: number,
  options: StepOptions = {},
): MovementState {
  const dt = Math.max(dtMs, 0) / 1000;
  const vx = ease(state.vx, goalVx, dt);
  return step({ ...state, vx }, target, dtMs, options);
}

export interface Flight {
  x: number;
  y: number;
  vx: number;
  vy: number;
  displayId: number;
  bounces: number;
}

export interface FlightStep {
  flight: Flight;
  contact: boolean;
  impact: number;
  resting: boolean;
}

// One step of a thrown mascot: gravity on the vertical, the ordinary walk rules on the
// horizontal, and a damped bounce on contact. Every bounce spends one of maxBounces and loses
// speed, so the flight always ends on the ground after a bounded number of steps.
export function fly(
  flight: Flight,
  target: Target,
  dtMs: number,
  maxBounces: number = MAX_BOUNCES,
): FlightStep {
  const dt = Math.max(dtMs, 0) / 1000;
  const vy = Math.min(flight.vy + GRAVITY_PX_S2 * dt, TERMINAL_PX_S);
  const moved = step(
    { x: flight.x, y: flight.y, vx: flight.vx, displayId: flight.displayId },
    target,
    dtMs,
  );
  const display = currentDisplay(moved, target.displays);
  const floor = groundY(display, target.height);
  const ceiling = display.y;
  const y = moved.y + vy * dt;

  if (y <= ceiling) {
    const stopped = { ...moved, y: ceiling, vy: Math.max(vy, 0), bounces: flight.bounces };
    return { flight: stopped, contact: false, impact: 0, resting: false };
  }
  if (y < floor) {
    return {
      flight: { ...moved, y, vy, bounces: flight.bounces },
      contact: false,
      impact: 0,
      resting: false,
    };
  }

  const impact = Math.abs(vy);
  if (impact >= BOUNCE_MIN_PX_S && flight.bounces < maxBounces) {
    const bounced = {
      ...moved,
      y: floor,
      vx: moved.vx * BOUNCE_FRICTION,
      vy: -impact * BOUNCE_DAMPING,
      bounces: flight.bounces + 1,
    };
    return { flight: bounced, contact: true, impact, resting: false };
  }
  return {
    flight: { ...moved, y: floor, vx: 0, vy: 0, bounces: 0 },
    contact: true,
    impact,
    resting: true,
  };
}
