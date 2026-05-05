/**
 * Per-process shell session state.
 *
 * The aldo-shell MCP server runs as a stdio child process spawned by
 * the engine's tool host. The process lifetime IS the session, so a
 * single in-module map suffices — no keying on session id, no
 * cleanup, no race against parallel sessions.
 *
 * State carried:
 *   - `cwd` — current working directory. `shell.cd <path>` mutates;
 *     `shell.exec` falls back to this when its `cwd` arg is unset.
 *     Defaults to `null` (caller must supply cwd or be inside an
 *     allowedRoots entry).
 *   - `env`  — extra env vars to merge onto the host env on every
 *     `shell.exec`. `shell.export KEY=VAL` adds; `shell.unset KEY`
 *     removes; persists for the rest of the session.
 *
 * Both are intentionally small surfaces. We don't reimplement bash
 * — `cd ../foo` works, but `cd $(some_command)` doesn't (the model
 * runs the command separately and uses the resolved path).
 */

import { isAbsolute, resolve as resolvePath } from 'node:path';

export interface ShellSessionState {
  cwd: string | null;
  env: Record<string, string>;
}

export function createShellSessionState(): ShellSessionState {
  return { cwd: null, env: {} };
}

/**
 * Mutate the session's cwd. Pure-ish (the state arg is mutated in
 * place; callers thread it through `createAldoShellServer`).
 *
 * Relative paths resolve against the current cwd (or process.cwd()
 * if the session has none yet). Absolute paths are used as-is. The
 * policy's allowedRoots check still fires on subsequent
 * `shell.exec` calls — `shell.cd` is allowed to "land outside" but
 * exec will refuse to spawn there.
 */
export function applyShellCd(state: ShellSessionState, target: string): string {
  const base = state.cwd ?? process.cwd();
  const next = isAbsolute(target) ? target : resolvePath(base, target);
  state.cwd = next;
  return next;
}

/** Apply `shell.export` / `shell.unset` on the session env. */
export function applyShellExport(
  state: ShellSessionState,
  pairs: Readonly<Record<string, string>>,
): void {
  for (const [k, v] of Object.entries(pairs)) {
    state.env[k] = v;
  }
}

export function applyShellUnset(state: ShellSessionState, keys: readonly string[]): void {
  for (const k of keys) {
    delete state.env[k];
  }
}
