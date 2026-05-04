/**
 * MISSING_PIECES §11 / Phase E — `aldo code` session persistence.
 *
 * v0 stores the conversation Entry list as a JSON sidecar under
 * `$ALDO_CODE_HOME` (default `~/.aldo/code-sessions`), keyed by a
 * threadId. The threadId is also linked to the engine's
 * runs.thread_id column when a PostgresRunStore is wired so /runs/<id>
 * still groups turns under the same thread for replay.
 *
 * Sidecar shape (versioned for forward-compat):
 *
 *   {
 *     "version": 1,
 *     "threadId": "<uuid>",
 *     "createdAt": "<iso>",
 *     "updatedAt": "<iso>",
 *     "workspace": "<absolute path>",
 *     "entries": [...]
 *   }
 *
 * Why a sidecar (and not just the runs DB):
 *   1. The runs DB stores ENGINE events; the chat UI's history is
 *      a higher-level shape (Entry list with the chronological "user
 *      → tool → assistant text" rule baked in by the reducer). Re-
 *      deriving the Entry list from raw RunEvents would require
 *      re-running the reducer over the persisted event log on every
 *      `--resume`. The sidecar is the cached projection.
 *   2. The CLI works without a DB. A user without DATABASE_URL still
 *      gets resume across sessions — the sidecar is purely local.
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import type { Entry } from './state.js';

export interface SessionRecord {
  readonly version: 1;
  readonly threadId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workspace: string;
  readonly entries: readonly Entry[];
}

export interface PersistenceOptions {
  /** Override the sessions root directory (used by tests). */
  readonly sessionsDir?: string;
}

export class SessionNotFoundError extends Error {
  readonly code = 'session_not_found' as const;
  constructor(readonly threadId: string) {
    super(`no saved session for threadId=${threadId}`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionCorruptError extends Error {
  readonly code = 'session_corrupt' as const;
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`session sidecar at ${path} is unreadable: ${reason}`);
    this.name = 'SessionCorruptError';
  }
}

/** Resolve the path where a session's sidecar JSON is stored. */
export function sessionPath(threadId: string, opts: PersistenceOptions = {}): string {
  const root = opts.sessionsDir ?? defaultSessionsDir();
  return join(root, `${sanitiseThreadId(threadId)}.json`);
}

/** Generate a fresh threadId (UUID v4). */
export function newThreadId(): string {
  return randomUUID();
}

/** Save / overwrite the session sidecar atomically. Pure-ish (writes one file). */
export function saveSession(
  args: {
    readonly threadId: string;
    readonly workspace: string;
    readonly entries: readonly Entry[];
    readonly createdAt?: string;
  },
  opts: PersistenceOptions = {},
): string {
  const root = opts.sessionsDir ?? defaultSessionsDir();
  mkdirSync(root, { recursive: true });
  const path = sessionPath(args.threadId, opts);
  const now = new Date().toISOString();
  const record: SessionRecord = {
    version: 1,
    threadId: args.threadId,
    createdAt: args.createdAt ?? readCreatedAt(path) ?? now,
    updatedAt: now,
    workspace: resolvePath(args.workspace),
    entries: args.entries,
  };
  // Write to a temp file then rename so a crash mid-write can't
  // corrupt a previously-saved session.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  // Use rename via writeFileSync's atomic-on-POSIX semantics: write
  // tmp + rename atomically. Node's fs has no `rename` exported on
  // the sync surface besides node:fs.renameSync; import on demand.
  // Defer to the standard rename.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { renameSync } = require('node:fs') as typeof import('node:fs');
  renameSync(tmp, path);
  return path;
}

/** Load a session sidecar by threadId. Throws when missing or corrupt. */
export function loadSession(threadId: string, opts: PersistenceOptions = {}): SessionRecord {
  const path = sessionPath(threadId, opts);
  if (!existsSync(path)) throw new SessionNotFoundError(threadId);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new SessionCorruptError(path, e instanceof Error ? e.message : String(e));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new SessionCorruptError(path, `invalid JSON: ${e instanceof Error ? e.message : e}`);
  }
  if (!isSessionRecord(parsed)) {
    throw new SessionCorruptError(path, 'shape does not match SessionRecord');
  }
  return parsed;
}

export interface SessionSummary {
  readonly threadId: string;
  readonly workspace: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turns: number;
}

/** List every saved session, newest-first by `updatedAt`. */
export function listSessions(opts: PersistenceOptions = {}): readonly SessionSummary[] {
  const root = opts.sessionsDir ?? defaultSessionsDir();
  if (!existsSync(root)) return [];
  const out: SessionSummary[] = [];
  for (const name of readdirSync(root)) {
    if (!name.endsWith('.json')) continue;
    const path = join(root, name);
    try {
      const text = readFileSync(path, 'utf8');
      const rec = JSON.parse(text) as unknown;
      if (!isSessionRecord(rec)) continue;
      out.push({
        threadId: rec.threadId,
        workspace: rec.workspace,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        turns: rec.entries.filter((e) => e.kind === 'user').length,
      });
    } catch {
      // Skip corrupt files; an explicit `aldo code --resume <id>` will surface the error.
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

// ─── helpers ──────────────────────────────────────────────────────

function defaultSessionsDir(): string {
  const env = process.env.ALDO_CODE_HOME;
  if (env !== undefined && env.length > 0) return env;
  return join(homedir(), '.aldo', 'code-sessions');
}

function sanitiseThreadId(threadId: string): string {
  // Confine to filename-safe chars so a hostile `--resume "../etc"`
  // can't escape the sessions dir. UUIDs and hex strings pass through;
  // anything weirder falls to a hash-ish substring.
  const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  if (safe.length === 0) throw new Error('threadId must contain at least one safe character');
  return safe;
}

function readCreatedAt(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const stat = statSync(path);
    return stat.birthtime.toISOString();
  } catch {
    return null;
  }
}

function isSessionRecord(v: unknown): v is SessionRecord {
  if (v === null || typeof v !== 'object') return false;
  const r = v as Partial<SessionRecord> & Record<string, unknown>;
  return (
    r.version === 1 &&
    typeof r.threadId === 'string' &&
    typeof r.createdAt === 'string' &&
    typeof r.updatedAt === 'string' &&
    typeof r.workspace === 'string' &&
    Array.isArray(r.entries)
  );
}
