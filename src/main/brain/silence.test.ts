import { describe, expect, it } from 'vitest';

import type { QuietHours, SilenceWindow } from '../../shared/nudges';
import { activeSilence, localDayStart, quietHoursWindows, snoozeWindow } from './silence';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const midnight = Date.UTC(2026, 8, 2);
const at = (h: number, m = 0) => midnight + h * hour + m * minute;

const night: QuietHours = { enabled: true, start: '19:00', end: '08:00' };
const lunch: QuietHours = { enabled: true, start: '12:00', end: '13:00' };

describe('localDayStart', () => {
  it('uses the timezone offset to find local midnight', () => {
    expect(localDayStart(at(10), 0)).toBe(midnight);
    expect(localDayStart(at(1), 180)).toBe(midnight - day + 3 * hour);
    expect(localDayStart(at(4), 180)).toBe(midnight + 3 * hour);
    expect(localDayStart(at(23), -120)).toBe(midnight + day - 2 * hour);
  });
});

describe('quietHoursWindows', () => {
  it('returns nothing when disabled or malformed', () => {
    expect(quietHoursWindows({ ...night, enabled: false }, at(23), 0)).toEqual([]);
    expect(quietHoursWindows({ enabled: true, start: '25:00', end: '08:00' }, at(23), 0)).toEqual(
      [],
    );
    expect(quietHoursWindows({ enabled: true, start: '08:00', end: '08:00' }, at(23), 0)).toEqual(
      [],
    );
  });

  it('spans midnight and covers yesterday, today and tomorrow', () => {
    const windows = quietHoursWindows(night, at(23), 0);
    expect(windows.map((w) => [w.from, w.to])).toEqual([
      [at(19) - day, at(8)],
      [at(19), at(8) + day],
      [at(19) + day, at(8) + 2 * day],
    ]);
    expect(windows.every((w) => w.source === 'quiet-hours' && w.allowUrgent)).toBe(true);
  });

  it('silences at 23:00 and 07:00 but not at 09:00', () => {
    const silenced = (h: number) =>
      activeSilence(quietHoursWindows(night, at(h), 0), at(h), 'normal') !== undefined;
    expect(silenced(23)).toBe(true);
    expect(silenced(7)).toBe(true);
    expect(silenced(9)).toBe(false);
  });

  it('handles a range inside the day', () => {
    const windows = quietHoursWindows(lunch, at(10), 0);
    expect(windows[1]).toEqual({
      from: at(12),
      to: at(13),
      source: 'quiet-hours',
      allowUrgent: true,
    });
    const silenced = (h: number, m = 0) => activeSilence(windows, at(h, m), 'normal') !== undefined;
    expect(silenced(11, 59)).toBe(false);
    expect(silenced(12)).toBe(true);
    expect(silenced(12, 59)).toBe(true);
    expect(silenced(13)).toBe(false);
  });

  it('applies the timezone offset', () => {
    const windows = quietHoursWindows(lunch, at(10), 180);
    expect(windows[1]).toMatchObject({ from: at(15), to: at(16) });
  });
});

describe('snoozeWindow', () => {
  it('blocks everything until the deadline', () => {
    expect(snoozeWindow(at(10), at(9))).toEqual({
      from: at(9),
      to: at(10),
      source: 'snooze',
      allowUrgent: false,
    });
  });

  it('is undefined once the deadline has passed', () => {
    expect(snoozeWindow(at(9), at(9))).toBeUndefined();
    expect(snoozeWindow(at(8), at(9))).toBeUndefined();
  });
});

describe('activeSilence', () => {
  const quiet: SilenceWindow = {
    from: at(19),
    to: at(8) + day,
    source: 'quiet-hours',
    allowUrgent: true,
  };
  const snooze: SilenceWindow = { from: at(20), to: at(21), source: 'snooze', allowUrgent: false };

  it('lets urgent through quiet hours but not through a snooze', () => {
    expect(activeSilence([quiet], at(23), 'urgent')).toBeUndefined();
    expect(activeSilence([quiet], at(23), 'normal')).toBe(quiet);
    expect(activeSilence([quiet, snooze], at(20, 30), 'urgent')).toBe(snooze);
  });

  it('ignores windows that do not contain now', () => {
    expect(activeSilence([snooze], at(21), 'low')).toBeUndefined();
    expect(activeSilence([snooze], at(19, 59), 'low')).toBeUndefined();
    expect(activeSilence([], at(20), 'low')).toBeUndefined();
  });
});
