/**
 * Shared stub factory for commands whose bodies live in later waves
 * (run, runs ls, runs view, models ls, mcp ls, dev).
 *
 * All stubs print the same not-yet-implemented message and exit code 2.
 */

import type { CliIO } from '../io.js';
import { writeErr } from '../io.js';

export const STUB_EXIT = 2;
export const STUB_MSG = 'not yet implemented — see docs/deploy/free-tier-dev.md';

export function makeStub(name: string): (io: CliIO) => Promise<number> {
  return async (io: CliIO): Promise<number> => {
    writeErr(io, `${name}: ${STUB_MSG}`);
    return STUB_EXIT;
  };
}
