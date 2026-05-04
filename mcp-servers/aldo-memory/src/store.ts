/**
 * Filesystem-backed store for aldo-memory.
 *
 * Layout (rooted at `policy.root`):
 *
 *   <root>/<tenant>/<scope>/<agentName?>/<runId?>/<encoded-key>.json
 *
 * - `private`:  <root>/<tenant>/private/<agentName>/<encoded-key>.json
 * - `project`:  <root>/<tenant>/project/<encoded-key>.json
 * - `org`:      <root>/<tenant>/org/<encoded-key>.json
 * - `session`:  <root>/<tenant>/session/<runId>/<encoded-key>.json
 *
 * Keys are URL-encoded so colons, dots, and other delimiters used by
 * the engine's namespacing convention land cleanly on disk.
 *
 * Each entry on disk:
 *   { "scope", "key", "value", "at", "ttl"? }
 *
 * Atomicity: write-then-rename so a partial write never leaves a
 * half-readable file. Concurrent writers can clobber each other (last
 * write wins); we don't lock — the dry-run is single-process.
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type MemoryPolicy,
  type MemoryScope,
  MemoryError,
  type ResolvedScope,
  assertKey,
} from './policy.js';

export interface MemoryEntry {
  readonly scope: MemoryScope;
  readonly key: string;
  readonly value: unknown;
  readonly at: string;
  readonly ttl?: string;
}

export interface ScopedRef {
  readonly tenant: string;
  readonly resolved: ResolvedScope;
}

function scopeDir(policy: MemoryPolicy, ref: ScopedRef): string {
  const { tenant, resolved } = ref;
  const segments: string[] = [policy.root, tenant, resolved.scope];
  if (resolved.scope === 'private' && resolved.agentName) segments.push(resolved.agentName);
  if (resolved.scope === 'session' && resolved.runId) segments.push(resolved.runId);
  return join(...segments);
}

function entryPath(policy: MemoryPolicy, ref: ScopedRef, key: string): string {
  return join(scopeDir(policy, ref), `${encodeURIComponent(key)}.json`);
}

export async function readEntry(
  policy: MemoryPolicy,
  ref: ScopedRef,
  key: string,
): Promise<MemoryEntry | null> {
  assertKey(policy, key);
  const path = entryPath(policy, ref, key);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as MemoryEntry;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new MemoryError('INTERNAL', `read failed for ${path}: ${(err as Error).message}`, err);
  }
}

export async function writeEntry(
  policy: MemoryPolicy,
  ref: ScopedRef,
  entry: MemoryEntry,
): Promise<void> {
  assertKey(policy, entry.key);
  const dir = scopeDir(policy, ref);
  await mkdir(dir, { recursive: true });
  const finalPath = entryPath(policy, ref, entry.key);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  const body = JSON.stringify(entry);
  if (Buffer.byteLength(body, 'utf8') > policy.maxValueBytes) {
    throw new MemoryError(
      'INVALID_INPUT',
      `serialised entry exceeds ${policy.maxValueBytes} bytes (got ${Buffer.byteLength(body, 'utf8')})`,
    );
  }
  try {
    await writeFile(tmpPath, body, 'utf8');
    await rename(tmpPath, finalPath);
  } catch (err) {
    // best-effort cleanup; rename can leave the tmpfile if it failed
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw new MemoryError('INTERNAL', `write failed for ${finalPath}: ${(err as Error).message}`, err);
  }
}

export async function deleteEntry(
  policy: MemoryPolicy,
  ref: ScopedRef,
  key: string,
): Promise<boolean> {
  assertKey(policy, key);
  const path = entryPath(policy, ref, key);
  try {
    await rm(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new MemoryError('INTERNAL', `delete failed for ${path}: ${(err as Error).message}`, err);
  }
}

export async function scanEntries(
  policy: MemoryPolicy,
  ref: ScopedRef,
  prefix: string,
  limit: number,
): Promise<MemoryEntry[]> {
  const dir = scopeDir(policy, ref);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new MemoryError('INTERNAL', `scan failed for ${dir}: ${(err as Error).message}`, err);
  }
  const out: MemoryEntry[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const decoded = decodeURIComponent(file.slice(0, -'.json'.length));
    if (prefix && !decoded.startsWith(prefix)) continue;
    try {
      const raw = await readFile(join(dir, file), 'utf8');
      out.push(JSON.parse(raw) as MemoryEntry);
      if (out.length >= limit) break;
    } catch {
      // skip unreadable entry; don't fail the whole scan
    }
  }
  // sort newest-first by `at` so the model sees the freshest writes
  out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  return out;
}

/**
 * For tests: stat the scope directory, returning entry count or 0 if
 * missing.
 */
export async function countScope(
  policy: MemoryPolicy,
  ref: ScopedRef,
): Promise<number> {
  const dir = scopeDir(policy, ref);
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) return 0;
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}
