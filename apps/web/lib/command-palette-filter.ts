/**
 * Pure result-filtering for the Cmd-K command palette.
 *
 * The cmdk library does its own filtering, but we keep a pure
 * function here for two reasons:
 *
 *   1. Unit-testable scoring without booting React.
 *   2. Lets the palette pre-rank items before handing them to cmdk so
 *      "Open agents" shows up before "Open agency settings" when the
 *      user types "agen" — cmdk's default scorer treats both equally.
 *
 * Scoring is intentionally simple: exact-prefix > substring > word-
 * boundary substring > no match. Ties are broken by source weight
 * (nav > agents > runs > models) so navigation links always win when
 * equal — that's what users expect from Cmd-K.
 */

export interface CommandResult {
  /** Stable id; cmdk uses it for selection. */
  readonly id: string;
  /** Visible label. */
  readonly label: string;
  /** Optional secondary text (e.g. agent description, run id). */
  readonly description?: string;
  /** Result group: 'nav', 'agents', 'runs', 'models', 'settings'. */
  readonly group: CommandGroup;
  /** Where the row navigates on Enter / click. */
  readonly href: string;
  /** Optional keywords appended to the searchable text. */
  readonly keywords?: ReadonlyArray<string>;
}

export type CommandGroup = 'nav' | 'agents' | 'runs' | 'models' | 'settings';

/** Higher = wins ties. */
const GROUP_WEIGHT: Record<CommandGroup, number> = {
  nav: 100,
  settings: 80,
  agents: 60,
  runs: 40,
  models: 20,
};

/**
 * Score one result against a query.
 *
 * Returns 0 (no match) up to 1000 (exact prefix on label), with the
 * group weight added in to break ties between equal-score matches.
 *
 * Empty query -> every result scores by group weight only, so the
 * default rendering shows nav links first.
 */
export function scoreResult(result: CommandResult, query: string): number {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return GROUP_WEIGHT[result.group];

  const haystack = [result.label, result.description ?? '', ...(result.keywords ?? [])]
    .join(' ')
    .toLowerCase();

  // Exact prefix on the label is the strongest match.
  const labelLower = result.label.toLowerCase();
  if (labelLower.startsWith(trimmed)) {
    return 1000 + GROUP_WEIGHT[result.group];
  }

  // Word-boundary match (e.g. "rev" matches "code-reviewer" because
  // it's preceded by a hyphen in the label/keywords).
  const wordBoundaryRe = new RegExp(`(^|[\\s-_])${escapeRegex(trimmed)}`);
  if (wordBoundaryRe.test(haystack)) {
    return 500 + GROUP_WEIGHT[result.group];
  }

  // Plain substring match.
  if (haystack.includes(trimmed)) {
    return 200 + GROUP_WEIGHT[result.group];
  }

  return 0;
}

/**
 * Filter + rank a result list against a query. Returns the matched
 * subset sorted by descending score. A zero-score result is dropped.
 */
export function filterResults(
  results: ReadonlyArray<CommandResult>,
  query: string,
): CommandResult[] {
  const scored = results
    .map((r) => ({ r, s: scoreResult(r, query) }))
    .filter((entry) => entry.s > 0);
  scored.sort((a, b) => b.s - a.s);
  return scored.map((entry) => entry.r);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Default static results — navigation entries + a handful of common
 * settings shortcuts. Dynamic sources (agents, runs, models) are
 * appended at runtime by the palette component.
 */
export const STATIC_NAV_RESULTS: ReadonlyArray<CommandResult> = [
  {
    id: 'nav:home',
    label: 'Home',
    description: 'Dashboard overview',
    group: 'nav',
    href: '/',
    keywords: ['dashboard', 'overview'],
  },
  {
    id: 'nav:agents',
    label: 'Agents',
    description: 'Browse the agent registry',
    group: 'nav',
    href: '/agents',
    keywords: ['registry', 'specs'],
  },
  {
    id: 'nav:runs',
    label: 'Runs',
    description: 'Recent runs across the tenant',
    group: 'nav',
    href: '/runs',
    keywords: ['history', 'executions'],
  },
  {
    id: 'nav:models',
    label: 'Models',
    description: 'Live model catalog',
    group: 'nav',
    href: '/models',
    keywords: ['catalog', 'capability'],
  },
  {
    id: 'nav:eval',
    label: 'Eval',
    description: 'Eval suites + sweeps',
    group: 'nav',
    href: '/eval',
    keywords: ['suites', 'sweeps', 'benchmarks'],
  },
  {
    id: 'nav:secrets',
    label: 'Secrets',
    description: 'Tenant-scoped secret values',
    group: 'nav',
    href: '/secrets',
    keywords: ['keys', 'tokens'],
  },
  {
    id: 'nav:billing',
    label: 'Billing',
    description: 'Subscription + plan',
    group: 'nav',
    href: '/billing',
    keywords: ['subscription', 'plan', 'invoice'],
  },
  {
    id: 'settings:theme-light',
    label: 'Switch to light theme',
    group: 'settings',
    href: '#theme-light',
    keywords: ['theme', 'appearance'],
  },
  {
    id: 'settings:theme-dark',
    label: 'Switch to dark theme',
    group: 'settings',
    href: '#theme-dark',
    keywords: ['theme', 'appearance'],
  },
  {
    id: 'settings:logout',
    label: 'Log out',
    group: 'settings',
    href: '/api/auth/logout',
    keywords: ['signout', 'logout'],
  },
];
