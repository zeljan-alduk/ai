/**
 * Lifecycle hooks — pre/post-run + pre/post-tool shell scripts.
 *
 * Mirrors Claude Code's settings.json hooks. The user drops a
 * `hooks.json` at one of two paths:
 *
 *   ~/.aldo/hooks.json      — user-global
 *   <workspace>/.aldo/hooks.json   — project-local (wins on conflict)
 *
 * Shape:
 *   {
 *     "preRun":  ["echo starting run $ALDO_RUN_ID"],
 *     "postRun": ["pnpm test"],
 *     "preTool":  { "fs.write": ["echo will write $ALDO_TOOL_ARGS_JSON"] },
 *     "postTool": { "shell.exec": ["echo ran $ALDO_TOOL_ARGS_JSON"] }
 *   }
 *
 * Each entry is one shell command. We run via `spawnSync('sh', ['-c', cmd])`
 * with the env carrying:
 *   - ALDO_RUN_ID         — engine run id when known
 *   - ALDO_TOOL_NAME      — tool name (preTool/postTool only)
 *   - ALDO_TOOL_ARGS_JSON — JSON-encoded tool args
 *   - ALDO_TOOL_RESULT_JSON — JSON-encoded result (postTool only)
 *   - ALDO_WORKSPACE      — workspace root
 *
 * Failures are LOGGED but NEVER propagate — a flaky hook must not
 * tear down the agent. Matches Claude Code's "best-effort" semantics.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface HooksConfig {
  readonly preRun?: readonly string[];
  readonly postRun?: readonly string[];
  readonly preTool?: Readonly<Record<string, readonly string[]>>;
  readonly postTool?: Readonly<Record<string, readonly string[]>>;
}

export interface HooksRuntime {
  readonly fire: (
    phase: 'preRun' | 'postRun',
    ctx: { readonly runId?: string; readonly workspace: string },
  ) => void;
  readonly fireTool: (
    phase: 'preTool' | 'postTool',
    ctx: {
      readonly toolName: string;
      readonly args: unknown;
      readonly result?: unknown;
      readonly runId?: string;
      readonly workspace: string;
    },
  ) => void;
}

/**
 * Load + merge hooks from ~/.aldo/hooks.json (global) and
 * <workspace>/.aldo/hooks.json (project). Project entries WIN on
 * conflict — both arrays are appended, but a project entry for a
 * given tool replaces the global entry to avoid double-firing.
 *
 * Missing files are not errors; we return an empty config.
 */
export function loadHooks(workspaceRoot: string): HooksConfig {
  const globalPath = join(homedir(), '.aldo', 'hooks.json');
  const localPath = join(workspaceRoot, '.aldo', 'hooks.json');
  const globalCfg = readJsonOrEmpty(globalPath);
  const localCfg = readJsonOrEmpty(localPath);
  return mergeHooks(globalCfg, localCfg);
}

/**
 * Build a HooksRuntime that fires the configured shell commands at
 * the right lifecycle points. Wired into the TUI's runTurn /
 * tool-host. Logs to the supplied `log` callback (stderr in v0).
 */
export function createHooksRuntime(
  cfg: HooksConfig,
  log: (line: string) => void,
): HooksRuntime {
  const fireMany = (commands: readonly string[], env: Record<string, string>): void => {
    for (const cmd of commands) {
      const res = spawnSync('sh', ['-c', cmd], {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      });
      if (res.error !== undefined) {
        log(`[hook] ${cmd} — error: ${res.error.message}`);
        continue;
      }
      if (res.status !== 0) {
        const tail = (res.stderr?.toString() ?? '').trim().slice(0, 200);
        log(`[hook] ${cmd} — exit ${res.status}${tail.length > 0 ? `\n${tail}` : ''}`);
      } else {
        const out = (res.stdout?.toString() ?? '').trim();
        if (out.length > 0) log(`[hook] ${cmd}\n${out.slice(0, 500)}`);
      }
    }
  };

  return {
    fire(phase, ctx) {
      const cmds = phase === 'preRun' ? cfg.preRun : cfg.postRun;
      if (cmds === undefined || cmds.length === 0) return;
      fireMany(cmds, {
        ALDO_RUN_ID: ctx.runId ?? '',
        ALDO_WORKSPACE: ctx.workspace,
      });
    },
    fireTool(phase, ctx) {
      const map = phase === 'preTool' ? cfg.preTool : cfg.postTool;
      if (map === undefined) return;
      const cmds = map[ctx.toolName];
      if (cmds === undefined || cmds.length === 0) return;
      const env: Record<string, string> = {
        ALDO_RUN_ID: ctx.runId ?? '',
        ALDO_TOOL_NAME: ctx.toolName,
        ALDO_TOOL_ARGS_JSON: safeJson(ctx.args),
        ALDO_WORKSPACE: ctx.workspace,
      };
      if (phase === 'postTool') {
        env.ALDO_TOOL_RESULT_JSON = safeJson(ctx.result);
      }
      fireMany(cmds, env);
    },
  };
}

function readJsonOrEmpty(path: string): HooksConfig {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return {};
    // Permissive — we trust the user's own config file. A malformed
    // entry just gets ignored at fire time.
    return parsed as HooksConfig;
  } catch {
    return {};
  }
}

function mergeHooks(g: HooksConfig, l: HooksConfig): HooksConfig {
  const merged: HooksConfig = {
    ...(g.preRun !== undefined || l.preRun !== undefined
      ? { preRun: [...(g.preRun ?? []), ...(l.preRun ?? [])] }
      : {}),
    ...(g.postRun !== undefined || l.postRun !== undefined
      ? { postRun: [...(g.postRun ?? []), ...(l.postRun ?? [])] }
      : {}),
    ...(g.preTool !== undefined || l.preTool !== undefined
      ? { preTool: { ...(g.preTool ?? {}), ...(l.preTool ?? {}) } }
      : {}),
    ...(g.postTool !== undefined || l.postTool !== undefined
      ? { postTool: { ...(g.postTool ?? {}), ...(l.postTool ?? {}) } }
      : {}),
  };
  return merged;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
