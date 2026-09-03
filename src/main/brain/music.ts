import type { Pose } from '../../shared/actor';
import type { MusicPlayer, MusicReading } from '../../shared/music';

/**
 * Audio from an unverified source has to hold for this long before the dance starts, so a
 * notification sound or a two second preview in a tab does not set the mascot off. A real
 * music player reporting playback is evidence enough on its own and does not wait.
 */
export const DANCE_CONFIRM_MS = 6000;

/**
 * Silence is tolerated for this long before the dance stops. The gap between two tracks, and
 * the moment a player is stopped and started again, both fall well inside it.
 */
export const DANCE_HOLD_MS = 15_000;

export interface MusicState {
  dancing: boolean;
  /** When the current run of qualifying playback began. */
  runStartedAt: number | undefined;
  /** Last poll that saw qualifying playback. */
  lastSeenAt: number | undefined;
  /** Identifies the track. Holds user content, so it stays in memory and out of logs. */
  trackKey: string;
}

export const initialMusicState: MusicState = {
  dancing: false,
  runStartedAt: undefined,
  lastSeenAt: undefined,
  trackKey: '',
};

export interface MusicOptions {
  /**
   * Whether audio from a browser or an unrecognised client counts as music. Set it to false
   * while a meeting is running: a call reports playback exactly as a song does.
   */
  includeUnverified: boolean;
}

export interface MusicDecision {
  state: MusicState;
  dancing: boolean;
  started: boolean;
  stopped: boolean;
  /** True on the poll where a new track began while the dance was already running. */
  trackChanged: boolean;
  /** The player the decision is based on, undefined when nothing qualifies. */
  nowPlaying: MusicPlayer | undefined;
}

function trackKey(player: MusicPlayer): string {
  return [player.id, player.title, player.artist].join(' ');
}

/** A trusted player wins over browser audio, so a song beats a video left open in a tab. */
export function pickPlayer(reading: MusicReading, options: MusicOptions): MusicPlayer | undefined {
  const playing = reading.players.filter((player) => player.playing);
  const trusted = playing.find((player) => player.confidence === 'trusted');
  if (trusted) return trusted;
  return options.includeUnverified ? playing[0] : undefined;
}

function settle(
  state: MusicState,
  next: MusicState,
  nowPlaying: MusicPlayer | undefined,
): MusicDecision {
  return {
    state: next,
    dancing: next.dancing,
    started: next.dancing && !state.dancing,
    stopped: !next.dancing && state.dancing,
    trackChanged:
      next.dancing && state.dancing && next.trackKey !== '' && next.trackKey !== state.trackKey,
    nowPlaying,
  };
}

export function decideMusic(
  state: MusicState,
  reading: MusicReading,
  nowMs: number,
  options: MusicOptions,
): MusicDecision {
  if (!reading.available) return settle(state, initialMusicState, undefined);

  const player = pickPlayer(reading, options);
  if (player === undefined) {
    const held = state.lastSeenAt !== undefined && nowMs - state.lastSeenAt < DANCE_HOLD_MS;
    return settle(state, held ? state : initialMusicState, undefined);
  }

  const runStartedAt = state.runStartedAt ?? nowMs;
  const confirmed = player.confidence === 'trusted' || nowMs - runStartedAt >= DANCE_CONFIRM_MS;
  return settle(
    state,
    {
      dancing: state.dancing || confirmed,
      runStartedAt,
      lastSeenAt: nowMs,
      trackKey: trackKey(player),
    },
    player,
  );
}

// Poses a dance is allowed to interrupt. Everything missing from this list is either running
// out a timer that answers something the user just did, or is the user's own hand on the mascot:
// a nudge is up for twelve seconds, a celebration for up to six, petting for two and a half, and
// a drag lasts as long as the mouse is down. A six second poll that started a dance from any of
// them would cut them all short, and would undo the reason the pet pose is dispatched
// unconditionally in the first place. Sleep is left out on purpose: music starting while nobody
// has touched anything for five minutes is not a reason to get up.
const DANCE_INTERRUPTS: readonly Pose[] = ['idle', 'sit', 'walk'];

/**
 * What to dispatch so the pose agrees with what the music is doing, or nothing when they already
 * agree or when the mascot is busy with something that should finish first. Comparing the two
 * rather than acting on the moment the music started is what makes this safe: the reducer is
 * free to drop a dance, and it does, since a drag, a nudge or a celebration all take the pose
 * away. Acting only on the edge leaves the caller believing it is still dancing when it is not,
 * and the dance can never come back after the interruption.
 */
export function danceAction(
  pose: Pose,
  dancing: boolean,
  paused: boolean,
): 'dance-start' | 'dance-stop' | undefined {
  const wants = dancing && !paused;
  if (wants && pose !== 'dance') {
    return DANCE_INTERRUPTS.includes(pose) ? 'dance-start' : undefined;
  }
  if (!wants && pose === 'dance') return 'dance-stop';
  return undefined;
}
