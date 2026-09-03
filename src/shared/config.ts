import type { NudgeBudget, QuietHours } from './nudges';
import { isCustomMascotSlug } from './custom-art';
import { isMascot } from './mascots';
import type { MascotName } from './mascots';
import type { SpeechConfig } from './speech';

export type Locale = 'en';

export interface CalendarConfig {
  /** A published ICS URL. Outlook, Google Calendar and anything else that publishes one. */
  icsUrl: string;
  warnMinutes: number;
  silenceDuringMeetings: boolean;
}

export interface GruplyConfig {
  baseUrl: string;
  email: string;
}

export interface Config {
  name: string;
  mascot: MascotName;
  /**
   * Slug of a mascot the user drew, or empty for none. It is a separate field from `mascot`
   * rather than a wider union, because `mascot` also picks the tray icon and the icons ship with
   * the app. A custom mascot borrows the built-in art for every pose it does not draw.
   */
  customMascot: string;
  locale: Locale;
  autostart: boolean;
  followCursor: boolean;
  night: boolean;
  music: boolean;
  dueSoonMinutes: number;
  pollMinutes: number;
  quietHours: QuietHours;
  budget: NudgeBudget;
  speech: SpeechConfig;
  calendar: CalendarConfig;
  gruply: GruplyConfig;
}

export const defaultConfig: Config = {
  name: 'Wisp',
  mascot: 'wisp',
  customMascot: '',
  locale: 'en',
  autostart: false,
  followCursor: true,
  night: false,
  music: true,
  dueSoonMinutes: 30,
  pollMinutes: 5,
  quietHours: { enabled: true, start: '19:00', end: '08:00' },
  budget: { maxPerHour: 3, maxPerDay: 12 },
  speech: { provider: 'off', baseUrl: '', model: '' },
  calendar: { icsUrl: '', warnMinutes: 5, silenceDuringMeetings: true },
  gruply: { baseUrl: 'https://api.gruply.com.br/api', email: '' },
};

const PROVIDERS = ['off', 'ollama', 'openai-compatible', 'anthropic'] as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeConfig(raw: unknown): Config {
  const c = { ...defaultConfig };
  if (typeof raw !== 'object' || raw === null) return c;
  const r = raw as Record<string, unknown>;
  if (typeof r.name === 'string' && r.name.trim().length > 0) c.name = r.name.trim().slice(0, 24);
  if (r.locale === 'en') c.locale = r.locale;
  if (isMascot(r.mascot)) c.mascot = r.mascot;
  if (isCustomMascotSlug(r.customMascot)) c.customMascot = r.customMascot;
  else if (r.customMascot === '') c.customMascot = '';
  if (typeof r.autostart === 'boolean') c.autostart = r.autostart;
  if (typeof r.followCursor === 'boolean') c.followCursor = r.followCursor;
  if (typeof r.night === 'boolean') c.night = r.night;
  if (typeof r.music === 'boolean') c.music = r.music;
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
  if (typeof r.speech === 'object' && r.speech !== null) {
    const sp = r.speech as Record<string, unknown>;
    c.speech = {
      provider: (PROVIDERS as readonly unknown[]).includes(sp.provider)
        ? (sp.provider as SpeechConfig['provider'])
        : c.speech.provider,
      baseUrl: typeof sp.baseUrl === 'string' ? sp.baseUrl.trim().slice(0, 200) : c.speech.baseUrl,
      model: typeof sp.model === 'string' ? sp.model.trim().slice(0, 100) : c.speech.model,
    };
  }
  if (typeof r.calendar === 'object' && r.calendar !== null) {
    const cal = r.calendar as Record<string, unknown>;
    c.calendar = {
      icsUrl: typeof cal.icsUrl === 'string' ? cal.icsUrl.trim().slice(0, 500) : c.calendar.icsUrl,
      warnMinutes: intIn(cal.warnMinutes, 0, 120) ?? c.calendar.warnMinutes,
      silenceDuringMeetings:
        typeof cal.silenceDuringMeetings === 'boolean'
          ? cal.silenceDuringMeetings
          : c.calendar.silenceDuringMeetings,
    };
  }
  if (typeof r.gruply === 'object' && r.gruply !== null) {
    const g = r.gruply as Record<string, unknown>;
    c.gruply = {
      baseUrl:
        typeof g.baseUrl === 'string' && g.baseUrl.trim().length > 0
          ? g.baseUrl.trim().slice(0, 200)
          : c.gruply.baseUrl,
      email: typeof g.email === 'string' ? g.email.trim().slice(0, 120) : c.gruply.email,
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
