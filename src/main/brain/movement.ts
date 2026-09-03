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
