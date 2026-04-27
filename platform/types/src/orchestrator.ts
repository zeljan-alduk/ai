import type { AgentRef } from './agent.js';
import type { RunId } from './brands.js';

/**
 * Graph node kinds. Every node boundary is an implicit checkpoint.
 */
export type Node =
  | { readonly kind: 'pipeline'; readonly steps: readonly Node[] }
  | { readonly kind: 'supervisor'; readonly lead: AgentRef; readonly workers: readonly AgentRef[] }
  | {
      readonly kind: 'router';
      readonly classifier: AgentRef;
      readonly branches: Readonly<Record<string, Node>>;
    }
  | {
      readonly kind: 'parallel';
      readonly branches: readonly Node[];
      readonly join: 'all' | 'first' | 'quorum';
      readonly quorum?: number;
    }
  | {
      readonly kind: 'debate';
      readonly parties: readonly AgentRef[];
      readonly judge: AgentRef;
      readonly rounds: number;
    }
  | { readonly kind: 'subscription'; readonly event: string; readonly handler: AgentRef }
  | { readonly kind: 'agent'; readonly agent: AgentRef };

export interface Graph {
  readonly name: string;
  readonly root: Node;
}

export interface GraphRun {
  readonly id: RunId;
  /** Fires when the graph completes. */
  wait(): Promise<{ readonly ok: boolean; readonly output: unknown }>;
}

export interface Orchestrator {
  run(graph: Graph, inputs: unknown): Promise<GraphRun>;
}
