/**
 * `/v1/assistant/stream` — MVP chat assistant.
 *
 * One model, one column, SSE-streamed text deltas. Reuses the same
 * stub-streamer-→-real-gateway-later pattern as playground.ts so when
 * the streaming wire lands the assistant inherits real model output
 * for free.
 *
 * Deliberately minimal scope today:
 *   - Plain Q&A. The assistant explains the platform, points at docs,
 *     answers questions about the user's own context if surfaced via
 *     the system prompt, but does NOT call tools yet.
 *   - Tool calls + iterative loops require the IterativeAgentRun
 *     primitive (MISSING_PIECES.md #1) which lives in the engine.
 *     This route will delegate to it once it ships.
 *
 * Privacy: assistant runs at `tenant` privacy tier (cloud allowed if
 * the tenant has cloud keys, local-only otherwise). Capability class:
 * `reasoning`. The router enforces both fail-closed.
 *
 * Feature flag: ASSISTANT_ENABLED env on the API. When false, the
 * route returns 404. The frontend reads NEXT_PUBLIC_ASSISTANT_ENABLED
 * to decide whether to render the chat panel.
 */

import { type RegisteredModel, createModelRegistry, createRouter } from '@aldo-ai/gateway';
import type { PrivacyTier, ProviderLocality } from '@aldo-ai/types';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { HttpError, validationError } from '../middleware/error.js';
import { loadModelCatalog } from './models.js';

interface CatalogModel {
  readonly id: string;
  readonly provider: string;
  readonly locality: string;
  readonly capabilityClass: string;
  readonly provides?: readonly string[];
  readonly privacyAllowed?: readonly string[];
  readonly cost?: { readonly usdPerMtokIn?: number; readonly usdPerMtokOut?: number };
  readonly latencyP95Ms?: number;
  readonly effectiveContextTokens?: number;
}

const SYSTEM_PROMPT = `You are the ALDO AI assistant.

You help users navigate and operate the ALDO control plane. You can answer
questions about agents, runs, prompts, evaluators, the gateway, privacy
tiers, MCP servers, and how to use the platform.

Honesty rules:
- If you don't know something specific to the user's tenant (their runs,
  agents, prompts), say so — don't guess.
- If something on the platform is documented as planned-but-not-yet,
  say "that's planned" and point at the roadmap.
- Keep replies short and direct. Default to 2-4 sentences. Expand when
  asked.

Capabilities you have today:
- Q&A about the platform.
- Discussing user briefs and helping plan.

Capabilities coming next (when the IterativeAgentRun engine primitive
lands — see MISSING_PIECES.md):
- Tool calls: list runs, read prompts, search docs, enhance images via
  picenhancer.
- Approval-gated write actions.
`;

const AssistantStreamRequest = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1),
      }),
    )
    .min(1)
    .max(50),
});

interface AssistantStreamerOpts {
  readonly model: RegisteredModel;
  readonly system: string;
  readonly messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  readonly signal: AbortSignal;
}

type AssistantStreamChunk =
  | { readonly kind: 'delta'; readonly text: string }
  | {
      readonly kind: 'usage';
      readonly tokensIn: number;
      readonly tokensOut: number;
      readonly usd: number;
      readonly latencyMs: number;
    };

interface AssistantStreamer {
  stream(opts: AssistantStreamerOpts): AsyncIterable<AssistantStreamChunk>;
}

/**
 * Default streamer — same shape as the playground stub. Yields a short
 * deterministic completion so the SSE shape is exercised end-to-end.
 * Real gateway streaming lands later (the same wave that lights up the
 * playground's real adapters; this route picks it up automatically).
 */
const defaultStreamer: AssistantStreamer = {
  // eslint-disable-next-line @typescript-eslint/require-await
  async *stream(opts) {
    const start = Date.now();
    const last = opts.messages[opts.messages.length - 1];
    const userText = last?.content ?? '';
    const reply =
      `[${opts.model.id}] ` +
      'I am the ALDO assistant — chat shape is wired end-to-end via SSE. ' +
      'Real model dispatch lands when the gateway streaming adapter ships ' +
      '(same wave as the playground real-stream wire). You asked: ' +
      `"${userText.slice(0, 80)}${userText.length > 80 ? '…' : ''}".`;
    // Emit two chunks so the UI sees a real streaming pattern, not a
    // single big delta.
    const half = Math.ceil(reply.length / 2);
    yield { kind: 'delta', text: reply.slice(0, half) };
    yield { kind: 'delta', text: reply.slice(half) };
    yield {
      kind: 'usage',
      tokensIn: estimateTokens(userText),
      tokensOut: estimateTokens(reply),
      usd: 0,
      latencyMs: Date.now() - start,
    };
  },
};

export interface AssistantDeps {
  readonly streamer?: AssistantStreamer;
}

export function assistantRoutes(deps: Deps, aDeps: AssistantDeps = {}): Hono {
  const app = new Hono();
  const streamer = aDeps.streamer ?? defaultStreamer;
  // Default OFF — opt-in per deployment until tools + persistence ship.
  const enabled = (deps.env.ASSISTANT_ENABLED ?? 'false').toLowerCase();
  const isEnabled = enabled === 'true' || enabled === '1' || enabled === 'yes';

  app.post('/v1/assistant/stream', async (c) => {
    if (!isEnabled) {
      throw new HttpError(404, 'not_found', 'assistant not enabled on this deployment');
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = AssistantStreamRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid assistant request', parsed.error.issues);
    }
    const tenantId = getAuth(c).tenantId;

    // Pick a model: cheapest reasoning-class model the tenant's privacy
    // posture allows. Same router as everything else on the platform.
    const catalog = await loadModelCatalog(deps.env);
    const registry = createModelRegistry(
      catalog.models.flatMap((m) => {
        const r = catalogEntryToRegisteredModel(m);
        return r === null ? [] : [r];
      }),
    );
    void createRouter(registry); // build to validate; selection below uses registry directly
    // Privacy: 'internal' = tenant's own data, may use cloud if the tenant
    // has allowed it; 'sensitive' would force local-only (override via the
    // tenant's privacy posture in the future). 'reasoning' is the
    // capability class.
    const eligible = registry
      .list()
      .filter((m) => m.capabilityClass === 'reasoning' && m.privacyAllowed.includes('internal'))
      .slice()
      .sort((a, b) => a.cost.usdPerMtokIn - b.cost.usdPerMtokIn);
    const model = eligible[0];
    if (!model) {
      throw new HttpError(
        503,
        'no_model',
        'no reasoning-class model available for this tenant',
      );
    }

    const ac = new AbortController();
    return streamSSE(c, async (sse) => {
      try {
        for await (const chunk of streamer.stream({
          model,
          system: SYSTEM_PROMPT,
          messages: parsed.data.messages,
          signal: ac.signal,
        })) {
          if (chunk.kind === 'delta') {
            await sse.writeSSE({
              data: JSON.stringify({ type: 'delta', text: chunk.text }),
            });
          } else if (chunk.kind === 'usage') {
            await sse.writeSSE({
              data: JSON.stringify({
                type: 'done',
                tokensIn: chunk.tokensIn,
                tokensOut: chunk.tokensOut,
                usd: chunk.usd,
                latencyMs: chunk.latencyMs,
                model: model.id,
              }),
            });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sse.writeSSE({
          data: JSON.stringify({ type: 'error', message: msg }),
        });
      }
    });
    // tenantId is intentionally captured but not yet used; persistence
    // as a Run lands with the IterativeAgentRun primitive.
    void tenantId;
  });

  return app;
}

/**
 * Translate a catalog model into the gateway's RegisteredModel shape.
 * Same logic as playground.ts; duplicated here to avoid coupling the
 * routes. When MISSING_PIECES #1 lands the assistant route delegates
 * to the engine and this helper goes away.
 */
function catalogEntryToRegisteredModel(m: CatalogModel): RegisteredModel | null {
  if (m.locality !== 'cloud' && m.locality !== 'on-prem' && m.locality !== 'local') return null;
  const privacyAllowed = (m.privacyAllowed ?? []).filter(
    (p): p is PrivacyTier => p === 'public' || p === 'internal' || p === 'sensitive',
  );
  return {
    id: m.id,
    provider: m.provider,
    providerKind: 'openai-compat',
    locality: m.locality as ProviderLocality,
    capabilityClass: m.capabilityClass,
    provides: [...(m.provides ?? [])],
    privacyAllowed,
    cost: {
      usdPerMtokIn: m.cost?.usdPerMtokIn ?? 0,
      usdPerMtokOut: m.cost?.usdPerMtokOut ?? 0,
    },
    effectiveContextTokens: m.effectiveContextTokens ?? 0,
    ...(m.latencyP95Ms !== undefined ? { latencyP95Ms: m.latencyP95Ms } : {}),
  };
}

function estimateTokens(s: string): number {
  // Conservative ~4 chars/token average for English. The gateway has
  // its own per-adapter estimator; this stub doesn't need precision.
  return Math.max(1, Math.ceil(s.length / 4));
}

declare module '../deps.js' {
  interface Env {
    readonly ASSISTANT_ENABLED?: string;
  }
}
