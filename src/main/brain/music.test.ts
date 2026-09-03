import { describe, expect, it } from 'vitest';

import {
  DANCE_CONFIRM_MS,
  DANCE_HOLD_MS,
  danceAction,
  decideMusic,
  initialMusicState,
} from './music';
import type { MusicOptions, MusicState } from './music';
import type { MusicPlayer, MusicReading } from '../../shared/music';

const spotify = (playing: boolean, title = 'sixmas'): MusicPlayer => ({
  id: 'spotify',
  kind: 'player',
  confidence: 'trusted',
  playing,
  title,
  artist: 'shy the eternal',
});

const firefox = (playing: boolean): MusicPlayer => ({
  id: 'firefox.instance_1_100',
  kind: 'browser',
  confidence: 'unverified',
  playing,
  title: 'Firefox is playing media',
  artist: '',
});

const reading = (at: number, players: MusicPlayer[]): MusicReading => ({
  available: true,
  at,
  players,
});

const WITH_BROWSERS: MusicOptions = { includeUnverified: true };
const PLAYERS_ONLY: MusicOptions = { includeUnverified: false };

/** Runs one poll every `stepMs` and returns the state after the last one. */
function poll(
  state: MusicState,
  players: MusicPlayer[],
  from: number,
  count: number,
  stepMs: number,
  options: MusicOptions = WITH_BROWSERS,
): MusicState {
  let current = state;
  for (let i = 0; i < count; i += 1) {
    const at = from + i * stepMs;
    current = decideMusic(current, reading(at, players), at, options).state;
  }
  return current;
}

describe('decideMusic', () => {
  it('dances on the first poll of a real music player', () => {
    const first = decideMusic(initialMusicState, reading(0, [spotify(true)]), 0, WITH_BROWSERS);
    expect(first.dancing).toBe(true);
    expect(first.started).toBe(true);
    expect(first.nowPlaying?.id).toBe('spotify');
  });

  it('waits out the confirmation before dancing to browser audio', () => {
    const first = decideMusic(initialMusicState, reading(0, [firefox(true)]), 0, WITH_BROWSERS);
    expect(first.dancing).toBe(false);
    expect(first.started).toBe(false);
    expect(first.nowPlaying?.id).toBe('firefox.instance_1_100');

    const later = decideMusic(
      first.state,
      reading(DANCE_CONFIRM_MS, [firefox(true)]),
      DANCE_CONFIRM_MS,
      WITH_BROWSERS,
    );
    expect(later.dancing).toBe(true);
    expect(later.started).toBe(true);
  });

  it('reports the start only once', () => {
    const state = poll(initialMusicState, [spotify(true)], 0, 3, 4000);
    const next = decideMusic(state, reading(20_000, [spotify(true)]), 20_000, WITH_BROWSERS);
    expect(next.dancing).toBe(true);
    expect(next.started).toBe(false);
  });

  it('keeps dancing through the gap between two tracks', () => {
    const dancing = poll(initialMusicState, [spotify(true)], 0, 3, 4000);
    const gap = decideMusic(dancing, reading(12_000, [spotify(false)]), 12_000, WITH_BROWSERS);
    expect(gap.dancing).toBe(true);
    expect(gap.stopped).toBe(false);

    const back = decideMusic(
      gap.state,
      reading(14_000, [spotify(true, 'another song')]),
      14_000,
      WITH_BROWSERS,
    );
    expect(back.dancing).toBe(true);
    expect(back.started).toBe(false);
    expect(back.trackChanged).toBe(true);
  });

  it('stops once the silence outlasts the hold', () => {
    const dancing = poll(initialMusicState, [spotify(true)], 0, 3, 4000);
    const at = 8000 + DANCE_HOLD_MS;
    const quiet = decideMusic(dancing, reading(at, [spotify(false)]), at, WITH_BROWSERS);
    expect(quiet.dancing).toBe(false);
    expect(quiet.stopped).toBe(true);
    expect(quiet.state).toEqual(initialMusicState);
  });

  it('does not report a track change while paused', () => {
    const dancing = poll(initialMusicState, [spotify(true)], 0, 3, 4000);
    const gap = decideMusic(dancing, reading(12_000, []), 12_000, WITH_BROWSERS);
    expect(gap.trackChanged).toBe(false);
  });

  it('dances to browser audio only when unverified sources are allowed', () => {
    const allowed = poll(initialMusicState, [firefox(true)], 0, 3, 4000, WITH_BROWSERS);
    expect(allowed.dancing).toBe(true);

    const refused = poll(initialMusicState, [firefox(true)], 0, 3, 4000, PLAYERS_ONLY);
    expect(refused.dancing).toBe(false);
  });

  it('still dances to a real player while browser audio is refused', () => {
    const state = poll(initialMusicState, [firefox(true), spotify(true)], 0, 3, 4000, PLAYERS_ONLY);
    expect(state.dancing).toBe(true);
    const decision = decideMusic(
      state,
      reading(12_000, [firefox(true), spotify(true)]),
      12_000,
      PLAYERS_ONLY,
    );
    expect(decision.nowPlaying?.id).toBe('spotify');
  });

  it('prefers the trusted player over browser audio', () => {
    const decision = decideMusic(
      initialMusicState,
      reading(0, [firefox(true), spotify(true)]),
      0,
      WITH_BROWSERS,
    );
    expect(decision.nowPlaying?.id).toBe('spotify');
  });

  it('lets the dance lapse when browser audio stops counting', () => {
    const dancing = poll(initialMusicState, [firefox(true)], 0, 3, 4000, WITH_BROWSERS);
    expect(dancing.dancing).toBe(true);
    const held = decideMusic(dancing, reading(12_000, [firefox(true)]), 12_000, PLAYERS_ONLY);
    expect(held.dancing).toBe(true);
    const at = 8000 + DANCE_HOLD_MS;
    const later = decideMusic(held.state, reading(at, [firefox(true)]), at, PLAYERS_ONLY);
    expect(later.dancing).toBe(false);
    expect(later.stopped).toBe(true);
  });

  it('stops without waiting when the reading is unavailable', () => {
    const dancing = poll(initialMusicState, [spotify(true)], 0, 3, 4000);
    const gone = decideMusic(
      dancing,
      { available: false, at: 9000, players: [] },
      9000,
      WITH_BROWSERS,
    );
    expect(gone.dancing).toBe(false);
    expect(gone.stopped).toBe(true);
    expect(gone.state).toEqual(initialMusicState);
  });

  it('does nothing at all on a machine without an MPRIS bus', () => {
    let state = initialMusicState;
    for (let i = 0; i < 10; i += 1) {
      const decision = decideMusic(
        state,
        { available: false, at: i * 4000, players: [] },
        i * 4000,
        WITH_BROWSERS,
      );
      expect(decision.dancing).toBe(false);
      expect(decision.started).toBe(false);
      expect(decision.stopped).toBe(false);
      state = decision.state;
    }
  });
});

describe('danceAction', () => {
  it('starts when the music is on and the mascot is doing something else', () => {
    expect(danceAction('idle', true, false)).toBe('dance-start');
    expect(danceAction('walk', true, false)).toBe('dance-start');
  });

  it('says nothing when the pose already agrees', () => {
    expect(danceAction('dance', true, false)).toBeUndefined();
    expect(danceAction('idle', false, false)).toBeUndefined();
  });

  it('stops when the music stops', () => {
    expect(danceAction('dance', false, false)).toBe('dance-stop');
  });

  it('brings the dance back after something else took the pose away', () => {
    // A nudge, a celebration or a drag all end the dance in the reducer. The music has not
    // changed, so the next poll has to notice and start it again.
    for (const pose of ['alert', 'celebrate', 'drag', 'sit'] as const) {
      expect(danceAction(pose, true, false)).toBe('dance-start');
    }
  });

  it('does not dance while paused, and ends a dance that was running', () => {
    expect(danceAction('idle', true, true)).toBeUndefined();
    expect(danceAction('dance', true, true)).toBe('dance-stop');
  });
});
