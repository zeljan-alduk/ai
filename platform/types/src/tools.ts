import type { CallContext } from './context.js';

export interface ToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly source: 'mcp' | 'native';
  readonly mcpServer?: string;
}

export interface ToolResult {
  readonly ok: boolean;
  readonly value: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface ToolRef {
  readonly source: 'mcp' | 'native';
  readonly mcpServer?: string;
  readonly name: string;
}

export interface ToolHost {
  invoke(tool: ToolRef, args: unknown, ctx: CallContext): Promise<ToolResult>;
  listTools(mcpServer?: string): Promise<readonly ToolDescriptor[]>;
}
