/**
 * Public YAML validator. Thin wrapper around `parseYaml` that exposes the
 * `ValidationResult` contract from `@meridian/types`.
 */

import type { ValidationResult } from '@meridian/types';
import { parseYaml } from './loader.js';

export function validate(yamlText: string): ValidationResult {
  return parseYaml(yamlText);
}
