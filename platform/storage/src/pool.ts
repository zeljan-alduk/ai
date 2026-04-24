/**
 * SQL client abstraction for Meridian storage.
 *
 * The platform must run against three backends without coupling to any of
 * them at the type level:
 *   - `pg` (`node-postgres`) for self-hosted / Docker Postgres,
 *   - `@neondatabase/serverless` for Neon (HTTP-driver, edge-compatible),
 *   - `@electric-sql/pglite` for tests (in-process, no Docker).
 *
 * Rather than depend on Drizzle's per-driver constructors directly, we
 * expose a tiny `SqlClient` interface that each adapter satisfies. The
 * registry's `PostgresStorage` and the engine's `PostgresCheckpointer`
 * only ever see this interface — so swapping between Neon HTTP, classic
 * pg, and pglite is a one-line change.
 *
 * `fromDatabaseUrl(url)` picks an adapter:
 *   - URL host ends in `.neon.tech` (or `MERIDIAN_FORCE_NEON=1`)        -> Neon serverless
 *   - URL scheme is `pglite:` or path-only string                       -> pglite
 *   - else                                                              -> node-postgres
 *
 * Driver modules are imported dynamically so consumers only need the one
 * they actually use installed.
 */

export interface SqlRow {
  readonly [k: string]: unknown;
}

export interface SqlResult<R extends SqlRow = SqlRow> {
  readonly rows: readonly R[];
  readonly rowCount: number;
}

export interface SqlClient {
  /**
   * Run a single parameterised statement. Drivers are positional ($1, $2)
   * Postgres style. Returns rows + a row count. Multi-statement strings
   * are NOT guaranteed to work across drivers — split before calling, or
   * use `exec()` for migrations.
   */
  query<R extends SqlRow = SqlRow>(sql: string, params?: readonly unknown[]): Promise<SqlResult<R>>;
  /**
   * Run a raw script (one or more statements, no params). Used by the
   * migration runner. Drivers that don't support multi-statement queries
   * (Neon HTTP) should split on `;` at the boundaries, but for the seed
   * migration we ship Postgres syntax that all three handle natively.
   */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  /** Driver tag, used by tests + diagnostics. Never load-bearing for SQL. */
  readonly driver: 'pg' | 'neon' | 'pglite';
}

export interface PoolOptions {
  /**
   * Postgres connection string. Required unless `pglite` is forced via
   * a `pglite:` prefix or empty value.
   */
  readonly url?: string;
  /**
   * Override driver auto-detection. Mostly useful for tests; production
   * callers should let `fromDatabaseUrl` choose.
   */
  readonly driver?: 'pg' | 'neon' | 'pglite';
  /**
   * Optional pre-built driver instance. When supplied, no dynamic import
   * happens — handy if a host app already owns the connection.
   */
  readonly client?: unknown;
}

/**
 * Choose the right driver for a DATABASE_URL.
 *
 * The URL is the single config knob — agents and ops never poke driver
 * names directly. This keeps `DATABASE_URL=...` as the platform-wide
 * convention (matches `.env.example`).
 */
export async function fromDatabaseUrl(opts: PoolOptions = {}): Promise<SqlClient> {
  const url = opts.url ?? process.env.DATABASE_URL ?? '';
  const driver = opts.driver ?? detectDriver(url);

  switch (driver) {
    case 'pglite':
      return createPgliteClient(url, opts.client);
    case 'neon':
      return createNeonClient(url, opts.client);
    case 'pg':
      return createPgClient(url, opts.client);
    default:
      throw new Error(`unknown driver: ${driver as string}`);
  }
}

export function detectDriver(url: string): 'pg' | 'neon' | 'pglite' {
  if (process.env.MERIDIAN_FORCE_NEON === '1') return 'neon';
  if (url === '' || url.startsWith('pglite:') || url.startsWith('memory://')) {
    return 'pglite';
  }
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('.neon.tech') || u.hostname.endsWith('.neon.build')) {
      return 'neon';
    }
  } catch {
    // not a URL we can parse; assume classic pg connection string.
  }
  return 'pg';
}

// --- node-postgres ---------------------------------------------------------

async function createPgClient(url: string, prebuilt: unknown): Promise<SqlClient> {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic driver typing
  let pool: any;
  if (prebuilt !== undefined) {
    pool = prebuilt;
  } else {
    const mod = (await import('pg')) as unknown as {
      default?: { Pool: new (cfg: { connectionString: string }) => unknown };
      Pool?: new (cfg: { connectionString: string }) => unknown;
    };
    const Pool = mod.Pool ?? mod.default?.Pool;
    if (!Pool) throw new Error('pg.Pool not found — is `pg` installed?');
    pool = new Pool({ connectionString: url });
  }
  return {
    driver: 'pg',
    async query<R extends SqlRow>(sql: string, params: readonly unknown[] = []) {
      const res = await pool.query(sql, params as unknown[]);
      return { rows: res.rows as readonly R[], rowCount: res.rowCount ?? res.rows.length };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

// --- Neon serverless (HTTP) -----------------------------------------------

async function createNeonClient(url: string, prebuilt: unknown): Promise<SqlClient> {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic driver typing
  let sql: any;
  if (prebuilt !== undefined) {
    sql = prebuilt;
  } else {
    const mod = (await import('@neondatabase/serverless').catch(() => {
      throw new Error(
        '@neondatabase/serverless is not installed; install it as a peer to use Neon URLs',
      );
    })) as unknown as { neon: (s: string) => unknown };
    sql = mod.neon(url);
  }
  return {
    driver: 'neon',
    async query<R extends SqlRow>(text: string, params: readonly unknown[] = []) {
      // Neon's tagged-template `sql` can also be called as `sql(query, params, opts)`.
      const rows = (await sql(text, params as unknown[], {
        arrayMode: false,
        fullResults: false,
      })) as readonly R[];
      return { rows, rowCount: rows.length };
    },
    async exec(text: string) {
      // Neon HTTP doesn't support multi-statement, so split on bare semicolons.
      for (const stmt of splitSqlScript(text)) {
        await sql(stmt, [], { arrayMode: false, fullResults: false });
      }
    },
    async close() {
      // HTTP driver — nothing to close.
    },
  };
}

// --- pglite (in-process) --------------------------------------------------

async function createPgliteClient(url: string, prebuilt: unknown): Promise<SqlClient> {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic driver typing
  let db: any;
  if (prebuilt !== undefined) {
    db = prebuilt;
  } else {
    const mod = (await import('@electric-sql/pglite').catch(() => {
      throw new Error(
        '@electric-sql/pglite is not installed; install it as a dev dependency to use pglite',
      );
    })) as unknown as { PGlite: new (path?: string) => unknown };
    const PGlite = mod.PGlite;
    const dataDir =
      url === '' || url === 'pglite:' || url === 'memory://' ? undefined : url.replace(/^pglite:/, '');
    db = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  }
  return {
    driver: 'pglite',
    async query<R extends SqlRow>(sql: string, params: readonly unknown[] = []) {
      const res = (await db.query(sql, params as unknown[])) as {
        rows: readonly R[];
        affectedRows?: number;
      };
      return { rows: res.rows, rowCount: res.rows.length || res.affectedRows || 0 };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async close() {
      await db.close();
    },
  };
}

/**
 * Split a Postgres script on top-level semicolons. Naive but enough for
 * our hand-written migrations: no dollar-quoted bodies, no procedures,
 * no string literals containing `;` outside a quote.
 */
export function splitSqlScript(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i] ?? '';
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === ';' && !inSingle && !inDouble) {
      const trimmed = buf.trim();
      if (trimmed.length > 0) out.push(trimmed);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}
