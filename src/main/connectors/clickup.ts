import { z } from 'zod';

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

const statusListSchema = z.looseObject({
  available_statuses: z
    .array(
      z.union([z.string(), z.looseObject({ status: z.string(), type: z.string().optional() })]),
    )
    .optional(),
});

// A list can name its closed status anything, so the literal 'complete' only works by luck.
// Asking the task for the statuses its list allows and picking the closed one is the honest
// version; when the server does not offer that, the literal stays as the fallback.
async function terminalStatus(
  host: McpHost,
  getTask: string | undefined,
  taskId: string,
): Promise<string> {
  if (getTask === undefined) return 'complete';
  try {
    const raw = await host.callTool(getTask, { task_id: taskId, expand_statuses: true });
    const parsed = statusListSchema.safeParse(raw);
    if (!parsed.success) return 'complete';
    const statuses = (parsed.data.available_statuses ?? []).map((entry) =>
      typeof entry === 'string' ? { status: entry, type: undefined } : entry,
    );
    const closed = statuses.find((entry) => entry.type === 'closed' || entry.type === 'done');
    if (closed) return closed.status;
    const named = statuses.find((entry) => /^(complete|closed|done)$/i.test(entry.status));
    return named?.status ?? 'complete';
  } catch {
    return 'complete';
  }
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
      const taskId = taskIdOf(signalId);
      const getTask = names.find((n) => n.endsWith('get_task'));
      const status = await terminalStatus(host, getTask, taskId);
      try {
        await host.callTool(updateTask, { task_id: taskId, status });
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
