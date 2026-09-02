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
