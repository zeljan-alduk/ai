/**
 * argv parsing + command dispatch. Uses `commander` for its stable help
 * output. Every entry point returns an exit code rather than calling
 * `process.exit` so the harness stays test-friendly.
 */

import { Command, Option } from 'commander';
import { runAgentLs } from './commands/agent-ls.js';
import { runAgentNew } from './commands/agent-new.js';
import { runAgentValidate } from './commands/agent-validate.js';
import { runDev } from './commands/dev.js';
import { runInit } from './commands/init.js';
import { runMcpLs } from './commands/mcp-ls.js';
import { runModelsLs } from './commands/models-ls.js';
import { runRun } from './commands/run.js';
import { runRunsLs } from './commands/runs-ls.js';
import { runRunsView } from './commands/runs-view.js';
import type { CliIO } from './io.js';
import { defaultIO } from './io.js';

export const CLI_VERSION = '0.0.0';

export interface MainOptions {
  readonly io?: CliIO;
}

/**
 * Parse argv and dispatch to a command. Returns the resulting exit code.
 *
 * `argv` must be in the shape produced by `process.argv.slice(2)` — i.e.
 * the user-supplied args only, no node + script prefix.
 */
export async function main(argv: readonly string[], opts: MainOptions = {}): Promise<number> {
  const io = opts.io ?? defaultIO();

  // Commander mutates its program state; build a fresh tree per call so
  // repeat invocations in tests don't accumulate.
  const program = new Command();

  // Commander defaults to writing directly to process.stdout/stderr and
  // calling process.exit. Redirect both through `io` so tests can capture.
  program.configureOutput({
    writeOut: (s) => io.stdout(s),
    writeErr: (s) => io.stderr(s),
  });
  program.exitOverride();

  program
    .name('aldo')
    .description('ALDO AI — LLM-agnostic AI sub-agent orchestrator')
    .version(CLI_VERSION, '-v, --version', 'print version')
    .helpOption('-h, --help', 'show help')
    .showHelpAfterError(false)
    .showSuggestionAfterError(true);

  // Capture the chosen action so the outer `try/catch` below can run it.
  let action: (() => Promise<number>) | null = null;

  // --- init -----------------------------------------------------------------
  program
    .command('init <dir>')
    .description('scaffold a new ALDO AI project')
    .option('--json', 'emit JSON output', false)
    .action((dir: string, o: { json?: boolean }) => {
      action = () => runInit(dir, { json: o.json === true }, io);
    });

  // --- agent ----------------------------------------------------------------
  const agent = program.command('agent').description('manage agent specs');

  agent
    .command('new <name>')
    .description('create an agent YAML from template')
    .option('--dir <path>', 'directory to write into', 'agents')
    .option('--owner <owner>', 'owner string')
    .option('--description <text>', 'short description')
    .option('--json', 'emit JSON output', false)
    .action(
      (name: string, o: { dir?: string; owner?: string; description?: string; json?: boolean }) => {
        action = () =>
          runAgentNew(
            name,
            {
              ...(o.dir !== undefined ? { dir: o.dir } : {}),
              ...(o.owner !== undefined ? { owner: o.owner } : {}),
              ...(o.description !== undefined ? { description: o.description } : {}),
              json: o.json === true,
            },
            io,
          );
      },
    );

  agent
    .command('validate <file>')
    .description('zod-validate an agent YAML spec')
    .option('--json', 'emit JSON output', false)
    .action((file: string, o: { json?: boolean }) => {
      action = () => runAgentValidate(file, { json: o.json === true }, io);
    });

  agent
    .command('ls')
    .description('list known agents + promoted versions')
    .option('--dir <path>', 'directory to scan', 'agents')
    .option('--json', 'emit JSON output', false)
    .action((o: { dir?: string; json?: boolean }) => {
      action = () =>
        runAgentLs(
          {
            ...(o.dir !== undefined ? { dir: o.dir } : {}),
            json: o.json === true,
          },
          io,
        );
    });

  // --- run ------------------------------------------------------------------
  program
    .command('run <agent>')
    .description('spawn a run against a real provider')
    .option('--inputs <json>', 'run inputs as JSON string')
    .addOption(new Option('--provider <name>', 'provider override').hideHelp(false))
    .addOption(new Option('--model <name>', 'model override').hideHelp(false))
    .option('--json', 'emit final result as JSON instead of streaming text', false)
    .option('--dry-run', 'print the chosen model + estimate; do not call the provider', false)
    .action(
      (
        agentName: string,
        o: {
          inputs?: string;
          provider?: string;
          model?: string;
          json?: boolean;
          dryRun?: boolean;
        },
      ) => {
        action = () =>
          runRun(
            agentName,
            {
              ...(o.inputs !== undefined ? { inputs: o.inputs } : {}),
              ...(o.provider !== undefined ? { provider: o.provider } : {}),
              ...(o.model !== undefined ? { model: o.model } : {}),
              json: o.json === true,
              dryRun: o.dryRun === true,
            },
            io,
          );
      },
    );

  // --- runs -----------------------------------------------------------------
  const runs = program.command('runs').description('inspect past runs (stub)');

  runs
    .command('ls')
    .description('list recent runs (stub)')
    .option('--json', 'emit JSON output', false)
    .action((o: { json?: boolean }) => {
      action = () => runRunsLs({ json: o.json === true }, io);
    });

  runs
    .command('view <id>')
    .description('show a run by id (stub)')
    .option('--json', 'emit JSON output', false)
    .action((id: string, o: { json?: boolean }) => {
      action = () => runRunsView(id, { json: o.json === true }, io);
    });

  // --- models ---------------------------------------------------------------
  const models = program.command('models').description('inspect model capabilities (stub)');
  models
    .command('ls')
    .description('list capability classes (stub)')
    .option('--json', 'emit JSON output', false)
    .action((o: { json?: boolean }) => {
      action = () => runModelsLs({ json: o.json === true }, io);
    });

  // --- mcp ------------------------------------------------------------------
  const mcp = program.command('mcp').description('inspect MCP servers (stub)');
  mcp
    .command('ls')
    .description('list MCP servers + allowlisted tools (stub)')
    .option('--json', 'emit JSON output', false)
    .action((o: { json?: boolean }) => {
      action = () => runMcpLs({ json: o.json === true }, io);
    });

  // --- dev ------------------------------------------------------------------
  program
    .command('dev')
    .description('boot local gateway+engine for inner loop (stub)')
    .option('--port <n>', 'port', (v) => Number.parseInt(v, 10), 8787)
    .option('--json', 'emit JSON output', false)
    .action((o: { port?: number; json?: boolean }) => {
      action = () =>
        runDev(
          {
            ...(o.port !== undefined ? { port: o.port } : {}),
            json: o.json === true,
          },
          io,
        );
    });

  // Empty argv -> print help deterministically. Commander's own behaviour
  // for an empty argv list depends on its internal `_defaultCommandName`
  // state; we'd rather not rely on it.
  if (argv.length === 0) {
    io.stdout(program.helpInformation());
    return 0;
  }

  try {
    await program.parseAsync(argv as string[], { from: 'user' });
  } catch (err) {
    // Commander's exitOverride surfaces help/version as thrown errors with
    // known codes; treat those as successful (code 0), and likewise swallow
    // the "pass through" cases rather than crashing.
    const e = err as { code?: string; exitCode?: number; message?: string } | undefined;
    const code = e?.code;
    if (
      code === 'commander.helpDisplayed' ||
      code === 'commander.help' ||
      code === 'commander.version'
    ) {
      return 0;
    }
    if (
      code === 'commander.missingArgument' ||
      code === 'commander.unknownCommand' ||
      code === 'commander.unknownOption'
    ) {
      // Commander has already written the error line via configureOutput.
      return 1;
    }
    if (typeof e?.exitCode === 'number' && Number.isFinite(e.exitCode)) {
      return e.exitCode;
    }
    io.stderr(`${e?.message ?? 'error'}\n`);
    return 1;
  }

  if (action === null) {
    // No subcommand matched — commander will have printed help already, but
    // if argv was empty we should still show help and exit 0.
    if (argv.length === 0) {
      io.stdout(program.helpInformation());
      return 0;
    }
    return 0;
  }

  try {
    return await (action as () => Promise<number>)();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr(`error: ${msg}\n`);
    return 1;
  }
}
