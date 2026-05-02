/**
 * aldo-platform — MCP server factory.
 *
 * Constructs an `McpServer` instance and registers the 8-tool
 * platform surface on it. Both transports (stdio + HTTP) call this.
 *
 * The 8-tool surface itself lives in `./tools.ts` so it can be
 * registered against any server instance (in particular: the HTTP
 * transport spins up a fresh server per request so it can bind a
 * request-scoped REST client).
 *
 * v0 surface
 * ----------
 * Tools (mutating + read):
 *   aldo.list_agents         enumerate agents in the tenant
 *   aldo.get_agent           fetch an agent spec by name
 *   aldo.list_runs           paginated list with status / agent filter
 *   aldo.get_run             run detail + events
 *   aldo.run_agent           kick off a new run, return the id
 *   aldo.compare_runs        side-by-side diff (event/output/cost)
 *   aldo.list_datasets       enumerate datasets in the tenant
 *   aldo.save_run_as_eval_row capture a run as a dataset example
 *
 * Resources / prompts: deferred to a follow-up wave. Resources need a
 * subscription model; prompts need template authoring. Tools alone
 * cover the 90% of LLM use-cases.
 *
 * LLM-agnostic — no provider names anywhere in this surface.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RestClient } from './client.js';
import { SERVER_NAME, SERVER_VERSION, registerAldoPlatformTools } from './tools.js';

export { SERVER_NAME, SERVER_VERSION };

export interface CreateServerOpts {
  readonly client: RestClient;
}

export function createAldoPlatformServer(opts: CreateServerOpts): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerAldoPlatformTools(server, { client: opts.client });
  return server;
}
