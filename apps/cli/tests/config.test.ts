/**
 * Unit tests for `src/config.ts`. Pure: never reads real env, never hits
 * the network. We pass an explicit `env` record to `loadConfig` so the
 * tests are deterministic.
 */

import { describe, expect, it } from 'vitest';
import { ProviderNotEnabledError, findProvider, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('returns disabled providers when no keys are set (no error)', () => {
    const cfg = loadConfig({ env: {}, dotenvFiles: [] });
    expect(cfg.providers.find((p) => p.id === 'groq')?.enabled).toBe(false);
    expect(cfg.providers.find((p) => p.id === 'anthropic')?.enabled).toBe(false);
    expect(cfg.providers.find((p) => p.id === 'gemini')?.enabled).toBe(false);
    // Ollama defaults to localhost so it is "enabled" even with no env.
    expect(cfg.providers.find((p) => p.id === 'ollama')?.enabled).toBe(true);
    expect(cfg.defaultPrivacy).toBe('internal');
    expect(cfg.runUsdCap).toBeUndefined();
  });

  it('enables groq when GROQ_API_KEY is set', () => {
    const cfg = loadConfig({ env: { GROQ_API_KEY: 'gsk_test' }, dotenvFiles: [] });
    const groq = cfg.providers.find((p) => p.id === 'groq');
    expect(groq?.enabled).toBe(true);
    expect(groq?.apiKeyEnv).toBe('GROQ_API_KEY');
  });

  it('treats whitespace-only keys as missing', () => {
    const cfg = loadConfig({ env: { ANTHROPIC_API_KEY: '   ' }, dotenvFiles: [] });
    expect(cfg.providers.find((p) => p.id === 'anthropic')?.enabled).toBe(false);
  });

  it('honours OLLAMA_BASE_URL override and exposes it on state', () => {
    const cfg = loadConfig({
      env: { OLLAMA_BASE_URL: 'http://gpu-host:11434' },
      dotenvFiles: [],
    });
    const ollama = cfg.providers.find((p) => p.id === 'ollama');
    expect(ollama?.enabled).toBe(true);
    expect(ollama?.baseUrl).toBe('http://gpu-host:11434');
  });

  it('parses MERIDIAN_RUN_USD_CAP as a number', () => {
    const cfg = loadConfig({
      env: { MERIDIAN_RUN_USD_CAP: '0.25' },
      dotenvFiles: [],
    });
    expect(cfg.runUsdCap).toBe(0.25);
  });

  it('drops MERIDIAN_RUN_USD_CAP when not numeric', () => {
    const cfg = loadConfig({
      env: { MERIDIAN_RUN_USD_CAP: 'two-bucks' },
      dotenvFiles: [],
    });
    expect(cfg.runUsdCap).toBeUndefined();
  });

  it('honours MERIDIAN_DEFAULT_PRIVACY when valid; falls back otherwise', () => {
    expect(
      loadConfig({ env: { MERIDIAN_DEFAULT_PRIVACY: 'sensitive' }, dotenvFiles: [] })
        .defaultPrivacy,
    ).toBe('sensitive');
    expect(
      loadConfig({ env: { MERIDIAN_DEFAULT_PRIVACY: 'lol' }, dotenvFiles: [] }).defaultPrivacy,
    ).toBe('internal');
  });

  it('exposes DATABASE_URL when present', () => {
    const cfg = loadConfig({
      env: { DATABASE_URL: 'postgres://x/y' },
      dotenvFiles: [],
    });
    expect(cfg.databaseUrl).toBe('postgres://x/y');
  });

  it('findProvider returns by id', () => {
    const cfg = loadConfig({ env: { GROQ_API_KEY: 'k' }, dotenvFiles: [] });
    expect(findProvider(cfg, 'groq')?.enabled).toBe(true);
    expect(findProvider(cfg, 'anthropic')?.enabled).toBe(false);
  });

  it('ProviderNotEnabledError mentions the env-var name', () => {
    const e = new ProviderNotEnabledError('groq', 'GROQ_API_KEY');
    expect(e.message).toContain('GROQ_API_KEY');
    expect(e.message).toContain('.env.example');
    expect(e.providerId).toBe('groq');
  });
});
