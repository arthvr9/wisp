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
}

export type ConnectionState =
  | { state: 'disconnected' }
  | { state: 'authorizing' }
  | { state: 'connected'; lastSyncAt?: number; signalCount: number }
  | { state: 'error'; message: string; lastSyncAt?: number };

export interface SignalsStatus {
  clickup: ConnectionState;
  nextSyncAt?: number;
}
