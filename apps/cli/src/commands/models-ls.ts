/**
 * `meridian models ls` — stub. Will list the capability classes configured
 * in the local gateway, provider-agnostic.
 */

import type { CliIO } from '../io.js';
import { makeStub } from './stubs.js';

const impl = makeStub('models ls');

export async function runModelsLs(_opts: { readonly json?: boolean }, io: CliIO): Promise<number> {
  return impl(io);
}
