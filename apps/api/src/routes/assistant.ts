/**
 * `/v1/assistant/stream` — chat assistant.
 *
 * MISSING_PIECES §10 / Phase B — this route now drives the assistant
 * through `IterativeAgentRun` against a synthetic per-request
 * `AgentSpec` (built by `lib/assistant-agent-spec.ts`). The hand-rolled
 * stub-streamer is gone; tool calls + multi-cycle reasoning + replay
 * + billing telemetry come along as side effects.
 *
 * Wire shape: the SSE frame schema is preserved so the existing web
 * `assistant-panel.tsx` keeps working. We translate engine `RunEvent`s
 * into the same `{ type: 'delta' }` / `{ type: 'done' }` frames the
 * panel already understands, and add a new `{ type: 'tool' }` frame
 * for tool calls that older clients ignore (web SSE parsing is
 * permissive on unknown `type`s).
 *
 * Privacy: the synthetic spec runs at `internal` privacy tier
 * (cloud allowed if the tenant has cloud keys, local-reasoning
 * fallback otherwise). The router enforces fail-closed.
 *
 * Feature flag: ASSISTANT_ENABLED env on the API. When false, the
 * route returns 404. The frontend reads NEXT_PUBLIC_ASSISTANT_ENABLED
 * to decide whether to render the chat panel.
 */

import type { ToolCallPart } from '@aldo-ai/types';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { ASSISTANT_AGENT_NAME, ASSISTANT_SYSTEM_PROMPT } from '../lib/assistant-agent-spec.js';
import {
  type AssistantTelemetry,
  buildDoneFrame,
  translateEvent,
} from '../lib/assistant-sse-frames.js';
import { HttpError, validationError } from '../middleware/error.js';
import { getOrBuildRuntimeAsync } from '../runtime-bootstrap.js';

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
  /**
   * MISSING_PIECES §10 / Phase C — optional thread id supplied by the
   * client. When present the engine writes `runs.thread_id` so the
   * conversation surfaces in the wave-19 threads UI alongside agent
   * runs. Omit on first turn — the client can store the assigned run
   * id locally or wait for the `done` frame's `threadId` field.
   */
  threadId: z.string().min(1).optional(),
});

export function assistantRoutes(deps: Deps): Hono {
  const app = new Hono();
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

    const bundle = await getOrBuildRuntimeAsync(deps, tenantId);
    if (bundle === null) {
      throw new HttpError(
        503,
        'no_model',
        'no reasoning-class model available for this tenant',
      );
    }

    return streamSSE(c, async (sse) => {
      const startedAt = Date.now();
      const telemetry: AssistantTelemetry = {
        tokensIn: 0,
        tokensOut: 0,
        usd: 0,
        lastModel: null,
      };
      const toolCalls = new Map<string, ToolCallPart>();
      const threadId = parsed.data.threadId ?? null;

      try {
        const run = await bundle.runtime.runAgent(
          { name: ASSISTANT_AGENT_NAME },
          {
            messages: parsed.data.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            systemPrompt: ASSISTANT_SYSTEM_PROMPT,
          },
        );

        // MISSING_PIECES §10 / Phase C — link this run to its thread.
        // The engine writes the runs row via PostgresRunStore but
        // doesn't carry thread_id (engine is tenant-agnostic), so we
        // patch it here. Best-effort: the conversation still renders
        // on /runs/<id> if the update fails; only the threads-page
        // grouping degrades.
        if (threadId !== null) {
          void deps.db
            .query('UPDATE runs SET thread_id = $1 WHERE id = $2 AND tenant_id = $3', [
              threadId,
              run.id,
              tenantId,
            ])
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              // Non-fatal — log to stderr; production would route this
              // through the structured logger.
              console.warn(`assistant: failed to set thread_id on run ${run.id}: ${msg}`);
            });
        }

        for await (const ev of run.events()) {
          for (const frame of translateEvent(ev, { toolCalls, telemetry })) {
            await sse.writeSSE({ data: JSON.stringify(frame) });
          }
          if (ev.type === 'run.completed' || ev.type === 'run.cancelled' || ev.type === 'error') {
            await sse.writeSSE({
              data: JSON.stringify(
                buildDoneFrame(telemetry, {
                  runId: run.id,
                  latencyMs: Date.now() - startedAt,
                  threadId,
                }),
              ),
            });
            return;
          }
        }
        // Defensive: iterator closed without a terminal event. Emit a
        // `done` so the panel doesn't hang waiting forever.
        await sse.writeSSE({
          data: JSON.stringify(
            buildDoneFrame(telemetry, {
              runId: run.id,
              latencyMs: Date.now() - startedAt,
              threadId,
            }),
          ),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await sse.writeSSE({
          data: JSON.stringify({ type: 'error', message: msg }),
        });
      }
    });
  });

  return app;
}

declare module '../deps.js' {
  interface Env {
    readonly ASSISTANT_ENABLED?: string;
  }
}
