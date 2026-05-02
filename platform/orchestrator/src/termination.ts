/**
 * Wave-17 declarative termination controller.
 *
 * Owns the bookkeeping for the four cross-strategy termination rules
 * declared on `AgentSpec.termination`:
 *
 *   - `maxTurns`     — hard ceiling on supervisor↔subagent turns
 *   - `maxUsd`       — hard ceiling on cumulative USD across all
 *                      child runs (rolled up via `sumUsage`)
 *   - `textMention`  — substring match (case-insensitive) against any
 *                      child's textual output
 *   - `successRoles` — alias / agent-name match on a completed child
 *
 * The strategies (sequential / parallel / debate / iterative) consult
 * the controller via `recordChild()` after every child summary is
 * produced. When the controller flags termination, the strategy stops
 * spawning further work and the supervisor emits a single
 * `run.terminated_by` RunEvent on the parent stream.
 *
 * Defaults: when the controller is constructed with `undefined`
 * config (i.e. the spec has no `termination:` block), every check is
 * a no-op and pre-Wave-17 runs behave exactly as before.
 *
 * LLM-agnostic: never references a provider, model, or vendor; works
 * off the cost roll-up and the child output payload.
 */

import type { ChildRunSummary } from './types.js';
import type { TerminationConfig, UsageRecord } from '@aldo-ai/types';
import { sumUsage } from './cost-rollup.js';

export type TerminationReason = 'maxTurns' | 'maxUsd' | 'textMention' | 'successRoles';

export interface TerminationDecision {
  readonly reason: TerminationReason;
  readonly detail: Readonly<Record<string, unknown>>;
}

/**
 * Stateful per-run termination tracker. Constructed once per
 * `runComposite()` call; consulted after every child completes.
 *
 * `recordChild()` appends the summary to the controller's running
 * tally (turn count + usage roll-up + textual scan + role match) and
 * returns a TerminationDecision iff any rule fires for the FIRST time.
 * Subsequent calls after a fire return `null` so callers can drain
 * inflight children without re-emitting.
 */
export class TerminationController {
  private readonly cfg: TerminationConfig | undefined;
  private turns = 0;
  private readonly usages: UsageRecord[] = [];
  private fired = false;

  constructor(cfg: TerminationConfig | undefined) {
    this.cfg = cfg;
  }

  /** True iff the spec declared at least one rule. */
  get enabled(): boolean {
    return this.cfg !== undefined && Object.keys(this.cfg).length > 0;
  }

  /**
   * Record a completed child summary and return a fresh
   * TerminationDecision iff one of the rules just fired. Returns
   * `null` if no rule fired (or one already did and we're suppressing).
   *
   * Order matters: maxTurns is evaluated before maxUsd, then
   * textMention, then successRoles. The strategies don't depend on
   * the order — first-fire wins — but it stabilises the test fixture
   * when a single child crosses two thresholds at once.
   */
  recordChild(summary: ChildRunSummary): TerminationDecision | null {
    if (this.fired) return null;
    this.turns += 1;
    this.usages.push(summary.usage);
    if (this.cfg === undefined) return null;

    if (this.cfg.maxTurns !== undefined && this.turns >= this.cfg.maxTurns) {
      return this.fire({ reason: 'maxTurns', detail: { turns: this.turns, limit: this.cfg.maxTurns } });
    }

    if (this.cfg.maxUsd !== undefined) {
      const total = sumUsage(this.usages).usd;
      if (total >= this.cfg.maxUsd) {
        return this.fire({ reason: 'maxUsd', detail: { usd: total, cap: this.cfg.maxUsd } });
      }
    }

    if (this.cfg.textMention !== undefined && summary.ok) {
      const needle = this.cfg.textMention.toLowerCase();
      const haystack = extractText(summary.output).toLowerCase();
      if (haystack.includes(needle)) {
        return this.fire({
          reason: 'textMention',
          detail: { trigger: this.cfg.textMention, agent: summary.agent.name },
        });
      }
    }

    if (
      this.cfg.successRoles !== undefined &&
      this.cfg.successRoles.length > 0 &&
      summary.ok
    ) {
      const role = summary.alias ?? summary.agent.name;
      if (this.cfg.successRoles.includes(role)) {
        return this.fire({
          reason: 'successRoles',
          detail: { role, agent: summary.agent.name },
        });
      }
    }

    return null;
  }

  /** Current cumulative usage roll-up (used by callers that want to log it). */
  currentUsage(): UsageRecord {
    return sumUsage(this.usages);
  }

  /** Was a termination decision already fired? */
  hasFired(): boolean {
    return this.fired;
  }

  private fire(d: TerminationDecision): TerminationDecision {
    this.fired = true;
    return d;
  }
}

/**
 * Best-effort textual flattening of an opaque child output. The
 * runtime accepts any JSON shape; the `textMention` rule scans for a
 * substring across every string-valued leaf so an agent can declare
 * a sentinel like "TERMINATE" or "DONE" regardless of where in the
 * payload it lives. We deliberately stringify rather than rely on a
 * specific schema — the spec layer never names message shapes.
 */
function extractText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(extractText).join(' ');
  if (typeof value === 'object') {
    const out: string[] = [];
    for (const v of Object.values(value as Record<string, unknown>)) {
      out.push(extractText(v));
    }
    return out.join(' ');
  }
  return '';
}
