/** What kind of MPRIS client reported the playback. */
export type MusicSourceKind = 'player' | 'browser' | 'unknown';

/**
 * A dedicated music player is trusted as music. A browser is not: it reports the same
 * "Playing" for a song, a video and a call, so the caller decides whether unverified audio
 * counts, for example by refusing it while a meeting is running.
 */
export type MusicConfidence = 'trusted' | 'unverified';

export interface MusicPlayer {
  /** Bus name suffix after org.mpris.MediaPlayer2, for example `spotify`. */
  id: string;
  kind: MusicSourceKind;
  confidence: MusicConfidence;
  playing: boolean;
  /** User content. Show it, never log it. Empty when the player reports no metadata. */
  title: string;
  /** User content, same rule as the title. */
  artist: string;
}

/**
 * `available` is false on a platform without an MPRIS bus, or when busctl is missing. It is
 * not an error: the rest of the app carries on with an empty list.
 */
export interface MusicReading {
  available: boolean;
  at: number;
  players: MusicPlayer[];
}

export const emptyMusicReading = (at: number): MusicReading => ({
  available: false,
  at,
  players: [],
});
