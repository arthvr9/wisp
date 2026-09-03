import { z } from 'zod';

import type { Signal } from '../../shared/signals';
import type { GraphClient } from './client';

const dateTimeSchema = z.looseObject({ dateTime: z.string() });

const eventSchema = z.looseObject({
  id: z.string(),
  subject: z.string().optional(),
  start: dateTimeSchema,
  end: dateTimeSchema,
  isAllDay: z.boolean().optional(),
  isCancelled: z.boolean().optional(),
  showAs: z.string().optional(),
  responseStatus: z.looseObject({ response: z.string().optional() }).optional(),
  organizer: z
    .looseObject({
      emailAddress: z.looseObject({ name: z.string().optional(), address: z.string().optional() }).optional(),
    })
    .optional(),
  webLink: z.string().optional(),
});
type CalendarEvent = z.infer<typeof eventSchema>;

const pageSchema = z.looseObject({
  value: z.array(z.unknown()),
  '@odata.nextLink': z.string().optional(),
});

const maxPages = 5;
const selectFields =
  'id,subject,start,end,isAllDay,isCancelled,showAs,responseStatus,organizer,webLink,seriesMasterId';

function parseWallClockUtc(value: string): number {
  // /me/calendarView returns start.dateTime and end.dateTime as wall-clock strings with no
  // zone suffix even though Prefer: outlook.timezone="UTC" was requested, so a bare "Z" has
  // to be appended before parsing or Date would read them as local time.
  return new Date(value.endsWith('Z') ? value : `${value}Z`).getTime();
}

function toSignal(event: CalendarEvent): Signal | undefined {
  const dueAt = parseWallClockUtc(event.start.dateTime);
  const endsAt = parseWallClockUtc(event.end.dateTime);
  if (!Number.isFinite(dueAt) || !Number.isFinite(endsAt)) return undefined;

  const response = event.responseStatus?.response;
  const accepted = response === 'accepted' || response === 'organizer';
  const busy = event.showAs === 'busy' || event.showAs === 'oof';
  const emailAddress = event.organizer?.emailAddress;
  const organizer = emailAddress?.name ?? emailAddress?.address ?? '';

  return {
    id: `outlook:${event.id}`,
    source: 'outlook',
    kind: 'meeting',
    dueAt,
    title: event.subject === undefined || event.subject === '' ? '(no subject)' : event.subject,
    url: event.webLink ?? '',
    status: response ?? '',
    listName: 'Calendar',
    meeting: {
      endsAt,
      accepted,
      allDay: event.isAllDay ?? false,
      organizer,
      busy,
    },
  };
}

export async function fetchCalendarSignals(
  client: GraphClient,
  opts: { nowMs: number; pastHours?: number; horizonHours: number },
): Promise<Signal[]> {
  const pastHours = opts.pastHours ?? 2;
  const query = {
    startDateTime: new Date(opts.nowMs - pastHours * 3_600_000).toISOString(),
    endDateTime: new Date(opts.nowMs + opts.horizonHours * 3_600_000).toISOString(),
    $select: selectFields,
    $orderby: 'start/dateTime',
    $top: '100',
  };
  const headers = { Prefer: 'outlook.timezone="UTC"' };

  const signals: Signal[] = [];
  let skipped = 0;
  let nextUrl: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    // calendarView expands recurring series into concrete instances (unlike /me/events, which
    // returns only the series master), which is what keeps a recurring meeting correct across
    // a daylight saving change instead of drifting by an hour.
    const raw = await client.get<unknown>(
      nextUrl ?? '/me/calendarView',
      nextUrl === undefined ? query : undefined,
      headers,
    );
    const parsedPage = pageSchema.safeParse(raw);
    if (!parsedPage.success) {
      throw new Error('unexpected response from Microsoft Graph calendarView');
    }
    for (const item of parsedPage.data.value) {
      const parsed = eventSchema.safeParse(item);
      if (!parsed.success || parsed.data.isCancelled === true) {
        if (!parsed.success) skipped += 1;
        continue;
      }
      const signal = toSignal(parsed.data);
      if (signal === undefined) {
        skipped += 1;
        continue;
      }
      signals.push(signal);
    }
    nextUrl = parsedPage.data['@odata.nextLink'];
    if (nextUrl === undefined) break;
  }
  if (skipped > 0) {
    console.warn(`outlook: skipped ${skipped} calendar events that did not match the schema`);
  }
  return signals;
}
