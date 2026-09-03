import type { Facing, Pose } from '../../shared/actor';
import type { MoodModifiers } from '../../shared/mood';
import { followCursor, initialFollow } from './follow';
import type { FollowState } from './follow';
import {
  FLING_HARD_PX_S,
  MAX_BOUNCES,
  WALK_ACCEL_PX_S2,
  directionTo,
  fly,
  groundY,
  walk,
} from './movement';
import type { DisplayArea, Target } from './movement';
import { chooseSpot, fleeSpot, lookMs, nearestEdgeSpot, nextLeg, roostMs } from './roost';
import type { Rng, Spot } from './roost';

export type { Rng };

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
  walkDistance: number;
  goalDisplayId?: number;
  paused: boolean;
  follow: FollowState;
  celebrateIntensity?: Intensity;
  spot?: Spot;
  legX?: number;
  resume?: Resume;
  bounces: number;
  flung: boolean;
}

export interface Resume {
  pose: Pose;
  untilMs: number;
}

export type Intensity = 1 | 2 | 3;

export interface Cursor {
  displayId: number | undefined;
  idleMs: number;
}

export type ActorAction =
  | {
      type: 'tick';
      dtMs: number;
      rng: Rng;
      cursor: Cursor;
      followCursor: boolean;
      mood?: MoodModifiers;
    }
  | { type: 'celebrate'; intensity: Intensity }
  | { type: 'drag-start' }
  | { type: 'drag-end'; x: number; y: number; displayId: number; vx?: number; vy?: number }
  | { type: 'alert'; ms?: number }
  | { type: 'dance-start' }
  | { type: 'dance-stop' }
  | { type: 'pet'; ms?: number }
  | { type: 'startle'; cursorX?: number; ms?: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'displays-changed' };

export const WALK_SPEED_PX_S = 70;
export const SLEEP_AFTER_MS = 5 * 60_000;
export const WAKE_BELOW_MS = 1000;
export const ALERT_MS = 1500;
export const IDLE_MS: readonly [number, number] = [2000, 6000];
export const SIT_MS: readonly [number, number] = [6000, 15_000];
export const DEFAULT_IDLE_MS = 4000;
export const CELEBRATE_MS: Record<Intensity, number> = { 1: 2500, 2: 4000, 3: 6000 };
export const PET_MS = 2500;
export const STARTLE_MS = 1500;
export const STARTLE_FLEE_PX = 260;
export const LAND_BEAT_MS = 700;
// A walk ends when the mascot arrives, not when a timer runs out. These caps only exist so a
// destination that turns out to be unreachable cannot hold the walk pose for ever.
export const WALK_TIMEOUT_MS = 30_000;
export const CROSS_TIMEOUT_MS = 60_000;
export const ARRIVE_PX = 32;

// The last few pixels are not worth walking. Without a dead zone the mascot creeps past the
// destination by a pixel and turns round for it, over and over, which reads as a twitch.
const BRAKE_MARGIN_PX = 6;

const WANDER_ROLL = 0.65;
const SIT_ROLL = 0.9;

const NEUTRAL: MoodModifiers = { expression: 'plain', speedFactor: 1, pauseFactor: 1 };

const RESTING: readonly Pose[] = ['idle', 'sit', 'sleep'];
// Dance is deliberately not on this list. Music playing is evidence that somebody is there, and
// reading a long page with an album on is exactly the case where a cursor sits still for five
// minutes. The dance ends when the music does, which is the right thing to wait for.
const SLEEPY: readonly Pose[] = ['idle', 'sit'];

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
    walkDistance: 0,
    paused: false,
    follow: initialFollow,
    bounces: 0,
    flung: false,
  };
}

function between(rng: Rng, range: readonly [number, number]): number {
  return range[0] + rng() * (range[1] - range[0]);
}

function rest(rng: Rng, range: readonly [number, number], mood: MoodModifiers): number {
  return between(rng, range) * mood.pauseFactor;
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

// A mascot on the way up from a bounce sits exactly on the ground line with a negative vy, so
// height alone cannot say whether it is still in the air.
function airborne(state: ActorState, target: Target): boolean {
  return state.y < ground(state, target) || state.vy < 0;
}

function enter(state: ActorState, pose: Pose, untilMs: number): ActorState {
  return {
    ...state,
    pose,
    poseMs: 0,
    poseUntilMs: untilMs,
    walkDistance: 0,
    celebrateIntensity: undefined,
    resume: undefined,
  };
}

function facingOf(vx: number, fallback: Facing): Facing {
  if (vx < 0) return 'left';
  if (vx > 0) return 'right';
  return fallback;
}

function startLeg(state: ActorState, rng: Rng): ActorState {
  const spot = state.spot;
  if (!spot) return state;
  const legX = nextLeg(state.x, spot.x, rng);
  const facing: Facing = legX < state.x ? 'left' : 'right';
  return enter({ ...state, facing, legX }, 'walk', WALK_TIMEOUT_MS);
}

function startJourney(state: ActorState, target: Target, rng: Rng): ActorState {
  const spot = chooseSpot(displayOf(state, target), target.width, state.x, rng);
  return startLeg({ ...state, spot }, rng);
}

function startCross(state: ActorState, target: Target, rng: Rng): ActorState {
  const goal = state.goalDisplayId;
  const direction = goal === undefined ? 0 : directionTo(target.displays, state.displayId, goal);
  if (direction === 0) return startJourney(state, target, rng);
  const facing: Facing = direction < 0 ? 'left' : 'right';
  return enter({ ...state, facing, spot: undefined, legX: undefined }, 'walk', CROSS_TIMEOUT_MS);
}

function nextPose(state: ActorState, target: Target, rng: Rng, mood: MoodModifiers): ActorState {
  if (state.goalDisplayId !== undefined) return startCross(state, target, rng);
  if (state.spot !== undefined) return startLeg(state, rng);
  if (state.pose !== 'idle') return enter(state, 'idle', rest(rng, IDLE_MS, mood));
  const roll = rng();
  if (roll < WANDER_ROLL) return startJourney(state, target, rng);
  if (roll < SIT_ROLL) return enter(state, 'sit', rest(rng, SIT_MS, mood));
  return enter(state, 'idle', rest(rng, IDLE_MS, mood));
}

function goalSpeed(state: ActorState, mood: MoodModifiers): number {
  if (state.pose !== 'walk' || state.paused) return 0;
  const cruise = WALK_SPEED_PX_S * mood.speedFactor;
  if (state.legX === undefined) return state.facing === 'left' ? -cruise : cruise;
  const dx = state.legX - state.x;
  const left = Math.abs(dx) - BRAKE_MARGIN_PX;
  if (left <= 0) return 0;
  // Fastest it can still be going and stop on the spot, v = sqrt(2 a d), so the approach slows
  // down by itself instead of switching between full speed and a full stop.
  const approach = Math.min(cruise, Math.sqrt(2 * WALK_ACCEL_PX_S2 * left));
  return dx < 0 ? -approach : approach;
}

function move(state: ActorState, target: Target, dtMs: number, mood: MoodModifiers): ActorState {
  const { x, y, vx, displayId } = state;
  const moved = walk({ x, y, vx, displayId }, target, dtMs, goalSpeed(state, mood), {
    grounded: true,
  });
  const facing = state.pose === 'walk' ? facingOf(moved.vx, state.facing) : state.facing;
  // Distance, not velocity times time: a bounce reflects x within the tick, and what the paws
  // have to account for is the ground the window actually covered on screen.
  const walked = state.pose === 'walk' ? Math.abs(moved.x - state.x) : 0;
  return { ...state, ...moved, facing, walkDistance: state.walkDistance + walked };
}

function arrive(state: ActorState, rng: Rng, mood: MoodModifiers): ActorState {
  const legX = state.legX;
  if (state.pose !== 'walk' || legX === undefined || state.paused) return state;
  if (state.vx !== 0 || Math.abs(state.x - legX) > ARRIVE_PX) return state;
  const spot = state.spot;
  if (spot?.displayId === state.displayId && Math.abs(state.x - spot.x) <= ARRIVE_PX) {
    const settled: Pose = spot.kind === 'open' ? 'idle' : 'sit';
    const stay = roostMs(spot.kind, rng) * mood.pauseFactor;
    return enter({ ...state, spot: undefined, legX: undefined }, settled, stay);
  }
  return enter({ ...state, legX: undefined }, 'idle', lookMs(rng) * mood.pauseFactor);
}

function landing(state: ActorState, target: Target, rng: Rng, mood: MoodModifiers): ActorState {
  const settled = { ...state, vx: 0, vy: 0, bounces: 0, flung: false, legX: undefined };
  if (!state.flung) {
    return enter({ ...settled, spot: undefined }, 'idle', rest(rng, IDLE_MS, mood));
  }
  // Thrown hard: it picks itself up and puts itself back against the nearest side.
  const spot = nearestEdgeSpot(displayOf(settled, target), target.width, settled.x);
  return enter({ ...settled, spot }, 'idle', LAND_BEAT_MS * mood.pauseFactor);
}

function fall(
  state: ActorState,
  target: Target,
  dtMs: number,
  rng: Rng,
  mood: MoodModifiers,
): ActorState {
  const result = fly(
    {
      x: state.x,
      y: state.y,
      vx: state.vx,
      vy: state.vy,
      displayId: state.displayId,
      bounces: state.bounces,
    },
    target,
    dtMs,
    state.flung ? MAX_BOUNCES : 0,
  );
  const f = result.flight;
  const next: ActorState = {
    ...state,
    x: f.x,
    y: f.y,
    vx: f.vx,
    vy: f.vy,
    displayId: f.displayId,
    bounces: f.bounces,
    facing: facingOf(f.vx, state.facing),
  };
  return result.resting ? landing(next, target, rng, mood) : next;
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
  // A stale cursor sample freezes the hysteresis instead of resetting it. Under XWayland the
  // position stops updating whenever the pointer leaves an X11 window, and a pointer resting
  // on another monitor produces the same reading as a pointer that walked away, so resetting
  // here would make the hold unreachable in practice.
  if (cursor.displayId === undefined) return state;
  const result = followCursor(state.follow, state.displayId, cursor.displayId, dtMs);
  const back = cursor.displayId === state.displayId;
  const goalDisplayId = back
    ? undefined
    : result.goal !== undefined && result.goal !== state.displayId
      ? result.goal
      : state.goalDisplayId;
  return { ...state, follow: result.state, goalDisplayId };
}

function clearReachedGoal(state: ActorState): ActorState {
  if (state.goalDisplayId !== state.displayId) return state;
  return { ...state, goalDisplayId: undefined };
}

// The cross to another monitor ends the moment the mascot lands on it. It has no destination
// there yet, so it picks one instead of carrying on in a straight line off the far side.
function reachedGoalDisplay(state: ActorState, target: Target, rng: Rng): ActorState {
  if (state.goalDisplayId !== state.displayId) return state;
  const cleared = { ...state, goalDisplayId: undefined };
  return cleared.pose === 'walk' ? startJourney(cleared, target, rng) : cleared;
}

function dropStaleSpot(state: ActorState): ActorState {
  if (state.spot === undefined || state.spot.displayId === state.displayId) return state;
  return { ...state, spot: undefined, legX: undefined };
}

function applySleep(state: ActorState, cursor: Cursor, rng: Rng, mood: MoodModifiers): ActorState {
  if (state.pose === 'sleep') {
    return cursor.idleMs < WAKE_BELOW_MS ? enter(state, 'idle', rest(rng, IDLE_MS, mood)) : state;
  }
  if (cursor.idleMs >= SLEEP_AFTER_MS && SLEEPY.includes(state.pose)) {
    return enter({ ...state, spot: undefined, legX: undefined }, 'sleep', 0);
  }
  return state;
}

function expired(state: ActorState): boolean {
  return state.poseUntilMs > 0 && state.poseMs >= state.poseUntilMs;
}

function expire(state: ActorState, target: Target, rng: Rng, mood: MoodModifiers): ActorState {
  if (!expired(state)) return state;
  const back = state.resume;
  if (state.pose === 'pet' && back) return enter(state, back.pose, back.untilMs);
  if (state.pose === 'walk') {
    // Only reached when the destination stayed out of reach for the whole cap.
    return enter({ ...state, spot: undefined, legX: undefined }, 'idle', rest(rng, IDLE_MS, mood));
  }
  return nextPose(state, target, rng, mood);
}

function age(state: ActorState, dtMs: number): ActorState {
  return { ...state, poseMs: state.poseMs + Math.max(dtMs, 0) };
}

function tickPaused(
  state: ActorState,
  target: Target,
  dtMs: number,
  mood: MoodModifiers,
): ActorState {
  let next = state;
  if (next.pose === 'celebrate') {
    next = age(next, dtMs);
    if (expired(next)) next = enter(next, 'idle', DEFAULT_IDLE_MS);
  }
  return move(next, target, dtMs, mood);
}

function tick(
  state: ActorState,
  target: Target,
  action: Extract<ActorAction, { type: 'tick' }>,
): ActorState {
  const { dtMs, rng, cursor } = action;
  const mood = action.mood ?? NEUTRAL;
  if (airborne(state, target)) return fall(state, target, dtMs, rng, mood);
  if (state.pose === 'drag') return state;

  let next = clearReachedGoal(applyFollow(state, cursor, dtMs, action.followCursor));
  if (next.paused) return tickPaused(next, target, dtMs, mood);

  next = applySleep(age(next, dtMs), cursor, rng, mood);
  if (next.goalDisplayId !== undefined && RESTING.includes(next.pose)) {
    next = startCross(next, target, rng);
  }
  next = dropStaleSpot(expire(next, target, rng, mood));
  return arrive(reachedGoalDisplay(move(next, target, dtMs, mood), target, rng), rng, mood);
}

function celebrate(state: ActorState, target: Target, intensity: Intensity): ActorState {
  if (state.pose === 'drag' || airborne(state, target)) return state;
  return { ...enter(state, 'celebrate', CELEBRATE_MS[intensity]), celebrateIntensity: intensity };
}

function pet(state: ActorState, target: Target, ms: number): ActorState {
  if (state.pose === 'drag' || airborne(state, target)) return state;
  if (state.pose === 'pet') return { ...state, poseMs: 0, poseUntilMs: ms };
  const left = state.poseUntilMs === 0 ? 0 : Math.max(state.poseUntilMs - state.poseMs, 0);
  const resume: Resume = { pose: state.pose, untilMs: left };
  return { ...enter(state, 'pet', ms), resume };
}

function startle(
  state: ActorState,
  target: Target,
  action: Extract<ActorAction, { type: 'startle' }>,
): ActorState {
  if (state.pose === 'drag' || airborne(state, target)) return state;
  const away = action.cursorX ?? state.x + target.width / 2;
  const spot = fleeSpot(displayOf(state, target), target.width, state.x, away, STARTLE_FLEE_PX);
  return enter({ ...state, spot, legX: undefined }, 'startle', action.ms ?? STARTLE_MS);
}

function dragEnd(
  state: ActorState,
  target: Target,
  action: Extract<ActorAction, { type: 'drag-end' }>,
): ActorState {
  const vx = action.vx ?? 0;
  const vy = action.vy ?? 0;
  const flung = Math.hypot(vx, vy) >= FLING_HARD_PX_S;
  const placed: ActorState = {
    ...state,
    x: action.x,
    y: action.y,
    displayId: action.displayId,
    vx,
    vy,
    flung,
    bounces: 0,
    spot: undefined,
    legX: undefined,
  };
  const floor = ground(placed, target);
  if (placed.y < floor || vy < 0) return enter(placed, 'drag', 0);
  const down = { ...placed, y: floor, vy: 0 };
  if (flung) {
    const spot = nearestEdgeSpot(displayOf(down, target), target.width, down.x);
    return enter({ ...down, vx: 0, flung: false, spot }, 'idle', LAND_BEAT_MS);
  }
  return enter({ ...down, vx: 0 }, 'idle', DEFAULT_IDLE_MS);
}

function recoverDisplay(state: ActorState, target: Target): ActorState {
  const known = findDisplay(target, state.displayId);
  const goalKnown =
    state.goalDisplayId === undefined || findDisplay(target, state.goalDisplayId) !== undefined;
  const goalDisplayId = goalKnown ? state.goalDisplayId : undefined;
  if (known) return dropStaleSpot({ ...state, goalDisplayId });
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
    spot: undefined,
    legX: undefined,
    follow: initialFollow,
  };
}

export function reduce(state: ActorState, action: ActorAction, target: Target): ActorState {
  switch (action.type) {
    case 'tick':
      return tick(state, target, action);
    case 'drag-start':
      return enter({ ...state, vx: 0, vy: 0, spot: undefined, legX: undefined }, 'drag', 0);
    case 'drag-end':
      return dragEnd(state, target, action);
    case 'alert':
      if (state.pose === 'drag' || airborne(state, target)) return state;
      return enter(state, 'alert', action.ms ?? ALERT_MS);
    case 'celebrate':
      return celebrate(state, target, action.intensity);
    case 'dance-start':
      if (state.pose === 'drag' || airborne(state, target)) return state;
      return enter({ ...state, spot: undefined, legX: undefined }, 'dance', 0);
    case 'dance-stop':
      if (state.pose !== 'dance') return state;
      return enter(state, 'idle', DEFAULT_IDLE_MS);
    case 'pet':
      return pet(state, target, action.ms ?? PET_MS);
    case 'startle':
      return startle(state, target, action);
    case 'pause':
      return { ...state, paused: true };
    case 'resume':
      return enter(
        { ...state, paused: false, spot: undefined, legX: undefined },
        'idle',
        DEFAULT_IDLE_MS,
      );
    case 'displays-changed':
      return recoverDisplay(state, target);
  }
}
