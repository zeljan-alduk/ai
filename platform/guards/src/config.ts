import type { GuardSeverity, ToolsGuardsConfig } from '@aldo-ai/types';

/**
 * Resolved (defaults-applied) view of `tools.guards`. The middleware operates
 * on this shape so call-sites never have to repeat default logic.
 */
export interface ResolvedGuardsConfig {
  readonly spotlighting: boolean;
  readonly outputScanner: {
    readonly enabled: boolean;
    readonly severityBlock: GuardSeverity;
    readonly urlAllowlist: readonly string[];
  };
  readonly quarantine: {
    readonly enabled: boolean;
    readonly capabilityClass: string;
    readonly thresholdChars: number;
  };
}

export const DEFAULT_GUARDS_CONFIG: ResolvedGuardsConfig = {
  spotlighting: true,
  outputScanner: {
    enabled: false,
    severityBlock: 'error',
    urlAllowlist: [],
  },
  quarantine: {
    enabled: false,
    // Capability class is a hint to the gateway router. It MUST stay a class
    // tag, never a provider/model id, to keep this LLM-agnostic.
    capabilityClass: 'reasoning-medium',
    thresholdChars: 4000,
  },
};

/** Apply defaults to a partial agent-spec guards block. */
export function resolveGuardsConfig(
  raw: ToolsGuardsConfig | undefined,
): ResolvedGuardsConfig {
  const d = DEFAULT_GUARDS_CONFIG;
  if (raw === undefined) return d;
  return {
    spotlighting: raw.spotlighting ?? d.spotlighting,
    outputScanner: {
      enabled: raw.outputScanner?.enabled ?? d.outputScanner.enabled,
      severityBlock: raw.outputScanner?.severityBlock ?? d.outputScanner.severityBlock,
      urlAllowlist: raw.outputScanner?.urlAllowlist ?? d.outputScanner.urlAllowlist,
    },
    quarantine: {
      enabled: raw.quarantine?.enabled ?? d.quarantine.enabled,
      capabilityClass: raw.quarantine?.capabilityClass ?? d.quarantine.capabilityClass,
      thresholdChars: raw.quarantine?.thresholdChars ?? d.quarantine.thresholdChars,
    },
  };
}

/** Severity ordering used for "block at or above" comparisons. */
export const SEVERITY_ORDER: Readonly<Record<GuardSeverity, number>> = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

export function severityAtLeast(a: GuardSeverity, b: GuardSeverity): boolean {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b];
}
