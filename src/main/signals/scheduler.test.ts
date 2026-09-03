import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Scheduler, nextDelayMs } from './scheduler';

describe('nextDelayMs', () => {
  it('returns the base with no failures and jitter in [0.5, 1.5)', () => {
    expect(nextDelayMs({ baseMs: 1000, failures: 0, rng: () => 0 })).toBe(500);
    expect(nextDelayMs({ baseMs: 1000, failures: 0, rng: () => 0.5 })).toBe(1000);
    expect(nextDelayMs({ baseMs: 1000, failures: 0, rng: () => 0.999 })).toBe(1499);
  });

  it('doubles per failure', () => {
    expect(nextDelayMs({ baseMs: 1000, failures: 1, rng: () => 0.5 })).toBe(2000);
    expect(nextDelayMs({ baseMs: 1000, failures: 3, rng: () => 0.5 })).toBe(8000);
  });

  it('never returns more than maxMs, jitter included', () => {
    expect(nextDelayMs({ baseMs: 1000, failures: 10, rng: () => 0.99, maxMs: 5000 })).toBe(5000);
    expect(nextDelayMs({ baseMs: 1000, failures: 10, rng: () => 0.5, maxMs: 5000 })).toBe(5000);
    expect(nextDelayMs({ baseMs: 1000, failures: 0, rng: () => 0, maxMs: 5000 })).toBe(500);
    expect(nextDelayMs({ baseMs: 60_000, failures: 20, rng: () => 0.99 })).toBe(60 * 60_000);
  });
});

describe('Scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs immediately on start and reschedules after the base delay', async () => {
    const run = vi.fn(() => Promise.resolve());
    const scheduled: number[] = [];
    const s = new Scheduler({
      baseMs: () => 1000,
      run,
      rng: () => 0.5,
      onSchedule: (at) => scheduled.push(at),
    });
    expect(s.nextAt()).toBeUndefined();
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.nextAt()).toBe(1000);
    expect(scheduled).toEqual([1000]);

    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(s.nextAt()).toBe(2000);
    s.stop();
  });

  it('backs off on failure and resets on success', async () => {
    let fail = true;
    const run = vi.fn(() => (fail ? Promise.reject(new Error('down')) : Promise.resolve()));
    const s = new Scheduler({ baseMs: () => 1000, run, rng: () => 0.5 });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.nextAt()).toBe(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(s.nextAt()).toBe(2000 + 4000);

    fail = false;
    await vi.advanceTimersByTimeAsync(4000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(s.nextAt()).toBe(6000 + 1000);
    s.stop();
  });

  it('stop cancels the pending timer', async () => {
    const run = vi.fn(() => Promise.resolve());
    const s = new Scheduler({ baseMs: () => 1000, run, rng: () => 0.5 });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    s.stop();
    expect(s.nextAt()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runNow cancels the pending timer, runs, and reschedules', async () => {
    const run = vi.fn(() => Promise.resolve());
    const s = new Scheduler({ baseMs: () => 1000, run, rng: () => 0.5 });
    s.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(400);
    await s.runNow();
    expect(run).toHaveBeenCalledTimes(2);
    expect(s.nextAt()).toBe(1400);
    await vi.advanceTimersByTimeAsync(600);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(400);
    expect(run).toHaveBeenCalledTimes(3);
    s.stop();
  });

  it('runNow without start does not schedule', async () => {
    const run = vi.fn(() => Promise.resolve());
    const s = new Scheduler({ baseMs: () => 1000, run, rng: () => 0.5 });
    await s.runNow();
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.nextAt()).toBeUndefined();
  });

  it('does not overlap runs', async () => {
    let release: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const s = new Scheduler({ baseMs: () => 1000, run, rng: () => 0.5 });
    s.start();
    const second = s.runNow();
    expect(run).toHaveBeenCalledTimes(1);
    release?.();
    await second;
    expect(run).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('uses injected timer functions', async () => {
    const timers = new Map<number, () => void>();
    let id = 0;
    const setTimeoutFn = vi.fn((fn: () => void) => {
      id += 1;
      timers.set(id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutFn = vi.fn((h: ReturnType<typeof setTimeout>) => {
      timers.delete(Number(h));
    });
    const run = vi.fn(() => Promise.resolve());
    const s = new Scheduler({
      baseMs: () => 1000,
      run,
      rng: () => 0.5,
      now: () => 5000,
      setTimeoutFn,
      clearTimeoutFn,
    });
    s.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(s.nextAt()).toBe(6000);
    s.stop();
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
    expect(timers.size).toBe(0);
  });
});
