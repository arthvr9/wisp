import type { NudgeBudget, QuietHours } from './nudges';

export type Locale = 'en';

export interface Config {
  name: string;
  locale: Locale;
  autostart: boolean;
  followCursor: boolean;
  dueSoonMinutes: number;
  pollMinutes: number;
  quietHours: QuietHours;
  budget: NudgeBudget;
}

export const defaultConfig: Config = {
  name: 'Wisp',
  locale: 'en',
  autostart: false,
  followCursor: true,
  dueSoonMinutes: 30,
  pollMinutes: 5,
  quietHours: { enabled: true, start: '19:00', end: '08:00' },
  budget: { maxPerHour: 3, maxPerDay: 12 },
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeConfig(raw: unknown): Config {
  const c = { ...defaultConfig };
  if (typeof raw !== 'object' || raw === null) return c;
  const r = raw as Record<string, unknown>;
  if (typeof r.name === 'string' && r.name.trim().length > 0) c.name = r.name.trim().slice(0, 24);
  if (r.locale === 'en') c.locale = r.locale;
  if (typeof r.autostart === 'boolean') c.autostart = r.autostart;
  if (typeof r.followCursor === 'boolean') c.followCursor = r.followCursor;
  if (typeof r.dueSoonMinutes === 'number' && r.dueSoonMinutes >= 1 && r.dueSoonMinutes <= 1440)
    c.dueSoonMinutes = Math.round(r.dueSoonMinutes);
  if (typeof r.pollMinutes === 'number' && r.pollMinutes >= 1 && r.pollMinutes <= 120)
    c.pollMinutes = Math.round(r.pollMinutes);
  if (typeof r.quietHours === 'object' && r.quietHours !== null) {
    const q = r.quietHours as Record<string, unknown>;
    c.quietHours = {
      enabled: typeof q.enabled === 'boolean' ? q.enabled : c.quietHours.enabled,
      start: typeof q.start === 'string' && TIME.test(q.start) ? q.start : c.quietHours.start,
      end: typeof q.end === 'string' && TIME.test(q.end) ? q.end : c.quietHours.end,
    };
  }
  if (typeof r.budget === 'object' && r.budget !== null) {
    const b = r.budget as Record<string, unknown>;
    c.budget = {
      maxPerHour: intIn(b.maxPerHour, 1, 20) ?? c.budget.maxPerHour,
      maxPerDay: intIn(b.maxPerDay, 1, 100) ?? c.budget.maxPerDay,
    };
  }
  return c;
}

function intIn(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.round(value);
  return n >= min && n <= max ? n : undefined;
}
