import { variantsOf } from '../../shared/i18n';
import type { MessageKey } from '../../shared/i18n/en';

// Declared here rather than imported from actor.ts so the picker has no reason to know about the
// state machine. It is the same shape: a function returning a number in [0, 1).
type Rng = () => number;

export interface LinePicker {
  /** The key to actually show for this moment, which may be an alternative wording of it. */
  pick(key: MessageKey): MessageKey;
}

export function createLinePicker(rng: Rng): LinePicker {
  const last = new Map<MessageKey, MessageKey>();
  return {
    pick(key) {
      const all = variantsOf(key);
      if (all.length <= 1) return key;
      // Drawing freely from three wordings repeats the last one about a third of the time, and a
      // mascot that says the same thing twice in a row reads as stuck rather than as random. The
      // one used last is taken out of the draw.
      const previous = last.get(key);
      const pool = previous === undefined ? all : all.filter((k) => k !== previous);
      const index = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
      const chosen = pool[index] ?? key;
      last.set(key, chosen);
      return chosen;
    },
  };
}
