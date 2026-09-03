// Shaking the cursor over the mascot startles it. Detecting that from cursor samples is the whole
// of this file, and it is worth being strict about, because the cost of a false positive is a
// mascot that jumps while you are trying to work.
//
// Proximity is deliberately not checked here. This module only answers whether the cursor was
// shaken; whether it was shaken over the mascot is a question about window bounds, and window
// bounds live in the stage. The caller gates on both.

export interface CursorSample {
  x: number;
  y: number;
  tMs: number;
}

export interface ShakeOptions {
  /** How far back a shake is looked for. */
  windowMs: number;
  /** How many times the horizontal direction has to reverse inside that window. */
  minReversals: number;
  /** How far the cursor has to travel inside it, so a slow wiggle does not count. */
  minTravelPx: number;
  /** How long after a shake before another one can fire. */
  cooldownMs: number;
  /** Movement below this is noise: a cursor drifts a pixel when a window repaints under it. */
  minLegPx: number;
}

export const DEFAULT_SHAKE: ShakeOptions = {
  windowMs: 700,
  minReversals: 3,
  minTravelPx: 220,
  cooldownMs: 6000,
  minLegPx: 6,
};

export interface ShakeState {
  samples: readonly CursorSample[];
  lastFiredMs: number;
}

export const initialShake: ShakeState = { samples: [], lastFiredMs: Number.NEGATIVE_INFINITY };

export interface ShakeResult {
  state: ShakeState;
  shook: boolean;
}

export function feed(
  state: ShakeState,
  sample: CursorSample,
  options: ShakeOptions = DEFAULT_SHAKE,
): ShakeResult {
  const cutoff = sample.tMs - options.windowMs;
  const previous = state.samples[state.samples.length - 1];
  // A cursor that has not moved adds nothing but does not clear the window either, because a
  // sampling loop reports the same position twice whenever it runs faster than the mouse.
  const samples =
    previous?.x === sample.x && previous.y === sample.y
      ? state.samples.filter((s) => s.tMs >= cutoff)
      : [...state.samples, sample].filter((s) => s.tMs >= cutoff);

  if (sample.tMs - state.lastFiredMs < options.cooldownMs)
    return { state: { ...state, samples }, shook: false };

  let travel = 0;
  let reversals = 0;
  let direction = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    travel += Math.hypot(dx, b.y - a.y);
    if (Math.abs(dx) < options.minLegPx) continue;
    const sign = dx > 0 ? 1 : -1;
    if (direction !== 0 && sign !== direction) reversals += 1;
    direction = sign;
  }

  if (reversals < options.minReversals || travel < options.minTravelPx) {
    return { state: { ...state, samples }, shook: false };
  }
  // The window is cleared on a hit so the same swings cannot fire twice as they age out.
  return { state: { samples: [], lastFiredMs: sample.tMs }, shook: true };
}
