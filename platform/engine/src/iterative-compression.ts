/**
 * MISSING_PIECES §9 / Phase C — history compression for IterativeAgentRun.
 *
 * Two strategies, both opted into per-spec via `iteration.summaryStrategy`:
 *
 *  1. **rolling-window** — drop oldest user/assistant pairs until the
 *     estimated token count is comfortably under the context window.
 *     Always keep the system message + the last two assistant/user
 *     turns so the model retains its instructions and the immediate
 *     context.
 *
 *  2. **periodic-summary** — gateway-call the same model with a
 *     "summarise the conversation so far" prompt; replace the dropped
 *     turns with a single system-tagged summary message. Hard cap at
 *     3 summaries per run — once we hit the cap we degrade to
 *     rolling-window so a runaway loop can't keep eating tokens.
 *
 * Token estimation defaults to `chars / 4`. Adapter-specific overrides
 * (Anthropic exposes a real counting endpoint) plug in later via the
 * gateway's `ProviderAdapter.estimateTokens()`; v0 keeps the heuristic
 * inline so the loop ships without a gateway-side dep.
 *
 * The compressor itself is stateful only in the summary counter — it
 * remembers how many times it has summarised this run so the cap
 * holds across cycles. One instance per IterativeAgentRun; the
 * runtime constructs a fresh one for every iterative leaf it spawns.
 */

import type {
  CallContext,
  CompletionRequest,
  Delta,
  Message,
  ModelGateway,
  TextPart,
} from '@aldo-ai/types';
import type { HistoryCompressor } from './iterative-run.js';

/** Heuristic when no provider counts: 4 chars ≈ 1 token. */
export function estimateTokens(messages: readonly Message[]): number {
  let chars = 0;
  for (const m of messages) {
    for (const part of m.content) {
      if (part.type === 'text') chars += part.text.length;
      else if (part.type === 'tool_call') chars += stringifyArgs(part.args).length + 32;
      else if (part.type === 'tool_result')
        chars += stringifyResult(part.result).length + 16;
      else if (part.type === 'image') chars += 1024; // image placeholder budget
    }
    chars += 8; // role/turn overhead
  }
  return Math.ceil(chars / 4);
}

function stringifyArgs(args: unknown): string {
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}
function stringifyResult(result: unknown): string {
  return stringifyArgs(result);
}

/** Threshold at which we trigger compression — 80% of declared window. */
const COMPRESS_RATIO = 0.8;

/** How many `periodic-summary` calls we allow before falling back. */
const MAX_SUMMARIES = 3;

export class RealHistoryCompressor implements HistoryCompressor {
  private summariesUsed = 0;

  shouldCompress(history: readonly Message[], contextWindow: number): boolean {
    if (contextWindow <= 0) return false;
    const tokens = estimateTokens(history);
    return tokens >= Math.floor(contextWindow * COMPRESS_RATIO);
  }

  async compress(
    history: readonly Message[],
    strategy: 'rolling-window' | 'periodic-summary',
    ctx: { readonly gateway: ModelGateway; readonly callCtx: CallContext },
  ): Promise<{
    readonly messages: readonly Message[];
    readonly droppedMessages: number;
    readonly keptMessages: number;
    readonly summarisedTo?: string;
  }> {
    if (strategy === 'periodic-summary' && this.summariesUsed < MAX_SUMMARIES) {
      this.summariesUsed += 1;
      return this.summarise(history, ctx);
    }
    return rollingWindow(history);
  }

  private async summarise(
    history: readonly Message[],
    ctx: { readonly gateway: ModelGateway; readonly callCtx: CallContext },
  ): Promise<{
    readonly messages: readonly Message[];
    readonly droppedMessages: number;
    readonly keptMessages: number;
    readonly summarisedTo: string;
  }> {
    // Keep system + last 2 turns; ask the model to summarise everything in between.
    const split = partitionForCompression(history);
    if (split.middle.length === 0) {
      // Nothing to compress — fall through to a no-op so the caller
      // doesn't spin on a model call that summarises nothing.
      return {
        messages: history,
        droppedMessages: 0,
        keptMessages: history.length,
        summarisedTo: '(no compression — too short)',
      };
    }

    const summary = await callModelForSummary(ctx.gateway, ctx.callCtx, split.middle);
    const summaryMessage: Message = {
      role: 'system',
      content: [
        {
          type: 'text',
          text: `[Earlier conversation summary]\n${summary}`,
        },
      ],
    };

    const compressed: readonly Message[] = [...split.head, summaryMessage, ...split.tail];
    return {
      messages: compressed,
      droppedMessages: split.middle.length,
      keptMessages: compressed.length,
      summarisedTo: summary,
    };
  }
}

/**
 * Drop oldest user/assistant pairs until estimatedTokens dips below
 * the keep-floor. Always keeps the system prompt + the last two turns
 * (one user-facing + one assistant-facing) so the model has its
 * instructions + the immediate context. Tool messages stay glued to
 * their preceding assistant turn so we never hand the model a
 * dangling tool-result without its tool-call.
 */
function rollingWindow(history: readonly Message[]): {
  readonly messages: readonly Message[];
  readonly droppedMessages: number;
  readonly keptMessages: number;
} {
  const split = partitionForCompression(history);
  if (split.middle.length === 0) {
    return {
      messages: history,
      droppedMessages: 0,
      keptMessages: history.length,
    };
  }
  const compressed: readonly Message[] = [...split.head, ...split.tail];
  return {
    messages: compressed,
    droppedMessages: split.middle.length,
    keptMessages: compressed.length,
  };
}

interface Partition {
  readonly head: readonly Message[]; // system messages at the front
  readonly middle: readonly Message[]; // candidate-for-compression body
  readonly tail: readonly Message[]; // last 2 non-system turns + their tool replies
}

/**
 * Split the history into:
 *   head   — every leading system message
 *   tail   — the last two non-system turns plus any tool messages that
 *            chained off the second-to-last assistant turn (so we
 *            never strand a tool_result without its preceding
 *            tool_call)
 *   middle — everything in between (the compression candidate set)
 */
function partitionForCompression(history: readonly Message[]): Partition {
  // Find the boundary where leading systems end.
  let headEnd = 0;
  while (headEnd < history.length && history[headEnd]?.role === 'system') {
    headEnd += 1;
  }

  // Walk backward and pick out the last 2 non-system "anchors"
  // (assistant or user). Anchor list grows leftward.
  const anchors: number[] = [];
  for (let i = history.length - 1; i >= headEnd && anchors.length < 2; i -= 1) {
    const m = history[i];
    if (m?.role === 'assistant' || m?.role === 'user') anchors.unshift(i);
  }
  if (anchors.length === 0) {
    return {
      head: history.slice(0, headEnd),
      middle: [],
      tail: history.slice(headEnd),
    };
  }
  // The earliest anchor pulls along its tool messages (we splice
  // backwards from history.end so any trailing tool turns stay with
  // their assistant). Find the cut: include everything from the first
  // anchor onward in the tail.
  const cut = anchors[0] ?? headEnd;
  return {
    head: history.slice(0, headEnd),
    middle: history.slice(headEnd, cut),
    tail: history.slice(cut),
  };
}

/**
 * Issue a one-shot completion asking the model to summarise the
 * provided messages. Returns the assistant text (concatenated). On
 * any error or empty response we fall back to a synthetic placeholder
 * so the caller can still proceed with rolling-window semantics.
 */
async function callModelForSummary(
  gateway: ModelGateway,
  ctx: CallContext,
  middle: readonly Message[],
): Promise<string> {
  const summaryRequest: CompletionRequest = {
    messages: [
      {
        role: 'system',
        content: [
          {
            type: 'text',
            text:
              'Summarise the following conversation in 4-8 bullet points. ' +
              'Preserve every concrete fact, file name, error message, and decision. ' +
              'Do not add commentary; output only the bullet list.',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: serialiseHistoryForSummary(middle),
          },
        ],
      },
    ],
    seed: 0,
  };

  const stream: AsyncIterable<Delta> = gateway.complete(summaryRequest, ctx);
  let text = '';
  try {
    for await (const delta of stream) {
      if (delta.textDelta !== undefined) text += delta.textDelta;
    }
  } catch {
    return '(summary unavailable — gateway error)';
  }
  if (text.length === 0) return '(summary unavailable — empty)';
  return text;
}

function serialiseHistoryForSummary(messages: readonly Message[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const text = m.content
      .filter((p): p is TextPart => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
    if (text.length === 0) continue;
    lines.push(`[${m.role}] ${text}`);
  }
  return lines.join('\n\n');
}
