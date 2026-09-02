import { describe, expect, it } from 'vitest';

import { defaultConfig, normalizeConfig } from './config';

describe('normalizeConfig', () => {
  it('falls back to defaults for garbage', () => {
    expect(normalizeConfig(undefined)).toEqual(defaultConfig);
    expect(normalizeConfig('nope')).toEqual(defaultConfig);
    expect(normalizeConfig({ name: 42, locale: 'xx', autostart: 'yes' })).toEqual(defaultConfig);
  });

  it('keeps valid fields, trims and caps the name', () => {
    const c = normalizeConfig({ name: '  Momo  ', autostart: true, followCursor: false });
    expect(c).toEqual({ name: 'Momo', locale: 'en', autostart: true, followCursor: false });
    expect(normalizeConfig({ name: 'x'.repeat(40) }).name).toHaveLength(24);
  });

  it('rejects an empty name', () => {
    expect(normalizeConfig({ name: '   ' }).name).toBe('Wisp');
  });
});
