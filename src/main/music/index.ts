import { musicReader } from './mpris';
import type { MusicReader } from './mpris';
import { emptyMusicReading } from '../../shared/music';
import type { MusicReading } from '../../shared/music';

export {
  busctlRunner,
  classifyPlayer,
  musicReader,
  parseBusNames,
  parsePlayerProperties,
  readMusic,
} from './mpris';
export type { MusicReader, PlayerProperties, RunBusctl } from './mpris';

/**
 * Playback changes on the scale of a song, so the mascot's 33 ms tick is the wrong rate for
 * it. One read costs about 7 ms of CPU on a session with two players, which at six seconds
 * works out near 0.12 percent of a core, under the mascot loop's own measured cost. Shorten
 * this and the reads, not the loop, become the most expensive thing the app does.
 */
export const MUSIC_POLL_MS = 6000;

// busctl is either there or it is not. Three failed cycles mean no session bus and no tool,
// which will not change while the app runs, so the poll stops instead of spawning forever.
const GIVE_UP_AFTER = 3;

export class MusicWatcher {
  private reading: MusicReading;
  private timer: NodeJS.Timeout | undefined;
  private polling = false;
  private failures = 0;

  constructor(
    private readonly reader: MusicReader = musicReader(),
    private readonly now: () => number = Date.now,
  ) {
    this.reading = emptyMusicReading(now());
  }

  start(): void {
    if (process.platform !== 'linux') return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), MUSIC_POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** The last reading. `available` is false until the first successful poll. */
  current(): MusicReading {
    return this.reading;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      this.reading = await this.reader.read(this.now());
      this.failures = this.reading.available ? 0 : this.failures + 1;
      if (this.failures >= GIVE_UP_AFTER) this.stop();
    } finally {
      this.polling = false;
    }
  }
}
