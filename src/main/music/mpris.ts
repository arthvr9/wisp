import { execFile } from 'node:child_process';

import { emptyMusicReading } from '../../shared/music';
import type {
  MusicConfidence,
  MusicPlayer,
  MusicReading,
  MusicSourceKind,
} from '../../shared/music';

const BUS_PREFIX = 'org.mpris.MediaPlayer2.';
const OBJECT_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player';
const TIMEOUT_MS = 3000;
// A player that embeds cover art as a data URI makes the property dump large.
const MAX_OUTPUT_BYTES = 1024 * 1024;

// Reading MPRIS means talking to the session bus, and every D-Bus binding on npm is a native
// module. This project ships none on purpose (see node:sqlite), so playback state is read by
// spawning busctl, which systemd puts on every Ubuntu and Debian GNOME system.
export type RunBusctl = (args: string[]) => Promise<string | undefined>;

export function busctlRunner(): RunBusctl {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        'busctl',
        args,
        { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
        (err, stdout) => {
          resolve(err ? undefined : stdout);
        },
      );
    });
}

// Matched against every dot separated segment of the bus name suffix, so both `vlc.instance42`
// and a reverse domain name like `io.bassi.Amberol` land on the right kind.
const MUSIC_PLAYERS = new Set([
  'amberol',
  'audacious',
  'clementine',
  'cmus',
  'deadbeef',
  'elisa',
  'gmusicbrowser',
  'lollypop',
  'mopidy',
  'mpd',
  'mpv',
  'ncspot',
  'pragha',
  'quodlibet',
  'rhythmbox',
  'rhythmbox3',
  'sayonara',
  'shortwave',
  'spotify',
  'spotifyd',
  'spotify-player',
  'strawberry',
  'tauonmb',
  'vlc',
]);

const BROWSERS = new Set([
  'brave',
  'chrome',
  'chromium',
  'edge',
  'epiphany',
  'firefox',
  'floorp',
  'google-chrome',
  'librewolf',
  'microsoft-edge',
  'opera',
  'plasma-browser-integration',
  'thorium',
  'vivaldi',
  'waterfox',
  'zen',
]);

export function classifyPlayer(id: string): { kind: MusicSourceKind; confidence: MusicConfidence } {
  const segments = id.toLowerCase().split('.');
  if (segments.some((s) => MUSIC_PLAYERS.has(s))) {
    return { kind: 'player', confidence: 'trusted' };
  }
  if (segments.some((s) => BROWSERS.has(s))) {
    return { kind: 'browser', confidence: 'unverified' };
  }
  // Anything unrecognised could as easily be a film or a game as a song, so it gets the same
  // treatment as a browser and the caller decides.
  return { kind: 'unknown', confidence: 'unverified' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Array.isArray widens unknown to any[], which the strict lint rules reject downstream.
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function variantData(value: unknown): unknown {
  return isRecord(value) ? value.data : undefined;
}

function isFilledString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function variantString(value: unknown): string {
  const data = variantData(value);
  if (typeof data === 'string') return data;
  if (isArray(data)) return data.filter(isFilledString).join(', ');
  return '';
}

/** Bus names of every MPRIS client currently on the session bus. */
export function parseBusNames(stdout: string): string[] {
  const data = variantData(parseJson(stdout));
  const names = isArray(data) ? data[0] : undefined;
  if (!isArray(names)) return [];
  return names.filter(
    (name): name is string => typeof name === 'string' && name.startsWith(BUS_PREFIX),
  );
}

export interface PlayerProperties {
  playing: boolean;
  title: string;
  artist: string;
}

/** Reads one player out of a `GetAll` dump. Undefined when the reply is not one. */
export function parsePlayerProperties(stdout: string): PlayerProperties | undefined {
  const reply = variantData(parseJson(stdout));
  const props = isArray(reply) ? reply[0] : undefined;
  if (!isRecord(props)) return undefined;
  const status = variantData(props.PlaybackStatus);
  if (typeof status !== 'string') return undefined;
  const metadata = variantData(props.Metadata);
  const fields = isRecord(metadata) ? metadata : {};
  return {
    playing: status === 'Playing',
    title: variantString(fields['xesam:title']),
    artist: variantString(fields['xesam:artist']),
  };
}

async function readPlayer(run: RunBusctl, busName: string): Promise<MusicPlayer | undefined> {
  const stdout = await run([
    '--user',
    '--json=short',
    'call',
    busName,
    OBJECT_PATH,
    'org.freedesktop.DBus.Properties',
    'GetAll',
    's',
    PLAYER_INTERFACE,
  ]);
  if (stdout === undefined) return undefined;
  const props = parsePlayerProperties(stdout);
  if (props === undefined) return undefined;
  const id = busName.slice(BUS_PREFIX.length);
  return { id, ...classifyPlayer(id), ...props };
}

async function listPlayers(run: RunBusctl): Promise<string[] | undefined> {
  const listed = await run([
    '--user',
    '--json=short',
    'call',
    'org.freedesktop.DBus',
    '/org/freedesktop/DBus',
    'org.freedesktop.DBus',
    'ListNames',
  ]);
  return listed === undefined ? undefined : parseBusNames(listed);
}

async function readPlayers(run: RunBusctl, names: string[], atMs: number): Promise<MusicReading> {
  const read = await Promise.all(names.map((name) => readPlayer(run, name)));
  return {
    available: true,
    at: atMs,
    players: read.filter((player): player is MusicPlayer => player !== undefined),
  };
}

/**
 * One process to list the bus, then one per MPRIS client. `ListNames` is used rather than
 * `busctl list` because the latter looks up the pid and unit of every connection on the bus.
 */
export async function readMusic(run: RunBusctl, atMs: number): Promise<MusicReading> {
  const names = await listPlayers(run);
  if (names === undefined) return emptyMusicReading(atMs);
  return readPlayers(run, names, atMs);
}

/** How many reads reuse the cached bus names before the list is asked for again. */
const LIST_EVERY = 5;

export interface MusicReader {
  read(atMs: number): Promise<MusicReading>;
}

/**
 * Every reading costs one short lived process per MPRIS client, so the list of clients is
 * kept between reads instead of being asked for each time. A player that appears is picked up
 * at the next refresh; one that disappears fails its own read and forces the refresh early.
 */
export function musicReader(run: RunBusctl = busctlRunner()): MusicReader {
  let names: string[] | undefined;
  let reuseLeft = 0;

  return {
    async read(atMs) {
      if (names === undefined || reuseLeft === 0) {
        names = await listPlayers(run);
        reuseLeft = LIST_EVERY;
      } else {
        reuseLeft -= 1;
      }
      if (names === undefined) return emptyMusicReading(atMs);
      const reading = await readPlayers(run, names, atMs);
      if (reading.players.length !== names.length) reuseLeft = 0;
      return reading;
    },
  };
}
