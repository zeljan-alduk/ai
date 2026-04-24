/**
 * `meridian agent new <name>` — create a new agent YAML from the template.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliIO } from '../io.js';
import { writeErr, writeLine } from '../io.js';
import { renderAgentTemplate } from './init.js';

export interface AgentNewOptions {
  readonly dir?: string;
  readonly owner?: string;
  readonly description?: string;
  readonly json?: boolean;
}

const KEBAB_RE = /^[a-z0-9][a-z0-9-]*$/;

export async function runAgentNew(name: string, opts: AgentNewOptions, io: CliIO): Promise<number> {
  if (!KEBAB_RE.test(name)) {
    writeErr(io, `error: agent name "${name}" must be kebab-case (matches ${KEBAB_RE.source})`);
    return 1;
  }

  const outDir = resolve(process.cwd(), opts.dir ?? 'agents');
  const outPath = `${outDir}/${name}.yaml`;

  const here = dirname(fileURLToPath(import.meta.url));
  const tpl = await readFile(resolve(here, '../templates/agent.yaml.hbs'), 'utf8');

  const rendered = renderAgentTemplate(tpl, {
    name,
    description: opts.description ?? `TODO: describe ${name}.`,
    owner: opts.owner ?? 'unknown',
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, rendered, 'utf8');

  if (opts.json === true) {
    io.stdout(`${JSON.stringify({ ok: true, path: outPath }, null, 2)}\n`);
  } else {
    writeLine(io, `Created ${outPath}`);
  }
  return 0;
}
