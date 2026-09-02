export interface FollowState {
  candidate?: number;
  heldMs: number;
}

export interface FollowResult {
  state: FollowState;
  goal?: number;
}

export const FOLLOW_HOLD_MS = 3000;

export const initialFollow: FollowState = { heldMs: 0 };

export function followCursor(
  state: FollowState,
  currentDisplayId: number,
  cursorDisplayId: number,
  dtMs: number,
  holdMs: number = FOLLOW_HOLD_MS,
): FollowResult {
  if (cursorDisplayId === currentDisplayId) return { state: initialFollow };
  if (state.candidate !== cursorDisplayId) {
    return { state: { candidate: cursorDisplayId, heldMs: 0 } };
  }
  const heldMs = state.heldMs + Math.max(dtMs, 0);
  const next = { candidate: cursorDisplayId, heldMs };
  return heldMs >= holdMs ? { state: next, goal: cursorDisplayId } : { state: next };
}
