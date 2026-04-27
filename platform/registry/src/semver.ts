/**
 * Thin semver helpers. Delegates to the `semver` npm package so the registry
 * has one source of truth for version comparison rules.
 */

import semver from 'semver';

/** Throws `InvalidSemver` if `v` is not a valid semver. */
export function assertValid(v: string): string {
  const parsed = semver.valid(v);
  if (parsed === null) {
    throw new InvalidSemverError(v);
  }
  return parsed;
}

export function isValid(v: string): boolean {
  return semver.valid(v) !== null;
}

/** Returns a negative number if a<b, 0 if a==b, positive if a>b. */
export function compare(a: string, b: string): number {
  return semver.compare(a, b);
}

/** Returns the greatest version in `versions`, or null if empty. */
export function latest(versions: readonly string[]): string | null {
  if (versions.length === 0) return null;
  const sorted = [...versions].sort(semver.rcompare);
  return sorted[0] ?? null;
}

export class InvalidSemverError extends Error {
  public readonly value: string;
  constructor(value: string) {
    super(`invalid semver: ${value}`);
    this.name = 'InvalidSemverError';
    this.value = value;
  }
}
