import type { SilenceSource } from './nudges';

export type SignalSource = 'clickup' | 'outlook' | 'gruply';
export const SIGNAL_SOURCES: readonly SignalSource[] = ['clickup', 'outlook', 'gruply'];
export type SignalKind = 'task-due' | 'meeting';

export interface Meeting {
  endsAt: number;
  accepted: boolean;
  allDay: boolean;
  organizer: string;
  busy: boolean;
}

export interface Signal {
  id: string;
  source: SignalSource;
  kind: SignalKind;
  /** Due date for a task, start time for a meeting. */
  dueAt: number;
  title: string;
  url: string;
  status: string;
  /** List for a task, calendar for a meeting. */
  listName: string;
  closedAt?: number;
  meeting?: Meeting;
}

export type ConnectionState =
  | { state: 'disconnected' }
  | { state: 'authorizing' }
  | { state: 'connected'; lastSyncAt?: number; signalCount: number }
  | { state: 'error'; message: string; lastSyncAt?: number };

export type SignalAction = 'complete' | 'snooze' | 'open';

export interface SignalActions {
  /** Which actions this source supports. Opening a link always works. */
  complete: boolean;
}

export interface DayItem {
  signal: Signal;
  minutesLeft: number;
  overdue: boolean;
  snoozedUntil?: number;
  actions: SignalActions;
}

export interface SilenceStatus {
  snoozedUntil?: number;
  activeSource?: SilenceSource;
}

export interface SignalsStatus {
  connectors: Record<SignalSource, ConnectionState>;
  /** Sources the scheduler is polling. A source that never authorized is not in here. */
  active: SignalSource[];
  nextSyncAt?: number;
  silence: SilenceStatus;
  secretsEncrypted: boolean;
}
