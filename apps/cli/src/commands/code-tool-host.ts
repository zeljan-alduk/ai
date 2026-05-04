/**
 * MISSING_PIECES §11 / Phase A — local ToolHost for `aldo code`.
 *
 * Backs the synthetic `__cli_code__` agent's tool calls with real
 * `node:fs` + `node:child_process` operations, confined to a single
 * workspace root. The MCP-backed `createMcpToolHost` from the API
 * spawns subprocess MCP servers; for a CLI invocation the user is
 * already running on their own machine, so we skip the MCP indirection
 * and call the underlying primitives directly. This keeps `aldo code`
 * dependency-free (no MCP install required for the headless loop).
 *
 * Confinement: every fs path resolves under `root`; every shell.exec
 * runs with `cwd = root`. The agent CANNOT escape the workspace via
 * relative-path tricks. shell.exec's policy (allowlist, deny
 * substrings, timeout) is intentionally minimal here — the §3 #3
 * aldo-shell server is the production policy spine; this CLI host
 * defers to it when the user wires `--tools aldo-shell.shell.exec`
 * against a real running aldo-shell. v0 ships a permissive local
 * exec for the demo path; #9 approval gates remain the safety
 * spine.
 */

import { spawnSync } from 'node:child_process';
import {
  type Dirent,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import type {
  CallContext,
  ToolDescriptor,
  ToolHost,
  ToolRef,
  ToolResult,
} from '@aldo-ai/types';

export interface CodeToolHostOptions {
  /** Absolute path to the workspace root. All fs / cwd resolves under here. */
  readonly root: string;
  /** Wall-clock timeout for shell.exec. Defaults to 5 minutes. */
  readonly shellTimeoutMs?: number;
}

export class CliCodeToolHost implements ToolHost {
  private readonly root: string;
  private readonly shellTimeoutMs: number;

  constructor(opts: CodeToolHostOptions) {
    if (!isAbsolute(opts.root)) {
      throw new Error(`CliCodeToolHost root must be absolute, got: ${opts.root}`);
    }
    this.root = resolvePath(opts.root);
    this.shellTimeoutMs = opts.shellTimeoutMs ?? 5 * 60_000;
  }

  async invoke(tool: ToolRef, args: unknown, _ctx: CallContext): Promise<ToolResult> {
    if (tool.source !== 'mcp' || tool.mcpServer === undefined) {
      return fail('TOOL_UNKNOWN', `expected an MCP tool, got: ${tool.name}`);
    }
    if (tool.mcpServer === 'aldo-fs') return this.invokeFs(tool.name, args);
    if (tool.mcpServer === 'aldo-shell') return this.invokeShell(tool.name, args);
    return fail('TOOL_UNKNOWN', `unknown MCP server: ${tool.mcpServer}`);
  }

  async listTools(): Promise<readonly ToolDescriptor[]> {
    return [
      desc('aldo-fs', 'fs.read', 'read a file under the workspace root'),
      desc('aldo-fs', 'fs.write', 'write a file under the workspace root'),
      desc('aldo-fs', 'fs.list', 'list files in a directory under the workspace root'),
      desc('aldo-fs', 'fs.search', 'recursive grep under the workspace root'),
      desc('aldo-fs', 'fs.stat', 'stat a path under the workspace root'),
      desc('aldo-fs', 'fs.mkdir', 'create a directory under the workspace root'),
      desc('aldo-shell', 'shell.exec', 'run a shell command with cwd = workspace root'),
    ];
  }

  private invokeFs(name: string, args: unknown): ToolResult {
    const a = (args as Record<string, unknown> | null) ?? {};
    switch (name) {
      case 'fs.read': {
        const path = readPath(a, 'path');
        if (path === null) return fail('BAD_ARGS', 'fs.read requires { path: string }');
        const target = this.confine(path);
        if (target === null) return fail('PATH_ESCAPE', `refusing to read outside root: ${path}`);
        if (!existsSync(target)) return fail('ENOENT', `not found: ${path}`);
        const content = readFileSync(target, 'utf8');
        return ok({ path, content });
      }
      case 'fs.write': {
        const path = readPath(a, 'path');
        const content = typeof a.content === 'string' ? a.content : null;
        if (path === null || content === null) {
          return fail('BAD_ARGS', 'fs.write requires { path: string, content: string }');
        }
        const target = this.confine(path);
        if (target === null) return fail('PATH_ESCAPE', `refusing to write outside root: ${path}`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
        return ok({ path, bytes: content.length });
      }
      case 'fs.list': {
        const path = readPath(a, 'path') ?? '.';
        const target = this.confine(path);
        if (target === null) return fail('PATH_ESCAPE', `refusing to list outside root: ${path}`);
        if (!existsSync(target)) return fail('ENOENT', `not found: ${path}`);
        const entries = readdirSync(target, { withFileTypes: true })
          .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' }))
          .sort((x, y) => x.name.localeCompare(y.name));
        return ok({ path, entries });
      }
      case 'fs.stat': {
        const path = readPath(a, 'path');
        if (path === null) return fail('BAD_ARGS', 'fs.stat requires { path: string }');
        const target = this.confine(path);
        if (target === null) return fail('PATH_ESCAPE', `refusing to stat outside root: ${path}`);
        if (!existsSync(target)) return ok({ path, exists: false });
        const s = statSync(target);
        return ok({
          path,
          exists: true,
          kind: s.isDirectory() ? 'dir' : 'file',
          size: s.size,
        });
      }
      case 'fs.search': {
        const needle = typeof a.needle === 'string' ? a.needle : null;
        const path = readPath(a, 'path') ?? '.';
        if (needle === null) return fail('BAD_ARGS', 'fs.search requires { needle: string }');
        const target = this.confine(path);
        if (target === null) {
          return fail('PATH_ESCAPE', `refusing to search outside root: ${path}`);
        }
        // Cheap recursive grep — depth-first, file-only. v0 caps at 100
        // matches to keep the tool result digestible by the model.
        const matches: Array<{ path: string; line: number; preview: string }> = [];
        walk(target, this.root, (rel, full) => {
          if (matches.length >= 100) return false;
          let text: string;
          try {
            text = readFileSync(full, 'utf8');
          } catch {
            return true;
          }
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= 100) return false;
            const line = lines[i];
            if (line !== undefined && line.includes(needle)) {
              matches.push({ path: rel, line: i + 1, preview: line.slice(0, 200) });
            }
          }
          return true;
        });
        return ok({ needle, matches });
      }
      case 'fs.mkdir': {
        const path = readPath(a, 'path');
        if (path === null) return fail('BAD_ARGS', 'fs.mkdir requires { path: string }');
        const target = this.confine(path);
        if (target === null) {
          return fail('PATH_ESCAPE', `refusing to mkdir outside root: ${path}`);
        }
        mkdirSync(target, { recursive: true });
        return ok({ path, created: true });
      }
      default:
        return fail('TOOL_UNKNOWN', `unknown aldo-fs tool: ${name}`);
    }
  }

  private invokeShell(name: string, args: unknown): ToolResult {
    if (name !== 'shell.exec') {
      return fail('TOOL_UNKNOWN', `unknown aldo-shell tool: ${name}`);
    }
    const a = (args as Record<string, unknown> | null) ?? {};
    const cmd = typeof a.cmd === 'string' ? a.cmd : null;
    if (cmd === null) return fail('BAD_ARGS', 'shell.exec requires { cmd: string }');
    const result = spawnSync('/bin/sh', ['-c', cmd], {
      cwd: this.root,
      encoding: 'utf8',
      timeout: this.shellTimeoutMs,
      maxBuffer: 8 * 1024 * 1024, // 8MB stdout/stderr cap
    });
    return ok({
      cmd,
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      ...(result.signal ? { signal: result.signal } : {}),
    });
  }

  /**
   * Resolve `path` under `root`; return `null` when the resolved path
   * would escape the root. Accepts both absolute paths (must already
   * be inside root) and relative paths (joined to root).
   */
  private confine(path: string): string | null {
    const abs = isAbsolute(path) ? resolvePath(path) : resolvePath(join(this.root, path));
    if (!abs.startsWith(this.root + '/') && abs !== this.root) return null;
    return abs;
  }
}

function ok(value: unknown): ToolResult {
  return { ok: true, value };
}

function fail(code: string, message: string): ToolResult {
  return { ok: false, value: { error: message }, error: { code, message } };
}

function readPath(a: Record<string, unknown>, key: string): string | null {
  const v = a[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function desc(server: string, tool: string, description: string): ToolDescriptor {
  return {
    source: 'mcp',
    mcpServer: server,
    name: tool,
    description,
    inputSchema: { type: 'object' },
  };
}

/**
 * Depth-first walk under `root`, calling `visit(relPath, absPath)` on
 * every file (not directory). Caller returns `false` to abort. Skips
 * `node_modules`, `.git`, and other heavy directories so a stray
 * `fs.search` doesn't blow the budget.
 */
function walk(
  start: string,
  root: string,
  visit: (rel: string, abs: string) => boolean,
): void {
  const stack: string[] = [start];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(cur, { withFileTypes: true, encoding: 'utf8' }) as Dirent[];
    } catch {
      continue;
    }
    for (const e of entries) {
      const name = String(e.name);
      const full = join(cur, name);
      if (e.isDirectory()) {
        if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
        stack.push(full);
      } else if (e.isFile()) {
        const rel = full.startsWith(`${root}/`) ? full.slice(root.length + 1) : full;
        if (!visit(rel, full)) return;
      }
    }
  }
}
