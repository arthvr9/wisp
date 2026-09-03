import { describe, expect, it } from 'vitest';

import { parseIcs } from './parse';

function wrap(vevent: string): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', vevent, 'END:VCALENDAR'].join('\r\n');
}

describe('parseIcs', () => {
  it('parses a UTC date-time', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:a@example.com',
        'SUMMARY:Standup',
        'DTSTART:20260902T130000Z',
        'DTEND:20260902T140000Z',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.startMs).toBe(Date.UTC(2026, 8, 2, 13, 0, 0));
    expect(event?.endMs).toBe(Date.UTC(2026, 8, 2, 14, 0, 0));
    expect(event?.allDay).toBe(false);
  });

  it('parses a floating local date-time using the machine local zone', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:b@example.com',
        'SUMMARY:Floating',
        'DTSTART:20260902T130000',
        'DTEND:20260902T140000',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.startMs).toBe(new Date(2026, 8, 2, 13, 0, 0).getTime());
    expect(event?.endMs).toBe(new Date(2026, 8, 2, 14, 0, 0).getTime());
  });

  it('converts a TZID date-time using the real zone offset, not a fixed one', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:c@example.com',
        'SUMMARY:Sao Paulo meeting',
        'DTSTART;TZID=America/Sao_Paulo:20260902T130000',
        'DTEND;TZID=America/Sao_Paulo:20260902T140000',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    // Sao Paulo has observed no daylight saving since 2019, so 2026 sits at a flat UTC-3.
    expect(event?.startMs).toBe(Date.UTC(2026, 8, 2, 16, 0, 0));
    expect(event?.endMs).toBe(Date.UTC(2026, 8, 2, 17, 0, 0));
  });

  it('parses a date-only value as an all-day event', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:d@example.com',
        'SUMMARY:Company holiday',
        'DTSTART;VALUE=DATE:20260905',
        'DTEND;VALUE=DATE:20260906',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.allDay).toBe(true);
    expect(event?.startMs).toBe(new Date(2026, 8, 5).getTime());
    expect(event?.endMs).toBe(new Date(2026, 8, 6).getTime());
  });

  it('uses DURATION when DTEND is missing', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:e@example.com',
        'SUMMARY:Half hour',
        'DTSTART:20260902T130000Z',
        'DURATION:PT30M',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.endMs).toBe(Date.UTC(2026, 8, 2, 13, 30, 0));
  });

  it('defaults to one hour when both DTEND and DURATION are missing', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:f@example.com',
        'SUMMARY:No end',
        'DTSTART:20260902T130000Z',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.endMs).toBe(Date.UTC(2026, 8, 2, 14, 0, 0));
  });

  it('defaults to the whole day for an all-day event with no DTEND', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:g@example.com',
        'SUMMARY:All day, no end',
        'DTSTART;VALUE=DATE:20260905',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    const start = new Date(2026, 8, 5).getTime();
    expect(event?.startMs).toBe(start);
    expect(event?.endMs).toBe(start + 24 * 3_600_000);
  });

  it('unfolds a summary split across a continuation line', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:h@example.com',
        'SUMMARY:This is a long meeting title that got',
        '  folded onto a second line',
        'DTSTART:20260902T130000Z',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.summary).toBe('This is a long meeting title that got folded onto a second line');
  });

  it('unescapes commas, semicolons and newlines in SUMMARY', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:i@example.com',
        'SUMMARY:Foo\\, Bar\\; Baz\\nQux',
        'DTSTART:20260902T130000Z',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.summary).toBe('Foo, Bar; Baz\nQux');
  });

  it('marks a CANCELLED event as cancelled', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:j@example.com',
        'SUMMARY:Called off',
        'DTSTART:20260902T130000Z',
        'STATUS:CANCELLED',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.cancelled).toBe(true);
  });

  it('marks a TRANSPARENT event as not busy, and defaults to opaque', () => {
    const ics = wrap(
      [
        [
          'BEGIN:VEVENT',
          'UID:k@example.com',
          'SUMMARY:Free time block',
          'DTSTART:20260902T130000Z',
          'TRANSP:TRANSPARENT',
          'END:VEVENT',
        ].join('\r\n'),
        [
          'BEGIN:VEVENT',
          'UID:l@example.com',
          'SUMMARY:Real meeting',
          'DTSTART:20260902T130000Z',
          'END:VEVENT',
        ].join('\r\n'),
      ].join('\r\n'),
    );
    const [transparent, opaque] = parseIcs(ics);
    expect(transparent?.transparent).toBe(true);
    expect(opaque?.transparent).toBe(false);
  });

  it('reads ORGANIZER from CN when present, and strips mailto: otherwise', () => {
    const ics = wrap(
      [
        [
          'BEGIN:VEVENT',
          'UID:m@example.com',
          'SUMMARY:With CN',
          'DTSTART:20260902T130000Z',
          'ORGANIZER;CN=Alice:mailto:alice@example.com',
          'END:VEVENT',
        ].join('\r\n'),
        [
          'BEGIN:VEVENT',
          'UID:n@example.com',
          'SUMMARY:Without CN',
          'DTSTART:20260902T130000Z',
          'ORGANIZER:mailto:bob@example.com',
          'END:VEVENT',
        ].join('\r\n'),
      ].join('\r\n'),
    );
    const [withCn, withoutCn] = parseIcs(ics);
    expect(withCn?.organizer).toBe('Alice');
    expect(withoutCn?.organizer).toBe('bob@example.com');
  });

  it('takes PARTSTAT from the first ATTENDEE line that carries one', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:o@example.com',
        'SUMMARY:With attendees',
        'DTSTART:20260902T130000Z',
        'ATTENDEE:mailto:noresponse@example.com',
        'ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com',
        'ATTENDEE;PARTSTAT=ACCEPTED:mailto:other@example.com',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.partStat).toBe('DECLINED');
  });

  it('keeps RRULE and RECURRENCE-ID raw', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:p@example.com',
        'SUMMARY:Weekly',
        'DTSTART:20260902T130000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
  });

  it('parses RECURRENCE-ID into a timestamp', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:p@example.com',
        'SUMMARY:Weekly, rescheduled instance',
        'DTSTART:20260909T150000Z',
        'RECURRENCE-ID:20260909T130000Z',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.recurrenceId).toBe(Date.UTC(2026, 8, 9, 13, 0, 0));
  });

  it('collects EXDATE from a comma list and from repeated lines', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:q@example.com',
        'SUMMARY:Daily standup',
        'DTSTART:20260902T130000Z',
        'RRULE:FREQ=DAILY',
        'EXDATE:20260903T130000Z,20260904T130000Z',
        'EXDATE:20260905T130000Z',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.exceptions).toEqual([
      Date.UTC(2026, 8, 3, 13, 0, 0),
      Date.UTC(2026, 8, 4, 13, 0, 0),
      Date.UTC(2026, 8, 5, 13, 0, 0),
    ]);
  });

  it('defaults UID to an empty string when missing', () => {
    const ics = wrap(
      ['BEGIN:VEVENT', 'SUMMARY:No uid', 'DTSTART:20260902T130000Z', 'END:VEVENT'].join('\r\n'),
    );
    const [event] = parseIcs(ics);
    expect(event?.uid).toBe('');
  });

  it('drops a VEVENT with no DTSTART', () => {
    const ics = wrap(
      ['BEGIN:VEVENT', 'UID:r@example.com', 'SUMMARY:No start', 'END:VEVENT'].join('\r\n'),
    );
    expect(parseIcs(ics)).toEqual([]);
  });

  it('reads several VEVENT blocks from one document', () => {
    const ics = wrap(
      [
        [
          'BEGIN:VEVENT',
          'UID:s1@example.com',
          'SUMMARY:First',
          'DTSTART:20260902T130000Z',
          'END:VEVENT',
        ].join('\r\n'),
        [
          'BEGIN:VEVENT',
          'UID:s2@example.com',
          'SUMMARY:Second',
          'DTSTART:20260903T130000Z',
          'END:VEVENT',
        ].join('\r\n'),
      ].join('\r\n'),
    );
    const events = parseIcs(ics);
    expect(events.map((e) => e.uid)).toEqual(['s1@example.com', 's2@example.com']);
  });
});
