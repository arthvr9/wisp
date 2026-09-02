import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { LoopbackOAuthProvider } from './oauth';

export interface McpHostOptions {
  url: string;
  provider: LoopbackOAuthProvider;
  clientInfo: { name: string; version: string };
}

export interface ToolSummary {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface ToolResultLike {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  toolResult?: unknown;
}

export class NeedsAuthorizationError extends Error {
  constructor() {
    super('the MCP server requires interactive authorization');
    this.name = 'NeedsAuthorizationError';
  }
}

export class ToolCallError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolCallError';
  }
}

function textOf(result: ToolResultLike): string {
  return (result.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('\n');
}

export function unwrapToolResult(result: ToolResultLike, tool = 'tool'): unknown {
  if (result.isError === true) {
    throw new ToolCallError(tool, textOf(result) || `${tool} reported an error`);
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  if (result.content === undefined && 'toolResult' in result) return result.toolResult;
  const text = textOf(result);
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return text;
  }
}

export class McpHost {
  private client?: Client;
  private connected = false;

  constructor(private readonly opts: McpHostOptions) {}

  async connect(): Promise<void> {
    if (!this.opts.provider.hasTokens()) throw new NeedsAuthorizationError();
    await this.open();
  }

  async authorize(): Promise<void> {
    const { provider } = this.opts;
    await this.close();
    await provider.beginAuthorization();
    const { client, transport } = this.create();
    try {
      // With valid or refreshable tokens the SDK never redirects and connect just succeeds.
      await client.connect(transport);
      await provider.cancelAuthorization();
      this.adopt(client);
      return;
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        await provider.cancelAuthorization();
        throw err;
      }
    }
    const code = await provider.waitForCallback();
    await transport.finishAuth(code);
    await this.open();
  }

  async listTools(): Promise<ToolSummary[]> {
    const client = this.require();
    const tools: ToolSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({ cursor });
      for (const tool of page.tools) {
        tools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.require().callTool({ name, arguments: args });
    return unwrapToolResult(result, name);
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.connected = false;
    await client?.close();
  }

  isConnected(): boolean {
    return this.connected;
  }

  private create(): { client: Client; transport: StreamableHTTPClientTransport } {
    const transport = new StreamableHTTPClientTransport(new URL(this.opts.url), {
      authProvider: this.opts.provider,
    });
    const client = new Client(this.opts.clientInfo);
    return { client, transport };
  }

  private async open(): Promise<void> {
    await this.close();
    const { client, transport } = this.create();
    try {
      await client.connect(transport);
    } catch (err) {
      if (err instanceof UnauthorizedError) throw new NeedsAuthorizationError();
      throw err;
    }
    this.adopt(client);
  }

  private adopt(client: Client): void {
    this.client = client;
    this.connected = true;
    client.onclose = () => {
      if (this.client === client) this.connected = false;
    };
  }

  private require(): Client {
    if (this.client === undefined || !this.connected) {
      throw new Error('MCP host is not connected');
    }
    return this.client;
  }
}
