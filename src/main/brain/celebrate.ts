import type { Celebration } from '../../shared/mood';

export const AGGREGATE_MS = 30_000;
export const MAX_TITLES = 3;

export interface CompletedTask {
  title: string;
  at: number;
}

export interface CelebrationState {
  pending: CompletedTask[];
  lastFlushAt: number;
}

export const initialCelebration: CelebrationState = { pending: [], lastFlushAt: 0 };

export function noteCompleted(
  state: CelebrationState,
  completed: CompletedTask[],
): CelebrationState {
  if (completed.length === 0) return state;
  const pending = [...state.pending, ...completed].sort((a, b) => a.at - b.at);
  return { ...state, pending };
}

function intensityFor(count: number): Celebration['intensity'] {
  if (count >= 4) return 3;
  if (count >= 2) return 2;
  return 1;
}

export function flushCelebration(
  state: CelebrationState,
  nowMs: number,
): { state: CelebrationState; celebration?: Celebration } {
  const oldest = state.pending[0];
  if (!oldest || nowMs - oldest.at < AGGREGATE_MS) return { state };
  const celebration: Celebration = {
    count: state.pending.length,
    intensity: intensityFor(state.pending.length),
    titles: state.pending.slice(0, MAX_TITLES).map((t) => t.title),
    at: nowMs,
  };
  return { state: { pending: [], lastFlushAt: nowMs }, celebration };
}
