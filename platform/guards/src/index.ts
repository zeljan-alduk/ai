/**
 * @aldo-ai/guards — prompt-injection defences for the gateway path.
 *
 * Public surface:
 *   - createGuardsMiddleware: GatewayMiddleware that applies spotlighting,
 *     output scanning, and dual-LLM quarantine to inbound tool results
 *     and outbound model deltas.
 *   - resolveGuardsConfig + DEFAULT_GUARDS_CONFIG: defaults applied to the
 *     optional `tools.guards` block on agent.v1 specs.
 *   - wrapTrustedContent / wrapUntrustedContent + SPOTLIGHTING_SYSTEM_PREFIX
 *     for direct use outside the middleware path.
 *   - scanOutput + ScanResult + getPromptLeakPatterns for callers that
 *     want to scan text without going through the middleware.
 *   - DualLlmQuarantine for direct use of the dual-LLM pattern.
 *
 * No provider or model id appears anywhere in this package — quarantine
 * routing happens by capability class through the `ModelGateway`.
 */

export {
  createGuardsMiddleware,
  GuardsBlockedError,
  type GatewayMiddleware,
  type GuardsMiddlewareOptions,
  type GuardsEventSink,
} from './middleware.js';

export {
  resolveGuardsConfig,
  DEFAULT_GUARDS_CONFIG,
  severityAtLeast,
  SEVERITY_ORDER,
  type ResolvedGuardsConfig,
} from './config.js';

export {
  wrapTrustedContent,
  wrapUntrustedContent,
  stringifyForSpotlight,
  SPOTLIGHTING_SYSTEM_PREFIX,
  type WrapOptions,
} from './spotlighting.js';

export {
  scanOutput,
  getPromptLeakPatterns,
  type FindingKind,
  type ScanFinding,
  type ScanPolicy,
  type ScanResult,
} from './output-scanner.js';

export {
  DualLlmQuarantine,
  QUARANTINE_OUTPUT_SCHEMA,
  type QuarantineConfig,
  type QuarantineGateway,
  type QuarantineResult,
  type QuarantineRoutingHints,
} from './quarantine.js';
