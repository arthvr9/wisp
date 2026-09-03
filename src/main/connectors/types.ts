import type { Signal, SignalSource } from '../../shared/signals';

export interface Connector {
  readonly source: SignalSource;
  /** True when credentials are already stored, so a restart can resume without asking. */
  hasCredentials(): boolean;
  /** Interactive authorization. Throws with a short message on failure. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Reads the current signals. Throws NeedsAuthorizationError when the grant is gone. */
  fetch(nowMs: number): Promise<Signal[]>;
  close(): Promise<void> | void;
}
