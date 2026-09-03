import { fetchGruplySignals, gruplyClient } from '../gruply';
import type { GruplyClient } from '../gruply';
import type { GruplyConfig } from '../../shared/config';
import type { Signal } from '../../shared/signals';
import type { Connector } from './types';

export interface GruplyConnectorOptions {
  token: () => string | undefined;
  config: () => GruplyConfig;
}

export function createGruplyConnector(opts: GruplyConnectorOptions): Connector {
  function client(): GruplyClient {
    return gruplyClient({ baseUrl: opts.config().baseUrl, token: opts.token });
  }

  return {
    source: 'gruply',

    hasCredentials(): boolean {
      return opts.token() !== undefined && opts.config().email.trim() !== '';
    },

    async connect(): Promise<void> {
      if (opts.config().email.trim() === '') {
        throw new Error('Gruply email is not set');
      }
      // There is no interactive authorization flow for a plain bearer token, so a cheap read
      // is the only way to confirm the key works.
      await client().get('/projects', { perPage: '1' });
    },

    disconnect(): Promise<void> {
      // The token lives in the caller's secret store, not here, so there is nothing to clear.
      return Promise.resolve();
    },

    fetch(nowMs: number): Promise<Signal[]> {
      return fetchGruplySignals(client(), { nowMs, email: opts.config().email });
    },

    close(): void {
      // No connection is held between syncs, so there is nothing to close.
    },
  };
}
