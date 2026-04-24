/**
 * `meridian runs ls` — stub. Will list recent run ids + status once the
 * engine ships a persistent runs store.
 */

import type { CliIO } from '../io.js';
import { makeStub } from './stubs.js';

const impl = makeStub('runs ls');

export async function runRunsLs(_opts: { readonly json?: boolean }, io: CliIO): Promise<number> {
  return impl(io);
}
