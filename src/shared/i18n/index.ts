import type { Locale } from '../config';
import { en } from './en';
import type { MessageKey } from './en';

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en };

export type Params = Record<string, string | number>;

export function format(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

export function translator(locale: Locale, base: Params = {}) {
  const dict = dictionaries[locale];
  return (key: MessageKey, params: Params = {}): string =>
    format(dict[key], { ...base, ...params });
}

export type Translate = ReturnType<typeof translator>;

// Every key that has no hash in it is a base line, and the keys that share its prefix before a
// hash are alternative wordings of the same moment. The map is built once here rather than
// scanned on every lookup, because a line is picked inside the frame loop.
const VARIANTS: ReadonlyMap<MessageKey, readonly MessageKey[]> = (() => {
  const map = new Map<MessageKey, MessageKey[]>();
  for (const key of Object.keys(en) as MessageKey[]) {
    const mark = key.indexOf('#');
    const base = (mark === -1 ? key : key.slice(0, mark)) as MessageKey;
    const found = map.get(base) ?? [base];
    if (mark !== -1) found.push(key);
    map.set(base, found);
  }
  return map;
})();

/** The base key and every alternative wording of it, base first. */
export function variantsOf(key: MessageKey): readonly MessageKey[] {
  return VARIANTS.get(key) ?? [key];
}
