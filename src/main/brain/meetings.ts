import type { SilenceWindow } from '../../shared/nudges';
import type { Meeting, Signal } from '../../shared/signals';
import { MINUTE_MS } from './silence';

export interface MeetingSilenceOptions {
  enabled: boolean;
  graceBeforeMs?: number;
}

const DEFAULT_GRACE_MS = MINUTE_MS;

export function isMeetingSignal(signal: Signal): boolean {
  return signal.kind === 'meeting' && signal.meeting !== undefined;
}

interface CountingMeeting {
  signal: Signal;
  meeting: Meeting;
}

function meetingsThatCount(signals: readonly Signal[]): CountingMeeting[] {
  const result: CountingMeeting[] = [];
  for (const signal of signals) {
    const meeting = signal.meeting;
    if (!isMeetingSignal(signal) || meeting === undefined) continue;
    if (meeting.accepted && !meeting.allDay && meeting.busy) result.push({ signal, meeting });
  }
  return result;
}

export function meetingWindows(
  signals: readonly Signal[],
  opts: MeetingSilenceOptions,
): SilenceWindow[] {
  if (!opts.enabled) return [];
  const grace = opts.graceBeforeMs ?? DEFAULT_GRACE_MS;
  return meetingsThatCount(signals).map(({ signal, meeting }) => ({
    from: signal.dueAt - grace,
    to: meeting.endsAt,
    source: 'meeting',
    allowUrgent: true,
  }));
}

export function meetingMinutesLeft(signal: Signal, nowMs: number): number {
  const minutes = Math.round((signal.dueAt - nowMs) / MINUTE_MS);
  return minutes === 0 ? 0 : minutes;
}
