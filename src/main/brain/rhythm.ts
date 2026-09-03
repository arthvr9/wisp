// The rhythm of a working day: a greeting on the first run of the day, a word when the day is
// over, one on a Friday afternoon, and one when you come back after being away. None of these
// carry information, so none of them are nudges and none of them go through the budget. They are
// the reason the mascot feels like it is sharing the day with you rather than reporting on it.
//
// Everything here is decided from local wall clock components on purpose. A working day is a
// local idea: six in the evening is the end of the day wherever you are, and a UTC hour is not.

export type RhythmEvent = 'morning' | 'endOfDay' | 'friday' | 'welcomeBack';

export interface RhythmConfig {
  /** Local hour from which the day counts as over. */
  endOfDayHour: number;
  /** Local hour from which a Friday counts as nearly over. */
  fridayHour: number;
  /** How long the cursor has to sit still before coming back counts as coming back. */
  awayMs: number;
}

export const DEFAULT_RHYTHM: RhythmConfig = {
  endOfDayHour: 18,
  fridayHour: 15,
  awayMs: 20 * 60 * 1000,
};

// Below this the cursor is being used again. It is not zero because a cursor drifts by a pixel
// on its own when a window repaints under it.
const BACK_BELOW_MS = 3000;
// A greeting after midday is not a greeting. Outside this window the day is marked as greeted so
// the line does not appear at two in the afternoon when the machine was switched on late.
const MORNING_FROM_HOUR = 5;
const MORNING_UNTIL_HOUR = 12;

export interface RhythmState {
  /** Local day key of the last time each event fired. */
  firedOn: Readonly<Partial<Record<RhythmEvent, string>>>;
  away: boolean;
}

export const initialRhythm: RhythmState = { firedOn: {}, away: false };

export interface RhythmInput {
  nowMs: number;
  /** How long the cursor has been still. */
  idleMs: number;
}

export interface RhythmResult {
  state: RhythmState;
  event?: RhythmEvent;
}

/** The local calendar day, used to fire each of these at most once a day. */
export function dayKey(nowMs: number): string {
  const d = new Date(nowMs);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export function step(
  state: RhythmState,
  input: RhythmInput,
  config: RhythmConfig = DEFAULT_RHYTHM,
): RhythmResult {
  const today = dayKey(input.nowMs);
  const at = new Date(input.nowMs);
  const hour = at.getHours();
  const isFriday = at.getDay() === 5;
  const isMorning = hour >= MORNING_FROM_HOUR && hour < MORNING_UNTIL_HOUR;
  const away = input.idleMs >= config.awayMs;
  const cameBack = state.away && input.idleMs < BACK_BELOW_MS;

  let next: RhythmState = { ...state, away };
  const firedToday = (event: RhythmEvent): boolean => next.firedOn[event] === today;
  const record = (event: RhythmEvent): RhythmState => ({
    ...next,
    firedOn: { ...next.firedOn, [event]: today },
  });
  const fire = (event: RhythmEvent): RhythmResult => ({ state: record(event), event });

  // Started after midday. Mark the greeting as spent without spending the step, so an evening
  // launch still reaches the end of day line on the same tick.
  if (!firedToday('morning') && hour >= MORNING_UNTIL_HOUR) next = record('morning');

  // Coming back answers something the user just did, so it outranks the rest. The exception is
  // the first return of a morning, which is arriving rather than returning.
  if (cameBack && isMorning && !firedToday('morning')) return fire('morning');
  if (cameBack) return { state: next, event: 'welcomeBack' };

  // Not while the machine is sitting there alone. A greeting delivered to an empty chair is
  // spent, and the person who arrives at nine gets nothing.
  if (isMorning && !firedToday('morning') && !away) return fire('morning');
  if (isFriday && hour >= config.fridayHour && !firedToday('friday')) return fire('friday');
  if (hour >= config.endOfDayHour && !firedToday('endOfDay')) return fire('endOfDay');
  return { state: next };
}
