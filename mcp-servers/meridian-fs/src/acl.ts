/**
 * meridian-fs — ACL.
 *
 * The ACL pins each tool call to one of a set of pre-declared filesystem
 * roots. Every path the tools touch (the user-supplied path, every
 * intermediate dir, every symlink target) is normalised, real-pathed,
 * and re-checked to be inside an allowed root before any I/O happens.
 *
 * Modes:
 *   - 'ro'  — read/list/stat/search only.
 *   - 'rw'  — also write.
 *
 * Codes returned via FsError:
 *   - PERMISSION_DENIED — write to ro root, no roots configured, etc.
 *   - OUT_OF_BOUNDS     — path normalises outside any root, or a symlink
 *                         points outside any root.
 *   - NOT_FOUND         — caller-supplied path doesn't exist (raised by
 *                         the tools, not the ACL itself).
 *   - TOO_LARGE         — read/search hit a configured cap.
 *   - INTERNAL          — anything else (wrap with cause).
 */

import { stat as fsStat, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

export type AclMode = 'ro' | 'rw';

export interface Root {
  /** Absolute, normalised path. */
  readonly path: string;
  readonly mode: AclMode;
}

export interface Acl {
  readonly roots: readonly Root[];
  /**
   * Resolve a (possibly relative) caller path against the configured roots.
   * Returns the absolute, sep-trailed resolved path plus the matching root.
   *
   * If `requireWrite` is true, the matching root must be 'rw'.
   *
   * Throws FsError with code OUT_OF_BOUNDS / PERMISSION_DENIED on violation.
   *
   * NOTE: this function only checks lexical containment + write mode. It
   * does NOT resolve symlinks. Tools that read or write must additionally
   * call `assertRealpathInside` after the file is known to exist (or after
   * its parent directory is real-pathed for writes to new files).
   */
  resolveInside(callerPath: string, requireWrite?: boolean): { abs: string; root: Root };
}

export type FsErrorCode =
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'OUT_OF_BOUNDS'
  | 'TOO_LARGE'
  | 'INTERNAL';

export class FsError extends Error {
  readonly code: FsErrorCode;
  override readonly cause?: unknown;
  constructor(code: FsErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'FsError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
  toJSON(): { code: FsErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

/**
 * Returns true iff `child` is `parent` or a descendant of `parent` in the
 * lexical sense, after normalisation. Both arguments must be absolute.
 *
 * We append `sep` to `parent` so '/a/bc' is NOT a child of '/a/b'.
 */
export function isInside(parent: string, child: string): boolean {
  if (!isAbsolute(parent) || !isAbsolute(child)) return false;
  const p = parent.endsWith(sep) ? parent : parent + sep;
  const c = child.endsWith(sep) ? child : child + sep;
  return c === p || c.startsWith(p);
}

/**
 * Pure-lexical check: does `abs` (already absolute + normalised) lie inside
 * any configured root? Returns the matching root or null.
 */
export function findContainingRoot(roots: readonly Root[], abs: string): Root | null {
  for (const r of roots) {
    if (isInside(r.path, abs)) return r;
  }
  return null;
}

/**
 * Build an ACL from a list of roots. Each root path is resolved to absolute.
 * Duplicate roots collapse to the most permissive mode; nested roots are
 * permitted (the deepest match wins for resolveInside).
 */
export function createAcl(roots: readonly Root[]): Acl {
  if (roots.length === 0) {
    throw new FsError('PERMISSION_DENIED', 'meridian-fs: no roots configured');
  }
  const normalised: Root[] = roots.map((r) => ({ path: resolve(r.path), mode: r.mode }));

  // Collapse exact-duplicate paths, preferring 'rw' over 'ro'.
  const byPath = new Map<string, Root>();
  for (const r of normalised) {
    const prev = byPath.get(r.path);
    if (!prev) byPath.set(r.path, r);
    else if (prev.mode === 'ro' && r.mode === 'rw') byPath.set(r.path, r);
  }
  // Deepest first so resolveInside picks the most-specific match.
  const sorted = [...byPath.values()].sort((a, b) => b.path.length - a.path.length);

  return {
    roots: sorted,
    resolveInside(callerPath, requireWrite = false) {
      if (typeof callerPath !== 'string' || callerPath.length === 0) {
        throw new FsError('OUT_OF_BOUNDS', 'path must be a non-empty string');
      }
      // If absolute, normalise; else resolve against the *first* root.
      // Callers wanting per-root relative paths should pass absolute paths
      // or rely on the first-root convention documented in the README.
      const last = sorted[sorted.length - 1];
      if (!last) {
        throw new FsError('PERMISSION_DENIED', 'meridian-fs: no roots configured');
      }
      const abs = isAbsolute(callerPath) ? resolve(callerPath) : resolve(last.path, callerPath);
      const root = findContainingRoot(sorted, abs);
      if (!root) {
        throw new FsError('OUT_OF_BOUNDS', `path "${callerPath}" is outside all configured roots`);
      }
      if (requireWrite && root.mode !== 'rw') {
        throw new FsError('PERMISSION_DENIED', `root "${root.path}" is read-only`);
      }
      return { abs, root };
    },
  };
}

/**
 * Resolve symlinks via realpath and assert the result is still inside the
 * matching root (or any configured root, in case the caller is fine with
 * cross-root traversal — currently we require the *same* root).
 *
 * If `mustExist` is false (e.g. fs.write to a new file), we realpath the
 * deepest existing ancestor instead and verify *it* is inside the root.
 */
export async function assertRealpathInside(
  acl: Acl,
  abs: string,
  opts: { mustExist?: boolean; rootHint?: Root } = {},
): Promise<{ real: string; root: Root }> {
  const { mustExist = true, rootHint } = opts;
  let real: string;
  try {
    real = await realpath(abs);
  } catch (err) {
    if (mustExist) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new FsError('NOT_FOUND', `no such path: ${abs}`);
      throw new FsError('INTERNAL', `realpath failed: ${(err as Error).message}`, err);
    }
    real = await realpathDeepestAncestor(abs);
  }
  const root = findContainingRoot(acl.roots, real);
  if (!root) {
    throw new FsError(
      'OUT_OF_BOUNDS',
      `resolved path "${real}" escapes all configured roots (symlink?)`,
    );
  }
  if (rootHint && root.path !== rootHint.path) {
    // The realpath landed in a *different* configured root than the
    // lexical resolution — typically a symlink jumping between roots.
    // We refuse this rather than silently allow it: if you wanted that,
    // address the target root directly.
    if (!isInside(rootHint.path, real)) {
      throw new FsError(
        'OUT_OF_BOUNDS',
        `path "${abs}" resolves out of its declared root "${rootHint.path}" (via symlink?)`,
      );
    }
  }
  return { real, root };
}

/**
 * Walk up from `abs` until we find an existing ancestor, then realpath it.
 * Used for fs.write to a path whose final component doesn't yet exist.
 */
async function realpathDeepestAncestor(abs: string): Promise<string> {
  let cur = abs;
  while (cur && cur !== '/' && cur !== '.') {
    const parent = resolve(cur, '..');
    if (parent === cur) break;
    try {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential walk
      const real = await realpath(parent);
      return real;
    } catch {
      cur = parent;
    }
  }
  throw new FsError('NOT_FOUND', `no existing ancestor for ${abs}`);
}

/**
 * Refuse if any symlink exists *along the path* that points outside the
 * configured roots. This catches the case where /allowed/inner is a symlink
 * to /etc — realpath would catch it for the final node, but we want to
 * catch intermediate components too.
 *
 * Cheap implementation: lstat each component; if it's a symlink, resolve
 * its target and verify it's inside *some* configured root.
 */
export async function assertNoEscapingSymlinkOnPath(acl: Acl, abs: string): Promise<void> {
  const parts = abs.split(sep).filter((p) => p.length > 0);
  let cur = abs.startsWith(sep) ? sep : '';
  for (const part of parts) {
    cur = cur === sep ? sep + part : cur + sep + part;
    let st: Awaited<ReturnType<typeof lstat>>;
    try {
      // eslint-disable-next-line no-await-in-loop
      st = await lstat(cur);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return; // doesn't exist yet; nothing to verify here
      throw new FsError('INTERNAL', `lstat ${cur} failed: ${(err as Error).message}`, err);
    }
    if (st.isSymbolicLink()) {
      // eslint-disable-next-line no-await-in-loop
      const target = await realpath(cur);
      if (!findContainingRoot(acl.roots, target)) {
        throw new FsError(
          'OUT_OF_BOUNDS',
          `symlink at "${cur}" points outside configured roots (target: ${target})`,
        );
      }
    }
  }
}

/** Convenience: full "is this path safe to read" check. */
export async function checkRead(
  acl: Acl,
  callerPath: string,
): Promise<{ abs: string; real: string; root: Root }> {
  const { abs, root } = acl.resolveInside(callerPath, false);
  await assertNoEscapingSymlinkOnPath(acl, abs);
  const { real } = await assertRealpathInside(acl, abs, { mustExist: true, rootHint: root });
  return { abs, real, root };
}

/** Convenience: full "is this path safe to write" check (target may not exist). */
export async function checkWrite(
  acl: Acl,
  callerPath: string,
): Promise<{ abs: string; real: string; root: Root }> {
  const { abs, root } = acl.resolveInside(callerPath, true);
  await assertNoEscapingSymlinkOnPath(acl, abs);
  // Realpath the deepest existing ancestor; verify it's still inside the root.
  let real: string;
  try {
    real = await realpath(abs);
    // Existing target — also confirm it's not a symlink jumping out.
    const ls = await lstat(abs);
    if (ls.isSymbolicLink()) {
      // realpath already verified it lands somewhere; require it's still in root.
      if (!isInside(root.path, real)) {
        throw new FsError('OUT_OF_BOUNDS', `write target "${abs}" is a symlink leaving its root`);
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
    real = await realpathDeepestAncestor(abs);
    if (!isInside(root.path, real)) {
      throw new FsError(
        'OUT_OF_BOUNDS',
        `write target's parent "${real}" is outside root "${root.path}"`,
      );
    }
  }
  return { abs, real, root };
}

// Re-export for tests.
export { fsStat as _fsStat };
