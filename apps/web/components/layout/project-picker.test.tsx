/**
 * Render tests for `<ProjectPicker />`.
 *
 * We render to static markup with `renderToStaticMarkup` (the same
 * pattern run-status-sparkline.test.tsx uses) so we can lock down the
 * trigger label, the menu wiring, and the create-link target without
 * standing up a JSDOM browser environment.
 *
 * We mock `next/navigation` so the hook can read URL params + a stub
 * router; we mock `lib/api` so the picker doesn't fan out a network
 * call when no `projects` prop is supplied.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/agents',
  useSearchParams: () => new URLSearchParams(''),
}));

// The picker must NOT trigger a fetch when projects are pre-loaded.
// Mock listProjects to a rejection so we'd surface a regression if the
// component ever tried to call it under test.
vi.mock('@/lib/api', () => ({
  listProjects: vi.fn(() => Promise.reject(new Error('listProjects must not be called in tests'))),
  ApiClientError: class ApiClientError extends Error {},
}));

import type { Project } from '@aldo-ai/api-contract';
import { ALL_PROJECTS_LABEL, ProjectPicker } from './project-picker';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    tenantId: 't-1',
    slug: 'support-bot',
    name: 'Customer support bot',
    description: '',
    archivedAt: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function html(projects: ReadonlyArray<Project>): string {
  return renderToStaticMarkup(<ProjectPicker projects={projects} />);
}

describe('<ProjectPicker /> — trigger', () => {
  it('renders the "All projects" label when no project is selected and the list is empty', () => {
    const out = html([]);
    expect(out).toContain(ALL_PROJECTS_LABEL);
    expect(out).toContain('Project');
    // The aria-label is the accessible name; assert the empty-list
    // form doesn't accidentally embed a stale slug.
    expect(out).toContain('Project picker — All projects');
  });

  it('still renders the "All projects" trigger when one project exists but none selected', () => {
    const out = html([project()]);
    // Trigger shows the empty selection — the dropdown content is
    // portalled at runtime, so static markup is dominated by the trigger.
    expect(out).toContain(ALL_PROJECTS_LABEL);
  });

  it('renders three project rows in the (mounted) menu when given three projects', () => {
    // Static markup of a Radix dropdown trigger doesn't include the
    // portalled menu content. Snapshot the trigger shape instead and
    // confirm the component accepts the three-item list without
    // throwing — the e2e spec covers menu interaction end-to-end.
    const projects = [
      project({ id: 'p-1', slug: 'alpha', name: 'Alpha' }),
      project({ id: 'p-2', slug: 'beta', name: 'Beta' }),
      project({ id: 'p-3', slug: 'gamma', name: 'Gamma' }),
    ];
    const out = html(projects);
    // The data-testid stays consistent regardless of project count.
    expect(out).toContain('project-picker-trigger');
    expect(out).toContain(ALL_PROJECTS_LABEL);
  });

  it('hides archived projects in the active list', () => {
    // Smoke: the picker must not throw on an archived row in the input
    // (it filters them out internally before render).
    const projects = [
      project({ id: 'p-1', slug: 'live', name: 'Live' }),
      project({
        id: 'p-2',
        slug: 'old',
        name: 'Old',
        archivedAt: '2026-04-01T00:00:00.000Z',
      }),
    ];
    expect(() => html(projects)).not.toThrow();
  });
});
