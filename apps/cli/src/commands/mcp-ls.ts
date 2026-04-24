/**
 * `aldo mcp ls` — stub. Will list registered MCP servers and their
 * allowlisted tools once the MCP registry lands.
 */

import type { CliIO } from '../io.js';
import { makeStub } from './stubs.js';

const impl = makeStub('mcp ls');

export async function runMcpLs(_opts: { readonly json?: boolean }, io: CliIO): Promise<number> {
  return impl(io);
}
