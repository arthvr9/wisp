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
  // Everything else about actions (snooze, open) is generic and lives in the hub; only the
  // ability to write a completion back to the source differs by connector, so it is the only
  // action-related member on this interface.
  /** Present only on sources that support marking an item done. */
  complete?(signalId: string): Promise<void>;
}
