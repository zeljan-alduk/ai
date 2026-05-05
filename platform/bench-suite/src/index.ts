/**
 * @aldo-ai/bench-suite — quality × speed model rating engine.
 *
 * Consumed by:
 *  - the CLI (`aldo bench --suite` in apps/cli/src/commands/bench-suite.ts)
 *  - the API (`POST /v1/bench/suite` SSE endpoint in apps/api)
 *  - the web UI (the local-models page that runs ratings live)
 *
 * Public surface:
 *  - runBenchSuite()                    — collect-all entry point
 *  - streamBenchSuite()                 — async-generator entry point
 *  - resolveSuiteByIdOrPath()           — id/path -> EvalSuite
 *  - resolveCaseInputs()                — expand `input: { file: }` cases
 *  - summarise()                        — reduce rows to summary
 *  - formatHeader / formatCaseRow / formatSummary / widthsFor
 */

export type {
  BenchSuiteCaseResult,
  BenchSuiteEvent,
  BenchSuiteResult,
  BenchSuiteSummary,
} from './types.js';

export type { BenchSuiteRunOptions } from './runner.js';
export { runBenchSuite, streamBenchSuite, summarise } from './runner.js';

export {
  resolveCaseInputs,
  resolveSuiteByIdOrPath,
  type ResolvedSuite,
  type SuiteResolveOptions,
} from './suite-loader.js';

export {
  formatCaseRow,
  formatHeader,
  formatSummary,
  widthsFor,
  type ColumnWidths,
} from './formatter.js';
