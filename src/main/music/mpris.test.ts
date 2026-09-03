import { describe, expect, it } from 'vitest';

import {
  classifyPlayer,
  musicReader,
  parseBusNames,
  parsePlayerProperties,
  readMusic,
} from './mpris';
import type { RunBusctl } from './mpris';

// Captured from busctl --user --json=short on a GNOME session with Spotify and Firefox open.
// The name list is trimmed, the two property dumps are verbatim.
const NAMES =
  '{"type":"as","data":[["org.freedesktop.DBus","org.gnome.Nautilus",' +
  '"org.mpris.MediaPlayer2.firefox.instance_1_100",":1.100",' +
  '"org.mpris.MediaPlayer2.spotify",":1.115","org.gnome.Mutter.ScreenCast"]]}';

const SPOTIFY_PAUSED =
  '{"type":"a{sv}","data":[{"PlaybackStatus":{"type":"s","data":"Paused"},"LoopStatus":{"type":"s","data":"None"},"Rate":{"type":"d","data":1.000000000000000000000e+00},"Shuffle":{"type":"b","data":false},"Metadata":{"type":"a{sv}","data":{"mpris:trackid":{"type":"s","data":"/com/spotify/track/0123456789abcdefghijkl"},"mpris:length":{"type":"t","data":113000000},"mpris:artUrl":{"type":"s","data":"https://i.scdn.co/image/ab67616d0000b273000000000000000000000000"},"xesam:album":{"type":"s","data":"Example Album"},"xesam:albumArtist":{"type":"as","data":["Example Artist"]},"xesam:artist":{"type":"as","data":["Example Artist"]},"xesam:autoRating":{"type":"d","data":4.799999999999999822364e-01},"xesam:discNumber":{"type":"i","data":1},"xesam:title":{"type":"s","data":"Example Track"},"xesam:trackNumber":{"type":"i","data":1},"xesam:url":{"type":"s","data":"https://open.spotify.com/track/0123456789abcdefghijkl"}}},"Volume":{"type":"d","data":1.000000000000000000000e+00},"Position":{"type":"x","data":0},"MinimumRate":{"type":"d","data":1.000000000000000000000e+00},"MaximumRate":{"type":"d","data":1.000000000000000000000e+00},"CanGoNext":{"type":"b","data":true},"CanGoPrevious":{"type":"b","data":true},"CanPlay":{"type":"b","data":true},"CanPause":{"type":"b","data":true},"CanSeek":{"type":"b","data":true},"CanControl":{"type":"b","data":true}}]}';

// A real busctl dump with the track fields replaced by placeholders. The shape is what the
// parser is being tested against, and a listening history does not belong in a public repo.
// The same dump with PlaybackStatus flipped, rather than starting the machine owner's music.
const SPOTIFY_PLAYING = SPOTIFY_PAUSED.replace('"data":"Paused"', '"data":"Playing"');

// Firefox reports a fixed title and a single empty artist for any media, a call included.
const FIREFOX_PLAYING =
  '{"type":"a{sv}","data":[{"PlaybackStatus":{"type":"s","data":"Playing"},"Rate":{"type":"d","data":1.000000000000000000000e+00},"Metadata":{"type":"a{sv}","data":{"mpris:trackid":{"type":"o","data":"/org/mpris/MediaPlayer2/firefox"},"xesam:title":{"type":"s","data":"Firefox is playing media"},"xesam:album":{"type":"s","data":""},"xesam:artist":{"type":"as","data":[""]},"mpris:length":{"type":"x","data":1219000000}}},"Volume":{"type":"d","data":1.000000000000000000000e+00},"Position":{"type":"x","data":784000000},"CanGoNext":{"type":"b","data":false},"CanGoPrevious":{"type":"b","data":false},"CanPlay":{"type":"b","data":true},"CanPause":{"type":"b","data":true},"CanSeek":{"type":"b","data":true},"CanControl":{"type":"b","data":true}}]}';

/** Answers busctl calls from a table keyed by `list` or by the player bus name. */
function counting(replies: Record<string, string | undefined>): {
  run: RunBusctl;
  calls: string[];
} {
  const calls: string[] = [];
  const run: RunBusctl = (args) => {
    const target = args.includes('ListNames') ? 'list' : (args[3] ?? '');
    calls.push(target);
    return Promise.resolve(replies[target]);
  };
  return { run, calls };
}

function runner(replies: Record<string, string | undefined>): RunBusctl {
  return counting(replies).run;
}

describe('parseBusNames', () => {
  it('keeps only the MPRIS names out of a real ListNames reply', () => {
    expect(parseBusNames(NAMES)).toEqual([
      'org.mpris.MediaPlayer2.firefox.instance_1_100',
      'org.mpris.MediaPlayer2.spotify',
    ]);
  });

  it('returns nothing for output that is not a reply', () => {
    expect(parseBusNames('')).toEqual([]);
    expect(parseBusNames('Failed to call method: Connection refused')).toEqual([]);
    expect(parseBusNames('{"type":"as","data":[]}')).toEqual([]);
  });
});

describe('parsePlayerProperties', () => {
  it('reads a paused track with its title and artist', () => {
    expect(parsePlayerProperties(SPOTIFY_PAUSED)).toEqual({
      playing: false,
      title: 'Example Track',
      artist: 'Example Artist',
    });
  });

  it('reads a playing track', () => {
    expect(parsePlayerProperties(SPOTIFY_PLAYING)?.playing).toBe(true);
  });

  it('reads the browser placeholder and drops the empty artist', () => {
    expect(parsePlayerProperties(FIREFOX_PLAYING)).toEqual({
      playing: true,
      title: 'Firefox is playing media',
      artist: '',
    });
  });

  it('gives up on output that is not a property dump', () => {
    expect(parsePlayerProperties('')).toBeUndefined();
    expect(parsePlayerProperties('{"type":"a{sv}","data":[{}]}')).toBeUndefined();
    expect(parsePlayerProperties('{"type":"s","data":"Playing"}')).toBeUndefined();
  });
});

describe('classifyPlayer', () => {
  it('trusts dedicated players, whatever the instance suffix', () => {
    expect(classifyPlayer('spotify')).toEqual({ kind: 'player', confidence: 'trusted' });
    expect(classifyPlayer('vlc.instance7331')).toEqual({ kind: 'player', confidence: 'trusted' });
    expect(classifyPlayer('io.bassi.Amberol')).toEqual({ kind: 'player', confidence: 'trusted' });
  });

  it('does not trust a browser on its own', () => {
    expect(classifyPlayer('firefox.instance_1_100')).toEqual({
      kind: 'browser',
      confidence: 'unverified',
    });
    expect(classifyPlayer('chromium.instance2447')).toEqual({
      kind: 'browser',
      confidence: 'unverified',
    });
  });

  it('does not trust a client it has never heard of', () => {
    expect(classifyPlayer('com.example.Thing')).toEqual({
      kind: 'unknown',
      confidence: 'unverified',
    });
  });
});

describe('readMusic', () => {
  it('reads every player on the bus and marks the reading available', async () => {
    const reading = await readMusic(
      runner({
        list: NAMES,
        'org.mpris.MediaPlayer2.spotify': SPOTIFY_PLAYING,
        'org.mpris.MediaPlayer2.firefox.instance_1_100': FIREFOX_PLAYING,
      }),
      1000,
    );
    expect(reading.available).toBe(true);
    expect(reading.at).toBe(1000);
    expect(reading.players).toEqual([
      {
        id: 'firefox.instance_1_100',
        kind: 'browser',
        confidence: 'unverified',
        playing: true,
        title: 'Firefox is playing media',
        artist: '',
      },
      {
        id: 'spotify',
        kind: 'player',
        confidence: 'trusted',
        playing: true,
        title: 'Example Track',
        artist: 'Example Artist',
      },
    ]);
  });

  it('reports unavailable when busctl cannot be run', async () => {
    const reading = await readMusic(runner({}), 5);
    expect(reading).toEqual({ available: false, at: 5, players: [] });
  });

  it('skips a player that stopped answering between the list and the read', async () => {
    const reading = await readMusic(
      runner({ list: NAMES, 'org.mpris.MediaPlayer2.spotify': SPOTIFY_PAUSED }),
      0,
    );
    expect(reading.available).toBe(true);
    expect(reading.players.map((player) => player.id)).toEqual(['spotify']);
  });
});

describe('musicReader', () => {
  it('reuses the bus name list across reads', async () => {
    const { run, calls } = counting({
      list: NAMES,
      'org.mpris.MediaPlayer2.spotify': SPOTIFY_PLAYING,
      'org.mpris.MediaPlayer2.firefox.instance_1_100': FIREFOX_PLAYING,
    });
    const reader = musicReader(run);
    for (let i = 0; i < 6; i += 1) await reader.read(i);
    expect(calls.filter((call) => call === 'list')).toHaveLength(1);

    await reader.read(6);
    expect(calls.filter((call) => call === 'list')).toHaveLength(2);
  });

  it('lists again as soon as a player stops answering', async () => {
    const replies: Record<string, string | undefined> = {
      list: NAMES,
      'org.mpris.MediaPlayer2.spotify': SPOTIFY_PLAYING,
      'org.mpris.MediaPlayer2.firefox.instance_1_100': FIREFOX_PLAYING,
    };
    const { run, calls } = counting(replies);
    const reader = musicReader(run);
    await reader.read(0);
    replies['org.mpris.MediaPlayer2.firefox.instance_1_100'] = undefined;
    await reader.read(1);
    await reader.read(2);
    expect(calls.filter((call) => call === 'list')).toHaveLength(2);
  });

  it('stays unavailable while the bus cannot be listed', async () => {
    const reader = musicReader(counting({}).run);
    expect(await reader.read(1)).toEqual({ available: false, at: 1, players: [] });
    expect(await reader.read(2)).toEqual({ available: false, at: 2, players: [] });
  });
});
