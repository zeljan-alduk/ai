/**
 * Config resolution for the aldo-platform MCP server.
 *
 * Priority (first match wins):
 *   1. CLI args  (`--base-url=...`, `--api-key=...`)
 *   2. Env vars  (`ALDO_BASE_URL`, `ALDO_API_KEY`)
 *   3. Defaults  (base URL = https://ai.aldo.tech; api key required, no default)
 *
 * The api key is the same kind issued by `/settings/api-keys` in the
 * web app (`aldo_live_...`). The MCP server runs in the user's local
 * environment and forwards every request with `Authorization: Bearer
 * <key>` — same auth contract as a CLI call.
 */

export interface ResolvedConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
}

export class ConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ConfigError';
  }
}

const DEFAULT_BASE_URL = 'https://ai.aldo.tech';

interface ResolveArgs {
  readonly argv?: ReadonlyArray<string>;
  readonly env?: NodeJS.ProcessEnv;
}

export function resolveConfig(args: ResolveArgs = {}): ResolvedConfig {
  const argv = args.argv ?? process.argv.slice(2);
  const env = args.env ?? process.env;

  const baseUrl = pickArg(argv, '--base-url') ?? env.ALDO_BASE_URL ?? DEFAULT_BASE_URL;
  const apiKey = pickArg(argv, '--api-key') ?? env.ALDO_API_KEY;

  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new ConfigError(
      'missing_api_key',
      'aldo-mcp-platform requires an API key. Set ALDO_API_KEY or pass --api-key=<key>. ' +
        'Generate one at https://ai.aldo.tech/settings/api-keys.',
    );
  }

  // Normalise: strip trailing slash. URL parsing also catches typos.
  let normalisedUrl: string;
  try {
    const u = new URL(baseUrl);
    normalisedUrl = u.toString().replace(/\/$/, '');
  } catch {
    throw new ConfigError(
      'invalid_base_url',
      `aldo-mcp-platform: --base-url is not a valid URL: ${JSON.stringify(baseUrl)}`,
    );
  }

  return { baseUrl: normalisedUrl, apiKey };
}

function pickArg(argv: ReadonlyArray<string>, flag: string): string | undefined {
  // `--flag=value` and `--flag value` are both supported.
  const eq = `${flag}=`;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a.startsWith(eq)) return a.slice(eq.length);
    if (a === flag) {
      const next = argv[i + 1];
      if (typeof next === 'string') return next;
    }
  }
  return undefined;
}
