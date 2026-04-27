/**
 * Regex evaluator. The pattern compiles once per call; an invalid pattern
 * returns score=0 with the compile error in `detail` rather than throwing,
 * so a single malformed case doesn't sink the whole sweep.
 */

import type { EvaluationResult } from './index.js';

export function evaluateRegex(output: string, pattern: string): EvaluationResult {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { passed: false, score: 0, detail: { error: `invalid regex: ${msg}`, pattern } };
  }
  const m = re.exec(output);
  return {
    passed: m !== null,
    score: m !== null ? 1 : 0,
    detail: { pattern, match: m === null ? null : m[0] },
  };
}
