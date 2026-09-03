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
    expect(c).toEqual({
      name: 'Momo',
      locale: 'en',
      autostart: true,
      followCursor: false,
      dueSoonMinutes: 30,
      pollMinutes: 5,
      quietHours: { enabled: true, start: '19:00', end: '08:00' },
      budget: { maxPerHour: 3, maxPerDay: 12 },
      speech: { provider: 'off', baseUrl: '', model: '' },
      outlook: { clientId: '', tenant: 'common', warnMinutes: 5, silenceDuringMeetings: true },
      gruply: { baseUrl: 'https://api.gruply.com.br/api', email: '' },
    });
    expect(normalizeConfig({ name: 'x'.repeat(40) }).name).toHaveLength(24);
  });

  it('validates quiet hours and budget field by field', () => {
    const c = normalizeConfig({
      quietHours: { enabled: false, start: '25:00', end: '07:30' },
      budget: { maxPerHour: 0, maxPerDay: 40 },
    });
    expect(c.quietHours).toEqual({ enabled: false, start: '19:00', end: '07:30' });
    expect(c.budget).toEqual({ maxPerHour: 3, maxPerDay: 40 });
  });

  it('rejects an empty name', () => {
    expect(normalizeConfig({ name: '   ' }).name).toBe('Wisp');
  });
});
