import type { Node, RunId } from '@meridian/types';
import type { InternalAgentRun } from '../agent-run.js';
import type { PlatformRuntime } from '../runtime.js';

export interface NodeResult {
  readonly ok: boolean;
  readonly output: unknown;
  readonly childRunIds: readonly RunId[];
}

export interface NodeExecContext {
  readonly runtime: PlatformRuntime;
  /** Signal propagated from the top-level GraphRun for cancellation. */
  readonly signal: AbortSignal;
  /** Track every spawned child so we can cancel on abort. */
  readonly registerChild: (run: InternalAgentRun) => void;
  /** Recurse into nested nodes. */
  readonly execute: (
    node: Node,
    inputs: unknown,
    parent: RunId | undefined,
  ) => Promise<NodeResult>;
}
