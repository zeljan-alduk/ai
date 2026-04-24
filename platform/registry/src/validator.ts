/**
 * Public YAML validator. Thin wrapper around `parseYaml` that exposes the
 * `ValidationResult` contract from `@aldo-ai/types`.
 */

import type { ValidationResult } from '@aldo-ai/types';
import { parseYaml } from './loader.js';

export function validate(yamlText: string): ValidationResult {
  return parseYaml(yamlText);
}
