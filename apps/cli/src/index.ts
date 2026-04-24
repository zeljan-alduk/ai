#!/usr/bin/env node
/**
 * Entry point for the `meridian` binary.
 *
 * Everything interesting lives in `./cli.ts`; this file is the thinnest
 * possible wrapper so `bun build --compile` has a stable target.
 */

import { main } from './cli.js';

// Clean SIGINT handling: print a short line and exit 130 (conventional
// for ^C). We install at top-level so even a hanging command respects it.
function installSignalHandlers(): void {
  const onSigint = (): void => {
    process.stderr.write('\n(interrupted)\n');
    process.exit(130);
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigint);
}

installSignalHandlers();

const argv = process.argv.slice(2);
main(argv)
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`fatal: ${msg}\n`);
    process.exit(1);
  });
