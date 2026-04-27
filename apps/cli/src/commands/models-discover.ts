/**
 * `aldo models discover` — probe well-known local-LLM ports
 * (Ollama, vLLM, llama.cpp, LM Studio) and print whatever responded.
 *
 * Exit code:
 *   0 — at least one model was discovered
 *   1 — nothing discovered (so CI gates that depend on a local server
 *        being up can fail loudly)
 *
 * The probe set is configurable via env:
 *   ALDO_LOCAL_DISCOVERY=ollama,vllm,llamacpp,lmstudio  (default: all)
 *   ALDO_LOCAL_DISCOVERY=none                           (disables it)
 *
 * This command performs the probe directly from the user's machine
 * — it is intentionally NOT a thin wrapper over `/v1/models`. The
 * whole point is to surface what's reachable from where the user
 * sits, which the API server (often elsewhere) cannot answer.
 *
 * No provider name is keyed off in the rendering logic — the
 * `source` column is a runtime label only. The router has no opinion
 * about it; routing remains capability/privacy/cost based.
 */

import { type DiscoverOptions, type DiscoveredModel, discover } from '@aldo-ai/local-discovery';
import type { CliIO } from '../io.js';
import { writeJson, writeLine } from '../io.js';

export interface ModelsDiscoverOptions {
  readonly json?: boolean;
  /** Per-probe timeout in ms. Defaults to the package default (1 s). */
  readonly timeoutMs?: number;
}

export interface ModelsDiscoverHooks {
  /** Test seam: replace the discover() call. */
  readonly discover?: typeof discover;
  /** Test seam: env source. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Render the discovered model list as a fixed-column table. Columns:
 *   id | source | capabilityClass | locality | baseUrl
 *
 * Width is the max content per column (capped at 60 chars for ids
 * because Hugging Face slugs can get long). Single-space separators
 * to keep the output script-friendly.
 */
function renderTable(rows: readonly DiscoveredModel[]): string {
  const headers = ['id', 'source', 'capabilityClass', 'locality', 'baseUrl'];
  const data: readonly string[][] = rows.map((r) => [
    r.id,
    r.source,
    r.capabilityClass,
    r.locality,
    r.providerConfig?.baseUrl ?? '',
  ]);
  const all: readonly string[][] = [headers, ...data];
  const widths = headers.map((_, i) =>
    Math.min(60, Math.max(...all.map((row) => (row[i] ?? '').length))),
  );
  const lines = all.map((row) =>
    row
      .map((cell, i) => (cell ?? '').padEnd(widths[i] ?? 0, ' '))
      .join('  ')
      .trimEnd(),
  );
  return lines.join('\n');
}

export async function runModelsDiscover(
  opts: ModelsDiscoverOptions,
  io: CliIO,
  hooks: ModelsDiscoverHooks = {},
): Promise<number> {
  const discoverFn = hooks.discover ?? discover;
  const env = hooks.env ?? process.env;

  const discoverOpts: DiscoverOptions = {
    env,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };
  const found = await discoverFn(discoverOpts);

  if (found.length === 0) {
    if (opts.json === true) {
      writeJson(io, { ok: false, models: [] });
    } else {
      writeLine(
        io,
        'no local LLM servers found on default ports — start Ollama / vLLM / llama.cpp / LM Studio',
      );
      writeLine(
        io,
        'override base URLs via ALDO_LOCAL_DISCOVERY=ollama,vllm,... and the per-probe baseUrl options',
      );
    }
    return 1;
  }

  if (opts.json === true) {
    writeJson(io, {
      ok: true,
      models: found.map((m) => ({
        id: m.id,
        source: m.source,
        provider: m.provider,
        providerKind: m.providerKind,
        locality: m.locality,
        capabilityClass: m.capabilityClass,
        privacyAllowed: m.privacyAllowed,
        baseUrl: m.providerConfig?.baseUrl ?? null,
        discoveredAt: m.discoveredAt,
      })),
    });
    return 0;
  }

  writeLine(io, renderTable(found));
  writeLine(io, '');
  writeLine(io, `${found.length} model${found.length === 1 ? '' : 's'} discovered`);
  return 0;
}
