/**
 * Unit tests for the pure helpers exported from
 * `lib/use-current-project.ts`. We exercise the resolver + URL builder
 * directly (no React mount) so the behaviour is locked down without a
 * JSDOM-style environment. The hook itself is exercised end-to-end by
 * the project-picker Playwright spec.
 *
 * Resolution rule the platform contracts on:
 *   1. URL `?project` wins.
 *   2. localStorage `aldo:current-project` is the fallback.
 *   3. Otherwise null = "All projects".
 */

import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROJECT_QUERY_KEY,
  CURRENT_PROJECT_STORAGE_KEY,
  buildProjectHref,
  resolveCurrentProject,
} from './use-current-project';

describe('resolveCurrentProject', () => {
  it('URL slug wins over localStorage', () => {
    expect(resolveCurrentProject('from-url', 'from-local')).toBe('from-url');
  });

  it('falls back to localStorage when URL has no project', () => {
    expect(resolveCurrentProject(null, 'from-local')).toBe('from-local');
  });

  it('returns null when neither source is present', () => {
    expect(resolveCurrentProject(null, null)).toBeNull();
  });

  it('an empty URL string is treated like null at the resolver layer', () => {
    // The hook trims/normalises before calling the resolver — but the
    // pure function still has well-defined behaviour for empty inputs:
    // a present-but-empty value is NOT null, so it would win. The
    // hook prevents that case from happening; this test documents it.
    expect(resolveCurrentProject('', 'fallback')).toBe('');
  });
});

describe('buildProjectHref', () => {
  it('adds the project param when one is missing and a slug is supplied', () => {
    const params = new URLSearchParams('foo=bar');
    expect(buildProjectHref('/agents', params, 'support-bot')).toBe(
      '/agents?foo=bar&project=support-bot',
    );
  });

  it('replaces an existing project param with the new slug', () => {
    const params = new URLSearchParams('project=old&team=delivery');
    expect(buildProjectHref('/agents', params, 'new-one')).toBe(
      '/agents?project=new-one&team=delivery',
    );
  });

  it('removes the project param when slug is null ("All projects")', () => {
    const params = new URLSearchParams('project=old&team=delivery');
    expect(buildProjectHref('/agents', params, null)).toBe('/agents?team=delivery');
  });

  it('omits the query string entirely when nothing remains', () => {
    const params = new URLSearchParams('project=only');
    expect(buildProjectHref('/runs', params, null)).toBe('/runs');
  });

  it('drops pagination cursors so a project switch starts from the first page', () => {
    const params = new URLSearchParams('project=old&cursor=abc&q=hello');
    expect(buildProjectHref('/runs', params, 'new')).toBe('/runs?project=new&q=hello');
  });

  it('preserves the pathname verbatim — no normalisation', () => {
    const params = new URLSearchParams('');
    expect(buildProjectHref('/runs/abc-123', params, 'p')).toBe('/runs/abc-123?project=p');
  });
});

describe('exported constants', () => {
  it('storage key matches the agreed contract', () => {
    expect(CURRENT_PROJECT_STORAGE_KEY).toBe('aldo:current-project');
  });

  it('query key is `project`', () => {
    expect(CURRENT_PROJECT_QUERY_KEY).toBe('project');
  });
});
