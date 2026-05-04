/**
 * Production `PromptRunner` for `POST /v1/prompts/:id/test`.
 *
 * Wires the existing per-tenant `RuntimeBundle.gateway` from
 * `runtime-bootstrap.ts` to the prompt-playground seam declared in
 * `routes/prompts.ts`. Closes MISSING_PIECES.md piece #5.
 *
 * Behaviour:
 *  - Resolve the tenant runtime; if no providers are wired (dev / test),
 *    fall back to the deterministic echo so the playground UI still
 *    renders something and the existing test surface keeps passing.
 *  - Otherwise build a `CompletionRequest` from the resolved prompt
 *    body, route it through `gateway.completeWith({ primaryClass })`,
 *    accumulate `Delta` text chunks into the final output, and read
 *    the end-of-stream `usage` for tokens / cost / model id.
 *  - Persist a `runs` + `usage_records` row so the spend dashboard
 *    sees prompt-playground spend the same way it sees agent-run spend.
 *  - Surface `NoEligibleModelError` as a typed 422 — same shape the
 *    runs route uses when privacy/capability rules out every model.
 *
 * The route's existing `runner` injection seam is preserved: tests can
 * still hand a stub via `promptsRoutes(deps, { runner })`.
 */

import { randomUUID } from 'node:crypto';
import { NoEligibleModelError } from '@aldo-ai/gateway';
import type {
  CallContext,
  CompletionRequest,
  PrivacyTier,
  RunId,
  TenantId,
  TraceId,
} from '@aldo-ai/types';
import type { Deps } from '../deps.js';
import { HttpError } from '../middleware/error.js';
import type { PromptRunOpts, PromptRunResult, PromptRunner } from '../routes/prompts.js';
import { getOrBuildRuntimeAsync } from '../runtime-bootstrap.js';

export function createGatewayPromptRunner(deps: Deps): PromptRunner {
  return {
    async run(opts: PromptRunOpts): Promise<PromptRunResult> {
      const start = Date.now();
      const bundle = await getOrBuildRuntimeAsync(deps, opts.tenantId);
      if (bundle === null) {
        return echoFallback(opts, start);
      }

      const runId = `prompt-test-${randomUUID()}`;
      const ctx: CallContext = {
        required: [],
        privacy: 'internal' as PrivacyTier,
        budget: { usdMax: 1, usdGrace: 0.05 },
        tenant: opts.tenantId as TenantId,
        runId: runId as RunId,
        traceId: runId as TraceId,
        agentName: '__prompt_test__',
        agentVersion: '0',
      };
      const req: CompletionRequest = {
        messages: [{ role: 'user', content: [{ type: 'text', text: opts.body }] }],
        maxOutputTokens: opts.maxTokensOut ?? 1024,
      };

      try {
        let outputText = '';
        let modelId = `capability:${opts.capability}`;
        let provider = 'unknown';
        let tokensIn = 0;
        let tokensOut = 0;
        let costUsd = 0;
        for await (const delta of bundle.gateway.completeWith(req, ctx, {
          primaryClass: opts.capability,
        })) {
          if (delta.textDelta !== undefined) outputText += delta.textDelta;
          if (delta.end !== undefined) {
            modelId = delta.end.model.id;
            provider = delta.end.model.provider ?? provider;
            tokensIn = delta.end.usage.tokensIn;
            tokensOut = delta.end.usage.tokensOut;
            costUsd = delta.end.usage.usd;
          }
        }
        const latencyMs = Date.now() - start;
        await persistTelemetry(deps, {
          runId,
          tenantId: opts.tenantId,
          provider,
          modelId,
          tokensIn,
          tokensOut,
          costUsd,
        });
        return {
          output: outputText,
          model: modelId,
          tokensIn,
          tokensOut,
          costUsd,
          latencyMs,
        };
      } catch (err) {
        if (err instanceof NoEligibleModelError) {
          throw new HttpError(422, 'no_eligible_model', err.message, {
            capability: opts.capability,
          });
        }
        throw err;
      }
    },
  };
}

function echoFallback(opts: PromptRunOpts, start: number): PromptRunResult {
  const reply = `[capability=${opts.capability}] ${opts.body.slice(0, 240)}`;
  return {
    output: reply,
    model: `capability:${opts.capability}`,
    tokensIn: Math.ceil(opts.body.length / 4),
    tokensOut: Math.ceil(reply.length / 4),
    costUsd: 0,
    latencyMs: Math.max(0, Date.now() - start),
  };
}

interface TelemetryRow {
  readonly runId: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly modelId: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
}

async function persistTelemetry(deps: Deps, row: TelemetryRow): Promise<void> {
  // Both inserts are best-effort — a telemetry write that fails MUST
  // NOT break the playground response. Spend dashboard joins
  // `runs` LEFT JOIN `usage_records`, so we create both rows.
  try {
    await deps.db.query(
      `INSERT INTO runs
         (id, tenant_id, agent_name, agent_version, status, started_at, root_run_id)
       VALUES ($1, $2, '__prompt_test__', '0', 'completed', NOW(), $1)
       ON CONFLICT (id) DO NOTHING`,
      [row.runId, row.tenantId],
    );
    await deps.db.query(
      `INSERT INTO usage_records
         (id, run_id, span_id, provider, model, tokens_in, tokens_out, usd, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        randomUUID(),
        row.runId,
        `${row.runId}-span`,
        row.provider,
        row.modelId,
        row.tokensIn,
        row.tokensOut,
        String(row.costUsd),
      ],
    );
  } catch (err) {
    console.warn('[prompt-runner] telemetry write failed:', err);
  }
}
