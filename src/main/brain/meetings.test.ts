import { describe, expect, it } from 'vitest';

import type { Meeting, Signal } from '../../shared/signals';
import { isMeetingSignal, meetingMinutesLeft, meetingWindows } from './meetings';
import { activeSilence } from './silence';

const minute = 60_000;
const now = Date.UTC(2026, 8, 2, 10);

function meetingSig(id: string, dueAt: number, overrides: Partial<Meeting> = {}): Signal {
  return {
    id: `outlook:${id}`,
    source: 'outlook',
    kind: 'meeting',
    title: id,
    dueAt,
    url: `https://outlook.office.com/calendar/item/${id}`,
    status: 'confirmed',
    listName: 'Calendar',
    meeting: {
      endsAt: dueAt + 30 * minute,
      accepted: true,
      allDay: false,
      organizer: 'boss@example.com',
      busy: true,
      ...overrides,
    },
  };
}

function taskSig(id: string, dueAt: number): Signal {
  return {
    id: `clickup:${id}`,
    source: 'clickup',
    kind: 'task-due',
    title: id,
    dueAt,
    url: `https://app.clickup.com/t/${id}`,
    status: 'to do',
    listName: 'Inbox',
  };
}

describe('isMeetingSignal', () => {
  it('is true only for a meeting signal carrying a meeting payload', () => {
    expect(isMeetingSignal(meetingSig('a', now))).toBe(true);
    expect(isMeetingSignal(taskSig('a', now))).toBe(false);
    const noPayload: Signal = { ...meetingSig('a', now), meeting: undefined };
    expect(isMeetingSignal(noPayload)).toBe(false);
  });
});

describe('meetingWindows', () => {
  it('builds a window from dueAt minus the grace to endsAt for an accepted busy meeting', () => {
    const meeting = meetingSig('standup', now, { endsAt: now + 15 * minute });
    expect(meetingWindows([meeting], { enabled: true })).toEqual([
      { from: now - minute, to: now + 15 * minute, source: 'meeting', allowUrgent: true },
    ]);
  });

  it('uses a custom grace when given', () => {
    const meeting = meetingSig('standup', now, { endsAt: now + 15 * minute });
    expect(meetingWindows([meeting], { enabled: true, graceBeforeMs: 5 * minute })).toEqual([
      { from: now - 5 * minute, to: now + 15 * minute, source: 'meeting', allowUrgent: true },
    ]);
  });

  it('skips a declined meeting', () => {
    const meeting = meetingSig('standup', now, { accepted: false });
    expect(meetingWindows([meeting], { enabled: true })).toEqual([]);
  });

  it('skips an all day meeting', () => {
    const meeting = meetingSig('offsite', now, { allDay: true });
    expect(meetingWindows([meeting], { enabled: true })).toEqual([]);
  });

  it('skips a meeting marked free', () => {
    const meeting = meetingSig('optional-sync', now, { busy: false });
    expect(meetingWindows([meeting], { enabled: true })).toEqual([]);
  });

  it('skips non-meeting signals and meeting signals without a payload', () => {
    const noPayload: Signal = { ...meetingSig('a', now), meeting: undefined };
    expect(meetingWindows([taskSig('a', now), noPayload], { enabled: true })).toEqual([]);
  });

  it('returns nothing when disabled', () => {
    const meeting = meetingSig('standup', now);
    expect(meetingWindows([meeting], { enabled: false })).toEqual([]);
  });
});

describe('meetingWindows with activeSilence', () => {
  it('finds the window for a normal nudge but lets an urgent one through', () => {
    const meeting = meetingSig('standup', now, { endsAt: now + 15 * minute });
    const windows = meetingWindows([meeting], { enabled: true });
    expect(activeSilence(windows, now, 'normal')).toEqual(windows[0]);
    expect(activeSilence(windows, now, 'urgent')).toBeUndefined();
  });
});

describe('meetingMinutesLeft', () => {
  it('rounds the minutes between now and the meeting start', () => {
    expect(meetingMinutesLeft(meetingSig('a', now + 5 * minute + 20_000), now)).toBe(5);
    expect(meetingMinutesLeft(meetingSig('a', now - 100_000), now)).toBe(-2);
    expect(meetingMinutesLeft(meetingSig('a', now), now)).toBe(0);
  });
});
