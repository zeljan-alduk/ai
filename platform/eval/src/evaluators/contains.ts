/**
 * Substring evaluators. Case-sensitive by design — authors who want
 * case-insensitive matches should phrase their expectation as a regex.
 */

import type { EvaluationResult } from './index.js';

export function evaluateContains(output: string, needle: string): EvaluationResult {
  const hit = output.includes(needle);
  return {
    passed: hit,
    score: hit ? 1 : 0,
    detail: { needle, hit },
  };
}

export function evaluateNotContains(output: string, needle: string): EvaluationResult {
  const hit = output.includes(needle);
  return {
    passed: !hit,
    score: hit ? 0 : 1,
    detail: { needle, hit },
  };
}
