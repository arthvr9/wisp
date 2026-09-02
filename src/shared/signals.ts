import type { SilenceSource } from './nudges';

export type SignalSource = 'clickup';
export type SignalKind = 'task-due';

export interface Signal {
  id: string;
  source: SignalSource;
  kind: SignalKind;
  title: string;
  dueAt: number;
  url: string;
  status: string;
  listName: string;
  closedAt?: number;
}

export type ConnectionState =
  | { state: 'disconnected' }
  | { state: 'authorizing' }
  | { state: 'connected'; lastSyncAt?: number; signalCount: number }
  | { state: 'error'; message: string; lastSyncAt?: number };

export interface SilenceStatus {
  snoozedUntil?: number;
  activeSource?: SilenceSource;
}

export interface SignalsStatus {
  clickup: ConnectionState;
  nextSyncAt?: number;
  silence: SilenceStatus;
}
