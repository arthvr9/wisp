import type { Facing, Pose } from '../../shared/actor';
import { followCursor, initialFollow } from './follow';
import type { FollowState } from './follow';
import { WALK_ACCEL_PX_S2, directionTo, groundY, walk } from './movement';
import type { DisplayArea, Target } from './movement';

export interface ActorState {
  pose: Pose;
  facing: Facing;
  x: number;
  y: number;
  vx: number;
  vy: number;
  displayId: number;
  poseMs: number;
  poseUntilMs: number;
  goalDisplayId?: number;
  paused: boolean;
  follow: FollowState;
}

export type Rng = () => number;

export interface Cursor {
  displayId: number | undefined;
  idleMs: number;
}

export type ActorAction =
  | { type: 'tick'; dtMs: number; rng: Rng; cursor: Cursor; followCursor: boolean }
  | { type: 'drag-start' }
  | { type: 'drag-end'; x: number; y: number; displayId: number }
  | { type: 'alert' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'displays-changed' };

export const WALK_SPEED_PX_S = 70;
export const GRAVITY_PX_S2 = 2400;
export const TERMINAL_PX_S = 1500;
export const SLEEP_AFTER_MS = 5 * 60_000;
export const WAKE_BELOW_MS = 1000;
export const ALERT_MS = 1500;
export const IDLE_MS: readonly [number, number] = [2000, 6000];
export const WALK_MS: readonly [number, number] = [3000, 9000];
export const SIT_MS: readonly [number, number] = [6000, 15_000];
export const DEFAULT_IDLE_MS = 4000;

const RESTING: readonly Pose[] = ['idle', 'sit', 'sleep'];

export function createActor(displayId: number, x: number, y: number): ActorState {
  return {
    pose: 'idle',
    facing: 'right',
    x,
    y,
    vx: 0,
    vy: 0,
    displayId,
    poseMs: 0,
    poseUntilMs: DEFAULT_IDLE_MS,
    paused: false,
    follow: initialFollow,
  };
}

function between(rng: Rng, range: readonly [number, number]): number {
  return range[0] + rng() * (range[1] - range[0]);
}

function findDisplay(target: Target, id: number): DisplayArea | undefined {
  return target.displays.find((d) => d.id === id);
}

function displayOf(state: ActorState, target: Target): DisplayArea {
  const display = findDisplay(target, state.displayId) ?? target.displays[0];
  if (!display) throw new Error('actor needs at least one display');
  return display;
}

function ground(state: ActorState, target: Target): number {
  return groundY(displayOf(state, target), target.height);
}

function grounded(state: ActorState, target: Target): boolean {
  return state.y >= ground(state, target);
}

function enter(state: ActorState, pose: Pose, untilMs: number): ActorState {
  return { ...state, pose, poseMs: 0, poseUntilMs: untilMs };
}

function facingOf(vx: number, fallback: Facing): Facing {
  if (vx < 0) return 'left';
  if (vx > 0) return 'right';
  return fallback;
}

function startWalk(state: ActorState, target: Target, rng: Rng): ActorState {
  let direction = 0;
  if (state.goalDisplayId !== undefined) {
    direction = directionTo(target.displays, state.displayId, state.goalDisplayId);
  }
  if (direction === 0) direction = rng() < 0.5 ? -1 : 1;
  const facing: Facing = direction < 0 ? 'left' : 'right';
  return enter({ ...state, facing }, 'walk', between(rng, WALK_MS));
}

function nextPose(state: ActorState, target: Target, rng: Rng): ActorState {
  if (state.goalDisplayId !== undefined) return startWalk(state, target, rng);
  if (state.pose !== 'idle') return enter(state, 'idle', between(rng, IDLE_MS));
  const roll = rng();
  if (roll < 0.65) return startWalk(state, target, rng);
  if (roll < 0.9) return enter(state, 'sit', between(rng, SIT_MS));
  return enter(state, 'idle', between(rng, IDLE_MS));
}

function goalSpeed(state: ActorState, dtMs: number): number {
  if (state.pose !== 'walk' || state.paused) return 0;
  const remainingMs = state.poseUntilMs - state.poseMs;
  const brakeMs = (Math.abs(state.vx) / WALK_ACCEL_PX_S2) * 1000 + dtMs;
  if (remainingMs <= brakeMs) return 0;
  return state.facing === 'left' ? -WALK_SPEED_PX_S : WALK_SPEED_PX_S;
}

function move(state: ActorState, target: Target, dtMs: number): ActorState {
  const { x, y, vx, displayId } = state;
  const moved = walk({ x, y, vx, displayId }, target, dtMs, goalSpeed(state, dtMs), {
    grounded: true,
  });
  const facing = state.pose === 'walk' ? facingOf(moved.vx, state.facing) : state.facing;
  return { ...state, ...moved, facing };
}

function fall(state: ActorState, target: Target, dtMs: number, rng: Rng): ActorState {
  const dt = Math.max(dtMs, 0) / 1000;
  const vy = Math.min(state.vy + GRAVITY_PX_S2 * dt, TERMINAL_PX_S);
  const y = state.y + vy * dt;
  const floor = ground(state, target);
  if (y < floor) return { ...state, y, vy };
  return enter({ ...state, y: floor, vy: 0 }, 'idle', between(rng, IDLE_MS));
}

function applyFollow(
  state: ActorState,
  cursor: Cursor,
  dtMs: number,
  enabled: boolean,
): ActorState {
  if (!enabled) {
    return { ...state, follow: initialFollow, goalDisplayId: undefined };
  }
  if (cursor.displayId === undefined) return { ...state, follow: initialFollow };
  const result = followCursor(state.follow, state.displayId, cursor.displayId, dtMs);
  const goalDisplayId =
    result.goal !== undefined && result.goal !== state.displayId
      ? result.goal
      : state.goalDisplayId;
  return { ...state, follow: result.state, goalDisplayId };
}

function clearReachedGoal(state: ActorState): ActorState {
  if (state.goalDisplayId !== state.displayId) return state;
  return { ...state, goalDisplayId: undefined };
}

function applySleep(state: ActorState, cursor: Cursor, rng: Rng): ActorState {
  if (state.pose === 'sleep') {
    return cursor.idleMs < WAKE_BELOW_MS ? enter(state, 'idle', between(rng, IDLE_MS)) : state;
  }
  if (cursor.idleMs >= SLEEP_AFTER_MS && (state.pose === 'idle' || state.pose === 'sit')) {
    return enter(state, 'sleep', 0);
  }
  return state;
}

function expire(state: ActorState, target: Target, rng: Rng): ActorState {
  if (state.poseUntilMs > 0 && state.poseMs >= state.poseUntilMs) {
    return nextPose(state, target, rng);
  }
  return state;
}

function tick(
  state: ActorState,
  target: Target,
  action: Extract<ActorAction, { type: 'tick' }>,
): ActorState {
  const { dtMs, rng, cursor } = action;
  if (!grounded(state, target)) return fall(state, target, dtMs, rng);
  if (state.pose === 'drag') return state;

  let next = clearReachedGoal(applyFollow(state, cursor, dtMs, action.followCursor));
  if (next.paused) return move(next, target, dtMs);

  next = { ...next, poseMs: next.poseMs + Math.max(dtMs, 0) };
  next = applySleep(next, cursor, rng);
  if (next.goalDisplayId !== undefined && RESTING.includes(next.pose)) {
    next = startWalk(next, target, rng);
  }
  next = expire(next, target, rng);
  return clearReachedGoal(move(next, target, dtMs));
}

function dragEnd(
  state: ActorState,
  target: Target,
  action: Extract<ActorAction, { type: 'drag-end' }>,
): ActorState {
  const placed = { ...state, x: action.x, y: action.y, displayId: action.displayId, vx: 0, vy: 0 };
  const floor = ground(placed, target);
  if (placed.y < floor) return enter(placed, 'drag', 0);
  return enter({ ...placed, y: floor }, 'idle', DEFAULT_IDLE_MS);
}

function recoverDisplay(state: ActorState, target: Target): ActorState {
  const known = findDisplay(target, state.displayId);
  const goalKnown =
    state.goalDisplayId === undefined || findDisplay(target, state.goalDisplayId) !== undefined;
  const goalDisplayId = goalKnown ? state.goalDisplayId : undefined;
  if (known) return { ...state, goalDisplayId };
  const containing = target.displays.find(
    (d) => state.x >= d.x && state.x < d.x + d.width && state.y >= d.y && state.y < d.y + d.height,
  );
  const display = containing ?? target.displays[0];
  if (!display) throw new Error('actor needs at least one display');
  const x = Math.min(Math.max(state.x, display.x), display.x + display.width - target.width);
  return {
    ...state,
    x,
    y: groundY(display, target.height),
    vx: 0,
    vy: 0,
    displayId: display.id,
    goalDisplayId,
    follow: initialFollow,
  };
}

export function reduce(state: ActorState, action: ActorAction, target: Target): ActorState {
  switch (action.type) {
    case 'tick':
      return tick(state, target, action);
    case 'drag-start':
      return enter({ ...state, vx: 0, vy: 0 }, 'drag', 0);
    case 'drag-end':
      return dragEnd(state, target, action);
    case 'alert':
      if (state.pose === 'drag' || !grounded(state, target)) return state;
      return enter(state, 'alert', ALERT_MS);
    case 'pause':
      return { ...state, paused: true };
    case 'resume':
      return enter({ ...state, paused: false }, 'idle', DEFAULT_IDLE_MS);
    case 'displays-changed':
      return recoverDisplay(state, target);
  }
}
