export type Locale = 'en';

export interface Config {
  name: string;
  locale: Locale;
  autostart: boolean;
  followCursor: boolean;
}

export const defaultConfig: Config = {
  name: 'Wisp',
  locale: 'en',
  autostart: false,
  followCursor: true,
};

export function normalizeConfig(raw: unknown): Config {
  const c = { ...defaultConfig };
  if (typeof raw !== 'object' || raw === null) return c;
  const r = raw as Record<string, unknown>;
  if (typeof r.name === 'string' && r.name.trim().length > 0) c.name = r.name.trim().slice(0, 24);
  if (r.locale === 'en') c.locale = r.locale;
  if (typeof r.autostart === 'boolean') c.autostart = r.autostart;
  if (typeof r.followCursor === 'boolean') c.followCursor = r.followCursor;
  return c;
}
