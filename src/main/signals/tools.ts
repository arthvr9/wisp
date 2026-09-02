export interface ToolCaller {
  listTools(): Promise<{ name: string }[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}
