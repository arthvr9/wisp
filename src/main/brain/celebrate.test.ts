import { describe, expect, it } from 'vitest';

import { AGGREGATE_MS, flushCelebration, initialCelebration, noteCompleted } from './celebrate';

function done(title: string, at: number): { title: string; at: number } {
  return { title, at };
}

describe('celebrate', () => {
  it('emits nothing before the aggregation window closes', () => {
    const s = noteCompleted(initialCelebration, [done('a', 1000)]);
    const early = flushCelebration(s, 1000 + AGGREGATE_MS - 1);
    expect(early.celebration).toBeUndefined();
    expect(early.state).toBe(s);
  });

  it('turns a single completion into a hop', () => {
    const s = noteCompleted(initialCelebration, [done('a', 1000)]);
    const { state, celebration } = flushCelebration(s, 1000 + AGGREGATE_MS);
    expect(celebration).toEqual({
      count: 1,
      intensity: 1,
      titles: ['a'],
      at: 1000 + AGGREGATE_MS,
    });
    expect(state.pending).toEqual([]);
    expect(state.lastFlushAt).toBe(1000 + AGGREGATE_MS);
  });

  it('aggregates three completions inside 30 s into one dance', () => {
    let s = noteCompleted(initialCelebration, [done('a', 0)]);
    s = noteCompleted(s, [done('b', 10_000), done('c', 25_000)]);
    expect(flushCelebration(s, 29_000).celebration).toBeUndefined();
    const { celebration } = flushCelebration(s, AGGREGATE_MS);
    expect(celebration?.count).toBe(3);
    expect(celebration?.intensity).toBe(2);
    expect(celebration?.titles).toEqual(['a', 'b', 'c']);
  });

  it('gives a trophy for four or more and keeps three titles', () => {
    const s = noteCompleted(initialCelebration, [
      done('d', 3000),
      done('a', 0),
      done('b', 1000),
      done('c', 2000),
      done('e', 4000),
    ]);
    const { celebration } = flushCelebration(s, AGGREGATE_MS);
    expect(celebration?.count).toBe(5);
    expect(celebration?.intensity).toBe(3);
    expect(celebration?.titles).toEqual(['a', 'b', 'c']);
  });

  it('separates two bursts', () => {
    let s = noteCompleted(initialCelebration, [done('a', 0), done('b', 5000)]);
    const first = flushCelebration(s, AGGREGATE_MS);
    expect(first.celebration?.count).toBe(2);
    s = noteCompleted(first.state, [done('c', 60_000)]);
    expect(flushCelebration(s, 60_000 + AGGREGATE_MS - 1).celebration).toBeUndefined();
    const second = flushCelebration(s, 60_000 + AGGREGATE_MS);
    expect(second.celebration?.count).toBe(1);
    expect(second.celebration?.intensity).toBe(1);
    expect(second.celebration?.titles).toEqual(['c']);
    expect(second.state.pending).toEqual([]);
  });
});
