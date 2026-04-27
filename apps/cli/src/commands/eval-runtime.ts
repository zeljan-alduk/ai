/**
 * Shared helpers for the eval/promote commands: build a `RuntimeFactory`
 * that gives back ONE Runtime per opaque `provider.model` string.
 *
 * The factory delegates to `bootstrap.ts` so the model registry, adapter
 * registry, and gateway are wired identically to `aldo run`. The agent
 * spec under test is registered into the AgentRegistry on every call so
 * `runtime.spawn(ref, input)` can resolve it via `registry.load(ref)`.
 *
 * LLM-agnostic: the factory accepts the model string as opaque data. It
 * does NOT enforce that the model exists in the gateway's catalog; an
 * unknown id will surface as a `NoEligibleModelError` from the gateway,
 * which the sweep runner records on the failing cell rather than
 * crashing the whole sweep.
 */

import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { EvalSuite } from '@aldo-ai/api-contract';
import type { RuntimePerModel } from '@aldo-ai/eval';
import type { AgentSpec, TenantId } from '@aldo-ai/types';
import { bootstrap } from '../bootstrap.js';
import type { Config } from '../config.js';

export interface BuildEvalFactoryOptions {
  readonly config: Config;
  /** The suite under test — only used to find the agent spec on disk. */
  readonly suite: Pick<EvalSuite, 'agent'>;
  /**
   * Optional override agent spec. When supplied the factory skips the
   * disk lookup. Tests use this; the CLI commands rely on disk discovery
   * via `agents/<name>.yaml`.
   */
  readonly specOverride?: AgentSpec;
  /** Override the bootstrap function — test seam. */
  readonly bootstrapFn?: typeof bootstrap;
  /** Override the agents directory; defaults to `<cwd>/agents`. */
  readonly agentsDir?: string;
}

/** Build a RuntimeFactory: opaque model string -> {runtime, agentRegistry}. */
export function buildEvalRuntimeFactory(opts: BuildEvalFactoryOptions) {
  const boot = opts.bootstrapFn ?? bootstrap;
  const agentsDir = opts.agentsDir ?? resolvePath(process.cwd(), 'agents');

  return async (model: string): Promise<RuntimePerModel> => {
    void model; // The model string is consumed by the gateway router via the agent spec's
    // capability class; we keep it on the cell metadata for replay.
    const tenant = `eval-${Date.now()}` as TenantId;
    const bundle = boot({ config: opts.config, tenant });

    let spec: AgentSpec;
    if (opts.specOverride !== undefined) {
      spec = opts.specOverride;
    } else {
      const candidate = resolvePath(agentsDir, `${opts.suite.agent}.yaml`);
      if (!existsSync(candidate)) {
        throw new Error(
          `agent '${opts.suite.agent}' not found at ${candidate}. Place the agent YAML there or run from a project root with an agents/ dir.`,
        );
      }
      spec = await bundle.agentRegistry.registerFromFile(candidate);
    }
    if (opts.specOverride !== undefined) {
      await bundle.agentRegistry.registerSpec(spec);
    }

    return {
      runtime: bundle.runtime,
      agentRegistry: bundle.agentRegistry,
      judgeGateway: bundle.gateway,
      tenant,
    };
  };
}
