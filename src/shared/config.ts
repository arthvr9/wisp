export type Locale = 'en';

export interface Config {
  name: string;
  locale: Locale;
  autostart: boolean;
  followCursor: boolean;
  dueSoonMinutes: number;
  pollMinutes: number;
}

export const defaultConfig: Config = {
  name: 'Wisp',
  locale: 'en',
  autostart: false,
  followCursor: true,
  dueSoonMinutes: 30,
  pollMinutes: 5,
};

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
  return c;
}
