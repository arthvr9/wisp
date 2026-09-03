import { LoopbackOAuthProvider, McpHost } from '../mcp';
import type { SecretStore } from '../mcp';
import { fetchClickUpSignals } from '../signals';
import type { Signal } from '../../shared/signals';
import type { Connector } from './types';

const CLICKUP_URL = 'https://mcp.clickup.com/mcp';
const HORIZON_DAYS = 14;

export interface ClickUpConnectorOptions {
  secrets: SecretStore;
  openExternal: (url: string) => Promise<void> | void;
  version: string;
}

export function createClickUpConnector(opts: ClickUpConnectorOptions): Connector {
  const provider = new LoopbackOAuthProvider({
    serverKey: 'clickup',
    secrets: opts.secrets,
    openExternal: opts.openExternal,
    clientName: 'Wisp',
  });
  const host = new McpHost({
    url: CLICKUP_URL,
    provider,
    clientInfo: { name: 'wisp', version: opts.version },
  });

  return {
    source: 'clickup',

    hasCredentials(): boolean {
      return provider.hasTokens();
    },

    async connect(): Promise<void> {
      await host.authorize();
    },

    async disconnect(): Promise<void> {
      await host.close();
      provider.clear();
    },

    async fetch(nowMs: number): Promise<Signal[]> {
      if (!host.isConnected()) await host.connect();
      return fetchClickUpSignals(host, { nowMs, horizonDays: HORIZON_DAYS });
    },

    close(): Promise<void> {
      return host.close();
    },
  };
}
