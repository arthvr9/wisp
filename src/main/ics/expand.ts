import type { IcsEvent } from './parse';

// Recurrence expansion works on local wall-clock components (year, month, day, hour, minute,
// second) taken with the JS engine's own local time zone, rather than adding fixed
// milliseconds to the previous occurrence. Adding milliseconds would drift a recurring
// meeting by an hour across a daylight saving change; reconstructing the date from the same
// wall-clock components lets the JS Date engine pick the correct offset for the new date
// itself. Wisp only ever expands its own owner's calendar on the owner's own machine, so the
// machine's local zone is the right frame to expand in even though the original ICS zone
// (TZID) is no longer available once parse.ts has turned it into an absolute timestamp.

const DEFAULT_MAX_PER_RULE = 200;
const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY';

interface ParsedRule {
  freq: Freq;
  interval: number;
  count?: number;
  untilMs?: number;
  byday?: number[];
}

function parseUntil(value: string): number | undefined {
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (dt !== null) {
    const [, y, mo, d, h, mi, s, z] = dt;
    const year = Number(y);
    const month = Number(mo) - 1;
    const day = Number(d);
    const hour = Number(h);
    const minute = Number(mi);
    const second = Number(s);
    return z === 'Z'
      ? Date.UTC(year, month, day, hour, minute, second)
      : new Date(year, month, day, hour, minute, second).getTime();
  }
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly !== null) {
    const [, y, mo, d] = dateOnly;
    // UNTIL given as a bare date is inclusive of the whole day.
    return new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59).getTime();
  }
  return undefined;
}

// Only the common cases are understood: FREQ of DAILY, WEEKLY or MONTHLY, with an optional
// INTERVAL, COUNT, UNTIL and, for WEEKLY only, BYDAY. Anything else (BYMONTHDAY, BYSETPOS,
// BYYEARDAY, YEARLY, a BYDAY on a non-weekly rule, and so on) is out of scope, and the caller
// keeps the master event as a single occurrence instead of expanding it incorrectly.
function parseRule(raw: string): ParsedRule | undefined {
  const map: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    map[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }

  const freq = map.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return undefined;

  const supported = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY']);
  for (const key of Object.keys(map)) {
    if (!supported.has(key)) return undefined;
  }
  if (map.BYDAY !== undefined && freq !== 'WEEKLY') return undefined;

  const interval = map.INTERVAL !== undefined ? Number.parseInt(map.INTERVAL, 10) : 1;
  if (!Number.isFinite(interval) || interval < 1) return undefined;

  let count: number | undefined;
  if (map.COUNT !== undefined) {
    count = Number.parseInt(map.COUNT, 10);
    if (!Number.isFinite(count) || count < 1) return undefined;
  }

  let untilMs: number | undefined;
  if (map.UNTIL !== undefined) {
    untilMs = parseUntil(map.UNTIL);
    if (untilMs === undefined) return undefined;
  }

  let byday: number[] | undefined;
  if (map.BYDAY !== undefined) {
    byday = [];
    for (const code of map.BYDAY.split(',')) {
      const dow = DAY_CODES[code.trim().toUpperCase()];
      if (dow === undefined) return undefined;
      byday.push(dow);
    }
  }

  return { freq, interval, count, untilMs, byday };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function* occurrenceDates(
  startMs: number,
  freq: Freq,
  interval: number,
  byday: number[] | undefined,
): Generator<number> {
  const base = new Date(startMs);
  const year = base.getFullYear();
  const month = base.getMonth();
  const day = base.getDate();
  const hour = base.getHours();
  const minute = base.getMinutes();
  const second = base.getSeconds();

  if (freq === 'DAILY') {
    for (let i = 0; ; i += 1) {
      yield new Date(year, month, day + i * interval, hour, minute, second).getTime();
    }
  } else if (freq === 'MONTHLY') {
    // A day that does not exist in the target month is skipped, which is what RFC 5545 says.
    // Letting Date roll over would turn the 31st into the 3rd of the month after.
    for (let i = 0; ; i += 1) {
      const target = new Date(year, month + i * interval, 1);
      if (day > daysInMonth(target.getFullYear(), target.getMonth())) {
        yield Number.NaN;
        continue;
      }
      yield new Date(target.getFullYear(), target.getMonth(), day, hour, minute, second).getTime();
    }
  } else {
    const codes = byday !== undefined && byday.length > 0 ? byday : [base.getDay()];
    const sorted = [...new Set(codes)].sort((a, b) => a - b);
    const baseDow = base.getDay();
    for (let week = 0; ; week += 1) {
      for (const dow of sorted) {
        yield new Date(
          year,
          month,
          day - baseDow + week * interval * 7 + dow,
          hour,
          minute,
          second,
        ).getTime();
      }
    }
  }
}

function boundedOccurrences(
  gen: Generator<number>,
  opts: {
    count?: number;
    untilMs?: number;
    fromMs: number;
    toMs: number;
    durationMs: number;
    maxPerRule: number;
  },
): number[] {
  const results: number[] = [];
  let generated = 0;
  let skipped = 0;
  for (const occStart of gen) {
    // A month without that day yields NaN and counts against neither COUNT nor the cap, but a
    // long run of them still has to end so the generator cannot spin forever.
    if (Number.isNaN(occStart)) {
      skipped += 1;
      if (skipped > opts.maxPerRule) break;
      continue;
    }
    if (opts.count !== undefined && generated >= opts.count) break;
    if (opts.untilMs !== undefined && occStart > opts.untilMs) break;
    if (occStart > opts.toMs) break;
    generated += 1;
    if (generated > opts.maxPerRule) break;
    if (occStart + opts.durationMs > opts.fromMs) results.push(occStart);
  }
  return results;
}

function overlaps(startMs: number, endMs: number, fromMs: number, toMs: number): boolean {
  return startMs < toMs && endMs > fromMs;
}

type OverrideEvent = IcsEvent & { recurrenceId: number };

function isOverride(event: IcsEvent): event is OverrideEvent {
  return event.recurrenceId !== undefined;
}

function groupByUid(events: readonly IcsEvent[]): Map<string, IcsEvent[]> {
  const groups = new Map<string, IcsEvent[]>();
  for (const event of events) {
    const group = groups.get(event.uid);
    if (group === undefined) groups.set(event.uid, [event]);
    else group.push(event);
  }
  return groups;
}

export function expandRecurrences(
  events: readonly IcsEvent[],
  opts: { fromMs: number; toMs: number; maxPerRule?: number },
): IcsEvent[] {
  const maxPerRule = opts.maxPerRule ?? DEFAULT_MAX_PER_RULE;
  const result: IcsEvent[] = [];

  for (const group of groupByUid(events).values()) {
    const master = group.find((e) => e.recurrenceId === undefined);
    const overrides = group.filter(isOverride);
    const overrideByRecurrenceId = new Map(overrides.map((o) => [o.recurrenceId, o]));
    const usedOverrides = new Set<number>();

    if (master !== undefined) {
      const rule =
        master.recurrenceRule !== undefined ? parseRule(master.recurrenceRule) : undefined;
      if (rule === undefined) {
        if (overlaps(master.startMs, master.endMs, opts.fromMs, opts.toMs)) {
          result.push(master);
        }
      } else {
        const durationMs = master.endMs - master.startMs;
        const exceptions = new Set(master.exceptions);
        const starts = boundedOccurrences(
          occurrenceDates(master.startMs, rule.freq, rule.interval, rule.byday),
          {
            count: rule.count,
            untilMs: rule.untilMs,
            fromMs: opts.fromMs,
            toMs: opts.toMs,
            durationMs,
            maxPerRule,
          },
        );
        for (const occStart of starts) {
          if (exceptions.has(occStart)) continue;
          const override = overrideByRecurrenceId.get(occStart);
          if (override !== undefined) {
            usedOverrides.add(occStart);
            result.push(override);
            continue;
          }
          result.push({ ...master, startMs: occStart, endMs: occStart + durationMs });
        }
      }
    }

    for (const override of overrides) {
      if (usedOverrides.has(override.recurrenceId)) continue;
      if (overlaps(override.startMs, override.endMs, opts.fromMs, opts.toMs)) {
        result.push(override);
      }
    }
  }

  return result.sort((a, b) => a.startMs - b.startMs);
}
