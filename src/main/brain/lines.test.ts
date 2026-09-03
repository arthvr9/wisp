import { describe, expect, it } from 'vitest';

import { variantsOf } from '../../shared/i18n';
import { createLinePicker } from './lines';

// A deterministic generator that actually spreads, so reachability is proved rather than staged.
const lcg = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

describe('variantsOf', () => {
  it('returns the base first and every alternative after it', () => {
    expect(variantsOf('phrase.poke')).toEqual([
      'phrase.poke',
      'phrase.poke#2',
      'phrase.poke#3',
      'phrase.poke#4',
    ]);
  });

  it('does not treat a numbered namespace as an alternative wording', () => {
    // phrase.celebrate.1 and phrase.celebrate.2 are different situations, not two wordings.
    expect(variantsOf('phrase.celebrate.1')).not.toContain('phrase.celebrate.2');
  });

  it('returns the key alone when it has no alternatives', () => {
    expect(variantsOf('menu.quit')).toEqual(['menu.quit']);
  });
});

describe('createLinePicker', () => {
  it('returns the key itself when there is nothing to choose from', () => {
    expect(createLinePicker(() => 0).pick('menu.quit')).toBe('menu.quit');
  });

  it('never repeats the previous wording of the same line', () => {
    // A generator that always draws the first of the pool would repeat forever without the rule.
    const picker = createLinePicker(() => 0);
    const seen = [
      picker.pick('phrase.poke'),
      picker.pick('phrase.poke'),
      picker.pick('phrase.poke'),
      picker.pick('phrase.poke'),
    ];
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it('reaches every wording of a line', () => {
    const picker = createLinePicker(lcg(7));
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) seen.add(picker.pick('phrase.poke'));
    expect(seen).toEqual(
      new Set(['phrase.poke', 'phrase.poke#2', 'phrase.poke#3', 'phrase.poke#4']),
    );
  });

  it('keeps a separate memory per line', () => {
    const picker = createLinePicker(() => 0);
    const first = picker.pick('phrase.poke');
    picker.pick('phrase.hello');
    // The hello draw must not have cleared what poke remembers.
    expect(picker.pick('phrase.poke')).not.toBe(first);
  });

  it('stays inside the pool when the generator returns exactly 1', () => {
    const picker = createLinePicker(() => 1);
    expect(variantsOf('phrase.poke')).toContain(picker.pick('phrase.poke'));
  });
});
