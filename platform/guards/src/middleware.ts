import type {
  CallContext,
  CompletionRequest,
  Delta,
  Message,
  MessagePart,
  ToolResultPart,
} from '@aldo-ai/types';
import { type ResolvedGuardsConfig, severityAtLeast } from './config.js';
import { type ScanResult, scanOutput } from './output-scanner.js';
import { DualLlmQuarantine, type QuarantineGateway, type QuarantineResult } from './quarantine.js';
import { stringifyForSpotlight, wrapUntrustedContent } from './spotlighting.js';

/**
 * GatewayMiddleware: a `before` hook applied to the inbound request (which
 * is where tool results live before being fed to the next model call) and an
 * `after` hook applied to each outbound delta (where the model's text reply
 * is forming up). Both hooks are async-friendly to leave room for quarantine
 * round-trips.
 */
export interface GatewayMiddleware {
  readonly name: string;
  before(req: CompletionRequest, ctx: CallContext): Promise<CompletionRequest>;
  after(delta: Delta, ctx: CallContext): Promise<Delta>;
}

/** Optional event sink for transparency / OTEL bridging. */
export interface GuardsEventSink {
  onScan?(direction: 'inbound' | 'outbound', result: ScanResult, ctx: CallContext): void;
  onQuarantine?(result: QuarantineResult, ctx: CallContext): void;
  onBlock?(reason: string, result: ScanResult, ctx: CallContext): void;
}

export interface GuardsMiddlewareOptions {
  readonly config: ResolvedGuardsConfig;
  /** Required only when `config.quarantine.enabled` is true. */
  readonly gateway?: QuarantineGateway;
  readonly events?: GuardsEventSink;
}

export class GuardsBlockedError extends Error {
  constructor(
    readonly reason: string,
    readonly findings: ScanResult,
  ) {
    super(`guards blocked: ${reason}`);
    this.name = 'GuardsBlockedError';
  }
}

/**
 * Build a middleware that:
 *   - on `before`: walks the incoming request, finds every `tool_result`
 *     part, runs the scanner, optionally quarantines large outputs, then
 *     wraps the (possibly-replaced) text in spotlighting delimiters.
 *   - on `after`: scans each text delta as it streams out, blocking when
 *     the policy says so.
 */
export function createGuardsMiddleware(opts: GuardsMiddlewareOptions): GatewayMiddleware {
  const { config, gateway, events } = opts;
  const quarantine =
    config.quarantine.enabled && gateway !== undefined
      ? new DualLlmQuarantine(gateway, config.quarantine)
      : undefined;

  const scannerEnabled = config.outputScanner.enabled;
  const blockAt = config.outputScanner.severityBlock;

  return {
    name: 'aldo-guards',

    async before(req, ctx) {
      const newMessages: Message[] = [];
      for (const m of req.messages) {
        const newParts: MessagePart[] = [];
        for (const part of m.content) {
          if (part.type !== 'tool_result') {
            newParts.push(part);
            continue;
          }

          let raw = stringifyForSpotlight(part.result);

          // Quarantine path runs first so the scanner+spotlight sees the
          // replacement text instead of the raw bytes.
          if (quarantine?.shouldQuarantine(raw)) {
            const qres = await quarantine.run(raw, ctx);
            events?.onQuarantine?.(qres, ctx);
            raw = qres.safeText;
          }

          if (scannerEnabled) {
            const scan = scanOutput(raw, { urlAllowlist: config.outputScanner.urlAllowlist });
            events?.onScan?.('inbound', scan, ctx);
            if (scan.maxSeverity !== undefined && severityAtLeast(scan.maxSeverity, blockAt)) {
              const reason = `inbound tool result tripped guards (max=${scan.maxSeverity})`;
              events?.onBlock?.(reason, scan, ctx);
              throw new GuardsBlockedError(reason, scan);
            }
          }

          const wrapped = config.spotlighting
            ? wrapUntrustedContent(raw, { source: `tool:${part.callId}` })
            : raw;

          const replaced: ToolResultPart = {
            type: 'tool_result',
            callId: part.callId,
            result: wrapped,
            ...(part.isError !== undefined ? { isError: part.isError } : {}),
          };
          newParts.push(replaced);
        }
        newMessages.push({ ...m, content: newParts });
      }
      return { ...req, messages: newMessages };
    },

    async after(delta, ctx) {
      if (!scannerEnabled) return delta;
      if (!delta.textDelta) return delta;
      const scan = scanOutput(delta.textDelta, {
        urlAllowlist: config.outputScanner.urlAllowlist,
      });
      events?.onScan?.('outbound', scan, ctx);
      if (scan.maxSeverity !== undefined && severityAtLeast(scan.maxSeverity, blockAt)) {
        const reason = `outbound delta tripped guards (max=${scan.maxSeverity})`;
        events?.onBlock?.(reason, scan, ctx);
        throw new GuardsBlockedError(reason, scan);
      }
      return delta;
    },
  };
}
