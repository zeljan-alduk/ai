/**
 * @aldo-ai/local-discovery — probe well-known local-LLM ports
 * (Ollama, vLLM, llama.cpp, LM Studio) and merge live results into the
 * gateway's ModelRegistry.
 *
 * This package is what makes the "local models are first-class"
 * non-negotiable concrete: an operator running Ollama on their laptop
 * sees their models in /v1/models without editing YAML.
 *
 * Public surface:
 *   - discover()                     — run every enabled probe in parallel
 *   - parseDiscoverySources()        — env -> source list
 *   - mergeIntoRegistry()            — merge discovered rows into ModelRegistry
 *   - mergeIntoList()                — merge into a YAML-style array
 *   - probes/{ollama,vllm,llamacpp,lmstudio} — individual probes
 *
 * No code path here keys routing on `provider` strings — the runtime
 * labels `'ollama' | 'vllm' | 'llamacpp' | 'lmstudio'` are display-
 * level only. The router in `@aldo-ai/gateway` continues to dispatch
 * solely on capability class, privacy tier, and cost.
 */

export { discover, parseDiscoverySources } from './discover.js';
export type { DiscoverOptions } from './discover.js';

export {
  COMMON_DEV_PORTS,
  probeOpenAICompatPort,
  resolvePortList,
  scanLocalhostPorts,
} from './port-scan.js';
export type { PortScanOptions, PortScanPreset } from './port-scan.js';

export { mergeIntoRegistry, mergeIntoList } from './registry-merge.js';
export type { MergeOptions, MergeResult } from './registry-merge.js';

export { probe as probeOllama } from './probes/ollama.js';
export { probe as probeVllm } from './probes/vllm.js';
export { probe as probeLlamacpp } from './probes/llamacpp.js';
export { probe as probeLmstudio } from './probes/lmstudio.js';

// Tier 4.1 — model→context lookup table (consumed by every probe;
// re-exported so eval harnesses + downstream callers can resolve a
// model's context window without re-implementing the table).
export {
  DEFAULT_CONTEXT_TOKENS,
  lookupContextTokens,
  normaliseModelId,
  resolveContextTokens,
} from './model-context.js';

export type {
  DiscoveredModel,
  DiscoveryMetadata,
  DiscoverySource,
  ProbeOptions,
} from './types.js';
