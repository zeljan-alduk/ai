/**
 * `meridian agent ls` — list agent YAMLs in the project's agents/ directory
 * alongside their `identity.name@identity.version`.
 *
 * Promoted-version discovery is a TODO: the registry's `list()` /
 * promotion index isn't ship-ready. We surface `promoted: null` until then.
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CliIO } from '../io.js';
import { writeLine } from '../io.js';
import { getRegistry } from '../registry-adapter.js';

export interface AgentLsOptions {
  readonly dir?: string;
  readonly json?: boolean;
}

interface AgentListEntry {
  readonly file: string;
  readonly name: string | null;
  readonly version: string | null;
  readonly promoted: string | null;
  readonly ok: boolean;
}

export async function runAgentLs(opts: AgentLsOptions, io: CliIO): Promise<number> {
  const dir = resolve(process.cwd(), opts.dir ?? 'agents');

  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'));
  } catch {
    if (opts.json === true) {
      io.stdout(`${JSON.stringify({ dir, agents: [] }, null, 2)}\n`);
    } else {
      writeLine(io, `(no agents directory at ${dir})`);
    }
    return 0;
  }

  const reg = await getRegistry();
  const entries: AgentListEntry[] = [];
  for (const n of names.sort()) {
    const p = `${dir}/${n}`;
    let text: string;
    try {
      text = await readFile(p, 'utf8');
    } catch {
      entries.push({ file: p, name: null, version: null, promoted: null, ok: false });
      continue;
    }
    const r = reg.validate(text);
    if (r.ok && r.spec !== undefined) {
      entries.push({
        file: p,
        name: r.spec.identity.name,
        version: r.spec.identity.version,
        // TODO: wire once registry ships `list()`/promotion index.
        promoted: null,
        ok: true,
      });
    } else {
      entries.push({ file: p, name: null, version: null, promoted: null, ok: false });
    }
  }

  if (opts.json === true) {
    io.stdout(`${JSON.stringify({ dir, agents: entries }, null, 2)}\n`);
    return 0;
  }

  if (entries.length === 0) {
    writeLine(io, `(no agents in ${dir})`);
    return 0;
  }
  writeLine(io, 'NAME\tVERSION\tPROMOTED\tFILE');
  for (const e of entries) {
    writeLine(io, `${e.name ?? '<invalid>'}\t${e.version ?? '-'}\t${e.promoted ?? '-'}\t${e.file}`);
  }
  return 0;
}
