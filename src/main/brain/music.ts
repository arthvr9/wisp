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
