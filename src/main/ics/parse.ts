// A small, deliberately partial ICS (RFC 5545) reader. It understands exactly the subset a
// published calendar (Outlook Web, Google Calendar) uses for VEVENT blocks and nothing more:
// no VTIMEZONE component parsing, no VALARM, no VJOURNAL/VTODO, no unfolding of parameter
// values that themselves span multiple lines. Anything outside a VEVENT is ignored.

export interface IcsEvent {
  uid: string;
  summary: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  cancelled: boolean;
  transparent: boolean;
  organizer: string;
  partStat?: string;
  url?: string;
  recurrenceRule?: string;
  recurrenceId?: number;
  exceptions: number[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const DATE_ONLY_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;
const DURATION_RE = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

interface ParsedDate {
  ms: number;
  allDay: boolean;
}

interface RawEvent {
  uid?: string;
  summary?: string;
  dtstart?: ParsedDate;
  dtend?: ParsedDate;
  durationMs?: number;
  status?: string;
  transp?: string;
  organizer?: string;
  partStat?: string;
  url?: string;
  rrule?: string;
  recurrenceId?: number;
  exceptions: number[];
}

function unfoldLines(text: string): string[] {
  const raw = text.split(/\r\n|\r|\n/);
  const lines: string[] = [];
  for (const line of raw) {
    const last = lines[lines.length - 1];
    if ((line.startsWith(' ') || line.startsWith('\t')) && last !== undefined) {
      lines[lines.length - 1] = last + line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseParams(tokens: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq === -1) continue;
    const key = token.slice(0, eq).toUpperCase();
    let value = token.slice(eq + 1);
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    params[key] = value;
  }
  return params;
}

function unescapeText(value: string): string {
  return value.replace(/\\\\|\\;|\\,|\\[nN]/g, (match) => {
    if (match === '\\\\') return '\\';
    if (match === '\\;') return ';';
    if (match === '\\,') return ',';
    return '\n';
  });
}

// A wall-clock time carried with TZID (e.g. "America/Sao_Paulo") cannot be converted to UTC
// with a fixed offset: the same wall clock reading maps to a different instant before and
// after a daylight saving change. Intl.DateTimeFormat knows the real transition dates for a
// zone, so it is used to find the offset in effect, with one correction pass in case the
// first guess landed on the wrong side of a transition.
function zoneOffsetMs(atMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(atMs);
  const value = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return asUtc - atMs;
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month, day, hour, minute, second);
  const offset = zoneOffsetMs(guess, timeZone);
  const firstPass = guess - offset;
  const offset2 = zoneOffsetMs(firstPass, timeZone);
  return offset2 === offset ? firstPass : guess - offset2;
}

function parseIcsDateTime(value: string, params: Record<string, string>): ParsedDate {
  const trimmed = value.trim();
  if (params.VALUE === 'DATE' || DATE_ONLY_RE.test(trimmed)) {
    const m = DATE_ONLY_RE.exec(trimmed);
    if (m === null) throw new Error(`invalid ICS date value: ${trimmed}`);
    const [, y, mo, d] = m;
    return { ms: new Date(Number(y), Number(mo) - 1, Number(d)).getTime(), allDay: true };
  }
  const m = DATE_TIME_RE.exec(trimmed);
  if (m === null) throw new Error(`invalid ICS date-time value: ${trimmed}`);
  const [, y, mo, d, h, mi, s, z] = m;
  const year = Number(y);
  const month = Number(mo) - 1;
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (z === 'Z') {
    return { ms: Date.UTC(year, month, day, hour, minute, second), allDay: false };
  }
  const tzid = params.TZID;
  if (tzid !== undefined) {
    return { ms: zonedTimeToUtc(year, month, day, hour, minute, second, tzid), allDay: false };
  }
  // No zone information at all means a "floating" time: whatever zone the viewer is in. Wisp
  // always views its own owner's calendar on the owner's own machine, so the machine's local
  // zone is exactly that viewer.
  return { ms: new Date(year, month, day, hour, minute, second).getTime(), allDay: false };
}

function parseDuration(value: string): number | undefined {
  const m = DURATION_RE.exec(value.trim());
  if (m === null) return undefined;
  const [, sign, weeks, days, hours, minutes, seconds] = m;
  const ms =
    Number(weeks ?? 0) * 7 * DAY_MS +
    Number(days ?? 0) * DAY_MS +
    Number(hours ?? 0) * HOUR_MS +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1000;
  return sign === '-' ? -ms : ms;
}

function finalizeEvent(raw: RawEvent): IcsEvent | undefined {
  if (raw.dtstart === undefined) return undefined;
  const startMs = raw.dtstart.ms;
  const allDay = raw.dtstart.allDay;
  const endMs =
    raw.dtend !== undefined
      ? raw.dtend.ms
      : raw.durationMs !== undefined
        ? startMs + raw.durationMs
        : startMs + (allDay ? DAY_MS : HOUR_MS);
  return {
    uid: raw.uid ?? '',
    summary: raw.summary ?? '',
    startMs,
    endMs,
    allDay,
    cancelled: (raw.status ?? '').toUpperCase() === 'CANCELLED',
    transparent: (raw.transp ?? '').toUpperCase() === 'TRANSPARENT',
    organizer: raw.organizer ?? '',
    partStat: raw.partStat,
    url: raw.url,
    recurrenceRule: raw.rrule,
    recurrenceId: raw.recurrenceId,
    exceptions: raw.exceptions,
  };
}

function applyProperty(
  current: RawEvent,
  name: string,
  value: string,
  params: Record<string, string>,
): void {
  try {
    switch (name) {
      case 'UID':
        current.uid = value;
        break;
      case 'SUMMARY':
        current.summary = unescapeText(value);
        break;
      case 'DTSTART':
        current.dtstart = parseIcsDateTime(value, params);
        break;
      case 'DTEND':
        current.dtend = parseIcsDateTime(value, params);
        break;
      case 'DURATION':
        current.durationMs = parseDuration(value);
        break;
      case 'STATUS':
        current.status = value;
        break;
      case 'TRANSP':
        current.transp = value;
        break;
      case 'ORGANIZER': {
        const cn = params.CN;
        current.organizer = cn ?? value.replace(/^mailto:/i, '');
        break;
      }
      case 'ATTENDEE':
        // Only the first ATTENDEE line carrying a PARTSTAT is used; a published calendar has
        // no reliable way to tell which attendee is "me", so the spec asks for the first one.
        if (current.partStat === undefined && params.PARTSTAT !== undefined) {
          current.partStat = params.PARTSTAT;
        }
        break;
      case 'URL':
        current.url = value;
        break;
      case 'RRULE':
        current.rrule = value;
        break;
      case 'RECURRENCE-ID':
        current.recurrenceId = parseIcsDateTime(value, params).ms;
        break;
      case 'EXDATE':
        for (const part of value.split(',')) {
          current.exceptions.push(parseIcsDateTime(part, params).ms);
        }
        break;
      default:
        break;
    }
  } catch {
    // A malformed value for one property should not sink the whole event; the property is
    // simply left unset (or, for EXDATE, missing that one exception).
  }
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: RawEvent | undefined;

  for (const line of unfoldLines(text)) {
    if (line.trim() === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const prefix = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [rawName, ...paramTokens] = prefix.split(';');
    const name = (rawName ?? '').toUpperCase();

    if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      current = { exceptions: [] };
      continue;
    }
    if (name === 'END' && value.toUpperCase() === 'VEVENT') {
      if (current !== undefined) {
        const finalized = finalizeEvent(current);
        if (finalized !== undefined) events.push(finalized);
      }
      current = undefined;
      continue;
    }
    if (current === undefined) continue;
    applyProperty(current, name, value, parseParams(paramTokens));
  }

  return events;
}
