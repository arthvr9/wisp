import { afterEach, describe, expect, it, vi } from 'vitest';

import { MUSIC_POLL_MS, MusicWatcher } from './index';
import type { MusicReader } from './mpris';
import type { MusicReading } from '../../shared/music';

// The watcher does nothing off Linux by design, so there is nothing to assert there.
const onLinux = process.platform === 'linux';

function reader(read: MusicReader['read']): MusicReader {
  return { read };
}

const empty = (at: number): MusicReading => ({ available: true, at, players: [] });

afterEach(() => {
  vi.useRealTimers();
});

describe.skipIf(!onLinux)('MusicWatcher', () => {
  it('polls on the interval and stops when told to', async () => {
    vi.useFakeTimers();
    let reads = 0;
    const watcher = new MusicWatcher(
      reader((at) => {
        reads += 1;
        return Promise.resolve(empty(at));
      }),
    );
    watcher.start();
    await vi.advanceTimersByTimeAsync(MUSIC_POLL_MS * 4);
    expect(reads).toBe(5);
    watcher.stop();
    await vi.advanceTimersByTimeAsync(MUSIC_POLL_MS * 5);
    expect(reads).toBe(5);
  });

  it('does not double its polling when started twice', async () => {
    vi.useFakeTimers();
    let reads = 0;
    const watcher = new MusicWatcher(
      reader((at) => {
        reads += 1;
        return Promise.resolve(empty(at));
      }),
    );
    watcher.start();
    // A second start used to drop the handle to the first interval and leave it running forever,
    // so stop() could only ever silence one of them.
    watcher.start();
    await vi.advanceTimersByTimeAsync(MUSIC_POLL_MS * 4);
    expect(reads).toBe(5);
    watcher.stop();
    await vi.advanceTimersByTimeAsync(MUSIC_POLL_MS * 5);
    expect(reads).toBe(5);
  });

  it('does not start a poll while one is still running', async () => {
    vi.useFakeTimers();
    let started = 0;
    let release = (): void => undefined;
    const watcher = new MusicWatcher(
      reader((at) => {
        started += 1;
        return new Promise<MusicReading>((resolve) => {
          release = () => {
            resolve(empty(at));
          };
        });
      }),
    );
    watcher.start();
    await vi.advanceTimersByTimeAsync(MUSIC_POLL_MS * 6);
    // A hung read must not stack up six more behind it.
    expect(started).toBe(1);
    release();
    watcher.stop();
  });

  it('gives up rather than spawning forever when the tool is not there', async () => {
    vi.useFakeTimers();
    let reads = 0;
    const watcher = new MusicWatcher(
      reader(() => {
        reads += 1;
        return Promise.reject(new Error('busctl: not found'));
      }),
    );
    watcher.start();
    await vi.advanceTimersByTimeAsync(MUSIC_POLL_MS * 20);
    expect(reads).toBeLessThanOrEqual(4);
    expect(watcher.current().available).toBe(false);
    watcher.stop();
  });
});
