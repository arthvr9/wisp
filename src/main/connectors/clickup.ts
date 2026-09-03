import { LoopbackOAuthProvider, McpHost } from '../mcp';
import type { SecretStore } from '../mcp';
import { fetchClickUpSignals } from '../signals';
import type { Signal } from '../../shared/signals';
import type { Connector } from './types';

const CLICKUP_URL = 'https://mcp.clickup.com/mcp';
const HORIZON_DAYS = 14;
const SIGNAL_PREFIX = 'clickup:';

function taskIdOf(signalId: string): string {
  return signalId.startsWith(SIGNAL_PREFIX) ? signalId.slice(SIGNAL_PREFIX.length) : signalId;
}

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

    async complete(signalId: string): Promise<void> {
      if (!host.isConnected()) await host.connect();
      const names = (await host.listTools()).map((t) => t.name);
      const updateTask = names.find((n) => n.endsWith('update_task'));
      if (updateTask === undefined) {
        throw new Error('ClickUp MCP server does not offer a task update tool');
      }
      try {
        await host.callTool(updateTask, { task_id: taskIdOf(signalId), status: 'complete' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not mark the ClickUp task complete: ${message}`, { cause: err });
      }
    },

    close(): Promise<void> {
      return host.close();
    },
  };
}
