/**
 * Exact-match evaluator. Both sides are trimmed once before comparison so
 * trailing newlines from a streaming gateway don't flake binary checks.
 */

import type { EvaluationResult } from './index.js';

export function evaluateExact(output: string, expected: string): EvaluationResult {
  const matched = output.trim() === expected.trim();
  return {
    passed: matched,
    score: matched ? 1 : 0,
    detail: { expected, got: output },
  };
}
