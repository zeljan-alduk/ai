/**
 * `meridian init <dir>` — scaffold a new Meridian project.
 *
 * Lays down:
 *   <dir>/.meridianrc                     (JSON)
 *   <dir>/agency/                         (empty, .gitkeep)
 *   <dir>/agents/                         (directory)
 *   <dir>/agents/code-reviewer.yaml       (sample agent)
 *   <dir>/prompts/code-reviewer.md        (sample system prompt)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliIO } from '../io.js';
import { writeLine } from '../io.js';

const SAMPLE_SYSTEM_PROMPT = `You are code-reviewer, a Meridian agent.

Review pull requests for correctness, clarity, and test coverage.
Prefer concrete, actionable comments over generic advice.
`;

export interface InitOptions {
  readonly json?: boolean;
}

export async function runInit(dir: string, opts: InitOptions, io: CliIO): Promise<number> {
  const root = resolve(process.cwd(), dir);

  const files: { path: string; contents: string }[] = [];

  // Read bundled templates from the package directory.
  const here = dirname(fileURLToPath(import.meta.url));
  const agentTpl = await readFile(resolve(here, '../templates/agent.yaml.hbs'), 'utf8');
  const rcTpl = await readFile(resolve(here, '../templates/meridianrc.json'), 'utf8');

  const sampleAgent = renderAgentTemplate(agentTpl, {
    name: 'code-reviewer',
    description: 'Reviews pull requests for correctness and clarity.',
    owner: 'team-platform',
  });

  files.push({ path: `${root}/.meridianrc`, contents: rcTpl });
  files.push({ path: `${root}/agency/.gitkeep`, contents: '' });
  files.push({ path: `${root}/agents/code-reviewer.yaml`, contents: sampleAgent });
  files.push({ path: `${root}/prompts/code-reviewer.md`, contents: SAMPLE_SYSTEM_PROMPT });

  for (const f of files) {
    await mkdir(dirname(f.path), { recursive: true });
    await writeFile(f.path, f.contents, 'utf8');
  }

  if (opts.json === true) {
    io.stdout(
      `${JSON.stringify({ ok: true, root, created: files.map((f) => f.path) }, null, 2)}\n`,
    );
  } else {
    writeLine(io, `Initialized Meridian project in ${root}`);
    for (const f of files) writeLine(io, `  created ${f.path}`);
  }
  return 0;
}

/**
 * Tiny mustache-ish renderer. We deliberately avoid a handlebars dep — the
 * template only needs `{{name}}`, `{{description}}`, `{{owner}}`.
 */
export function renderAgentTemplate(tpl: string, vars: Readonly<Record<string, string>>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined) {
      throw new Error(`template variable not provided: ${key}`);
    }
    return v;
  });
}
