import type { CallContext } from './context.js';
import type { ModelDescriptor } from './model.js';
import type { UsageRecord } from './budget.js';

/** OpenAI-compatible message roles; providers map to their own formats. */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart {
  readonly type: 'text';
  readonly text: string;
}

export interface ImagePart {
  readonly type: 'image';
  readonly url: string;
  readonly mimeType?: string;
}

export interface ToolCallPart {
  readonly type: 'tool_call';
  readonly callId: string;
  readonly tool: string;
  readonly args: unknown;
}

export interface ToolResultPart {
  readonly type: 'tool_result';
  readonly callId: string;
  readonly result: unknown;
  readonly isError?: boolean;
}

export type MessagePart = TextPart | ImagePart | ToolCallPart | ToolResultPart;

export interface Message {
  readonly role: Role;
  readonly content: readonly MessagePart[];
  /** Provider-assigned id. Optional; trace-only. */
  readonly id?: string;
}

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown; // JSON schema
}

export interface CompletionRequest {
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolSchema[];
  readonly responseFormat?:
    | { readonly type: 'text' }
    | { readonly type: 'json' }
    | { readonly type: 'json_schema'; readonly schema: unknown };
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly stop?: readonly string[];
  readonly seed?: number;
}

export interface Delta {
  /** Partial text appended since the last delta. */
  readonly textDelta?: string;
  /** Complete tool call emitted (streamed providers buffer until complete). */
  readonly toolCall?: ToolCallPart;
  /** End-of-stream marker with final usage and selected model. */
  readonly end?: {
    readonly finishReason: 'stop' | 'length' | 'tool_use' | 'error';
    readonly usage: UsageRecord;
    readonly model: ModelDescriptor;
  };
}

export interface ModelGateway {
  complete(req: CompletionRequest, ctx: CallContext): AsyncIterable<Delta>;
  embed(
    req: { readonly input: readonly string[]; readonly dimensions?: number },
    ctx: CallContext,
  ): Promise<readonly (readonly number[])[]>;
}

/** Typed error raised when no model satisfies capability ∩ privacy ∩ budget. */
export class NoEligibleModelError extends Error {
  constructor(
    readonly reason: string,
    readonly ctx: Pick<CallContext, 'required' | 'privacy'>,
  ) {
    super(`no eligible model: ${reason}`);
    this.name = 'NoEligibleModelError';
  }
}
