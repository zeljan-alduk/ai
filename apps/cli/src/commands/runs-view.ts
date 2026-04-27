/**
 * `aldo runs view <id>` — stub. Will print the event log + message
 * history for a given RunId.
 */

import type { CliIO } from '../io.js';
import { makeStub } from './stubs.js';

const impl = makeStub('runs view');

export async function runRunsView(
  _id: string,
  _opts: { readonly json?: boolean },
  io: CliIO,
): Promise<number> {
  return impl(io);
}
