/**
 * Typed runtime configuration for the CLI.
 *
 * Responsibilities (LLM-agnostic):
 *   - load `.env` from CWD and `~/.config/aldo/env` via `@aldo-ai/runtime-config`,
 *   - discover which providers have credentials available (Groq, Ollama,
 *     Anthropic, Gemini), without taking a hard dependency on any one,
 *   - parse the `ALDO_RUN_USD_CAP` and `ALDO_DEFAULT_PRIVACY` knobs,
 *   - surface a `Config` object the bootstrap layer can read deterministically.
 *
 * Missing keys are NOT errors — they yield a `disabled` provider state. The
 * `aldo run` command may still error if the user explicitly asked for a
 * disabled provider; that error is surfaced in `commands/run.ts`, not here.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadDotenv } from '@aldo-ai/runtime-config';
import type { PrivacyTier } from '@aldo-ai/types';

/** Per-provider state derived from environment. */
export interface ProviderState {
  readonly id: 'groq' | 'ollama' | 'anthropic' | 'gemini';
  /** Whether credentials/baseUrl are present. Disabled providers stay registered as descriptors but not as adapters. */
  readonly enabled: boolean;
  /** Optional baseUrl override. Ollama is the typical case. */
  readonly baseUrl?: string;
  /** Name of the env var we resolved (for error messages). */
  readonly apiKeyEnv?: string;
}

export interface Config {
  /** Per-provider availability map. Order is deterministic. */
  readonly providers: readonly ProviderState[];
  /** Default privacy tier when a spec doesn't pin one. */
  readonly defaultPrivacy: PrivacyTier;
  /**
   * Hard ceiling in USD for any single run, applied on top of an agent's
   * own `Budget.usdMax`. `undefined` means no extra cap.
   */
  readonly runUsdCap?: number;
  /** Postgres URL if the environment has one (engineer B reads this; we just discover it). */
  readonly databaseUrl?: string;
  /**
   * MISSING_PIECES §14-A — hybrid CLI. When set, `aldo run` can delegate
   * runs that need cloud-tier capabilities to the hosted control plane
   * instead of failing locally. Both pieces are env-driven so dev
   * never accidentally ships a hosted credential.
   *   ALDO_API_URL    — base URL (defaults to https://ai.aldo.tech).
   *   ALDO_API_TOKEN  — bearer api key minted at /settings/api-keys.
   * `hostedEnabled` is `true` only when both are present.
   */
  readonly hostedApiUrl?: string;
  readonly hostedApiToken?: string;
  readonly hostedEnabled: boolean;
  /** Where we discovered values; useful for error messages. */
  readonly sources: readonly string[];
}

export interface LoadConfigOptions {
  /**
   * Override env source. Defaults to `process.env`. Tests can pass a fixed
   * record so they don't depend on the host machine.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Files to read for dotenv. Defaults to `<cwd>/.env` and
   * `~/.config/aldo/env`. Pass `[]` to skip dotenv entirely.
   */
  readonly dotenvFiles?: readonly string[];
}

const DEFAULT_DOTENV_FILES = (): string[] => [
  join(process.cwd(), '.env'),
  join(homedir(), '.config', 'aldo', 'env'),
];

const PRIVACY_TIERS = new Set<PrivacyTier>(['public', 'internal', 'sensitive']);

/**
 * Load the CLI configuration. Pure-ish: when called with `env`, no I/O is
 * performed. The default form reads dotenv files and `process.env`.
 */
export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const sources: string[] = [];
  let envOverride = opts.env;

  if (envOverride === undefined) {
    const files = opts.dotenvFiles ?? DEFAULT_DOTENV_FILES();
    if (files.length > 0) {
      const merged = loadDotenv({ files, applyToProcessEnv: true });
      if (Object.keys(merged).length > 0) sources.push(...files);
    }
    envOverride = process.env;
  }

  const env = envOverride;

  const providers: ProviderState[] = [
    providerState('groq', env, 'GROQ_API_KEY'),
    providerState('ollama', env, undefined, env.OLLAMA_BASE_URL ?? 'http://localhost:11434'),
    providerState('anthropic', env, 'ANTHROPIC_API_KEY'),
    providerState('gemini', env, 'GEMINI_API_KEY'),
  ];

  const privacyRaw = env.ALDO_DEFAULT_PRIVACY;
  const defaultPrivacy: PrivacyTier =
    privacyRaw !== undefined && PRIVACY_TIERS.has(privacyRaw as PrivacyTier)
      ? (privacyRaw as PrivacyTier)
      : 'internal';

  const capRaw = env.ALDO_RUN_USD_CAP;
  const runUsdCap = parseNumber(capRaw);

  const databaseUrl = nonEmpty(env.DATABASE_URL);

  // §14-A — hybrid mode. Both pieces must be present for the CLI to
  // consider delegating; either-only is a misconfiguration that we
  // surface explicitly when the user asks for `--hosted`.
  const hostedApiUrl = nonEmpty(env.ALDO_API_URL) ?? 'https://ai.aldo.tech';
  const hostedApiToken = nonEmpty(env.ALDO_API_TOKEN);
  const hostedEnabled = hostedApiToken !== undefined;

  return {
    providers,
    defaultPrivacy,
    ...(runUsdCap !== undefined ? { runUsdCap } : {}),
    ...(databaseUrl !== undefined ? { databaseUrl } : {}),
    hostedApiUrl,
    ...(hostedApiToken !== undefined ? { hostedApiToken } : {}),
    hostedEnabled,
    sources,
  };
}

/** Extract a single provider's state from env. */
export function providerState(
  id: ProviderState['id'],
  env: Readonly<Record<string, string | undefined>>,
  apiKeyEnv: string | undefined,
  defaultBaseUrl?: string,
): ProviderState {
  const key = apiKeyEnv !== undefined ? nonEmpty(env[apiKeyEnv]) : undefined;
  const base =
    id === 'ollama'
      ? (nonEmpty(env.OLLAMA_BASE_URL) ?? defaultBaseUrl)
      : nonEmpty(env[`${id.toUpperCase()}_BASE_URL`]);

  // Ollama is enabled whenever a base URL is reachable; it doesn't need a key.
  // Cloud providers require an API key.
  const enabled = id === 'ollama' ? base !== undefined : key !== undefined;

  return {
    id,
    enabled,
    ...(base !== undefined ? { baseUrl: base } : {}),
    ...(apiKeyEnv !== undefined ? { apiKeyEnv } : {}),
  };
}

/** Find a provider state by id. */
export function findProvider(cfg: Config, id: ProviderState['id']): ProviderState | undefined {
  return cfg.providers.find((p) => p.id === id);
}

/** Typed error: user requested a provider that isn't enabled. */
export class ProviderNotEnabledError extends Error {
  public readonly providerId: string;
  public readonly apiKeyEnv?: string;

  constructor(providerId: string, apiKeyEnv?: string) {
    const hint =
      apiKeyEnv !== undefined
        ? `${apiKeyEnv} is unset — copy .env.example to .env and fill it in`
        : 'provider unavailable — see .env.example';
    super(`provider '${providerId}' is not enabled: ${hint}`);
    this.name = 'ProviderNotEnabledError';
    this.providerId = providerId;
    if (apiKeyEnv !== undefined) this.apiKeyEnv = apiKeyEnv;
  }
}

function nonEmpty(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

function parseNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const trimmed = v.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}
