export const MOODS = ['dejected', 'stressed', 'uneasy', 'calm', 'cheerful', 'elated'] as const;
export type Mood = (typeof MOODS)[number];

export type MoodEventKind =
  'task-done' | 'task-done-late' | 'overdue-new' | 'nudge-shown' | 'quiet-hour';

export interface MoodEvent {
  kind: MoodEventKind;
  at: number;
}

export type Expression = 'bright' | 'plain' | 'low';

export interface MoodModifiers {
  expression: Expression;
  speedFactor: number;
  pauseFactor: number;
}

export interface Celebration {
  count: number;
  intensity: 1 | 2 | 3;
  titles: string[];
  at: number;
}
