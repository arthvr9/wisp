export type SilenceSource = 'quiet-hours' | 'snooze' | 'fullscreen' | 'do-not-disturb' | 'meeting';

export interface SilenceWindow {
  from: number;
  to: number;
  source: SilenceSource;
  allowUrgent: boolean;
}

export type Urgency = 'low' | 'normal' | 'urgent';

export type NudgeKind = 'due-soon' | 'due-now' | 'overdue' | 'due-today';

export interface Nudge {
  signalId: string;
  kind: NudgeKind;
  urgency: Urgency;
  title: string;
  url: string;
  dueAt: number;
  minutesLeft: number;
  repeat: number;
}

export interface NudgeRecord {
  signalId: string;
  kind: NudgeKind;
  at: number;
}

export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}

export interface NudgeBudget {
  maxPerHour: number;
  maxPerDay: number;
}
