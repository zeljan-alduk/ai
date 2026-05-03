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
 * (recent > actions > nav > agents > runs > datasets > evaluators >
 * prompts > models > settings > docs) so navigation links always win
 * when equal — that's what users expect from Cmd-K.
 *
 * Wave-4 (frontend push): expanded the static nav set to cover every
 * top-level route in the app and added an "actions" group for verbs
 * (compare runs, fork template, sign out, …).
 */

export interface CommandResult {
  /** Stable id; cmdk uses it for selection. */
  readonly id: string;
  /** Visible label. */
  readonly label: string;
  /** Optional secondary text (e.g. agent description, run id). */
  readonly description?: string;
  /** Result group: 'nav', 'agents', 'runs', 'datasets', etc. */
  readonly group: CommandGroup;
  /** Where the row navigates on Enter / click. */
  readonly href: string;
  /** Optional keywords appended to the searchable text. */
  readonly keywords?: ReadonlyArray<string>;
  /**
   * Optional action-id. When set, the palette dispatches the action
   * instead of routing to `href`. Used by the Actions group for things
   * like "Toggle dark mode" or "Compare runs…" that need a side-effect
   * (theme flip, sub-prompt) on top of (or instead of) navigation.
   */
  readonly action?: CommandActionId;
}

export type CommandGroup =
  | 'recent'
  | 'actions'
  | 'nav'
  | 'agents'
  | 'runs'
  | 'datasets'
  | 'evaluators'
  | 'prompts'
  | 'models'
  | 'settings'
  | 'docs';

/**
 * Action-ids for the Actions group. Strings, not enum, so the palette
 * can serialise them through cmdk's value/onSelect plumbing without a
 * mapping table.
 */
export type CommandActionId =
  | 'theme:toggle'
  | 'theme:light'
  | 'theme:dark'
  | 'auth:signout'
  | 'sub:compare-runs'
  | 'sub:fork-template';

/** Higher = wins ties. */
const GROUP_WEIGHT: Record<CommandGroup, number> = {
  // Recents sit at the very top — they're literally what the user just
  // touched, so a near-miss text match still beats anything else.
  recent: 200,
  actions: 120,
  nav: 100,
  settings: 80,
  agents: 60,
  runs: 50,
  datasets: 45,
  evaluators: 40,
  prompts: 35,
  models: 20,
  // Docs are a long-tail source; nav/agents/runs always outrank a
  // doc-page hit at equal text-match scores so the user's daily
  // workflow isn't drowned out by encyclopedic results.
  docs: 10,
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
  const wordBoundaryRe = new RegExp(`(^|[\\s\\-_/])${escapeRegex(trimmed)}`);
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
 * Highlight occurrences of `query` inside `text`. Returns an array of
 * `{ text, match }` segments that the renderer turns into spans (the
 * matched ones get a slightly heavier weight + accent color). Used by
 * the palette row to make the substring match obvious — Linear and
 * Vercel both do this and it makes the surface feel responsive.
 *
 * Pure function; safe in tests.
 */
export function highlightMatch(
  text: string,
  query: string,
): ReadonlyArray<{ text: string; match: boolean }> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = trimmed.toLowerCase();
  const segments: { text: string; match: boolean }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = lower.indexOf(needle, cursor);
    if (idx === -1) {
      segments.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) {
      segments.push({ text: text.slice(cursor, idx), match: false });
    }
    segments.push({ text: text.slice(idx, idx + needle.length), match: true });
    cursor = idx + needle.length;
  }
  if (segments.length === 0) return [{ text, match: false }];
  return segments;
}

/**
 * Default static results — every top-level route in the app, plus the
 * common settings shortcuts. Dynamic sources (agents, runs, datasets,
 * evaluators, prompts, models) are appended at runtime by the palette
 * component. Action-group entries (Compare runs…, Fork template…,
 * Toggle dark mode, Sign out) are declared in `COMMAND_ACTIONS` below.
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
    id: 'nav:projects',
    label: 'Projects',
    description: 'Project workspaces',
    group: 'nav',
    href: '/projects',
    keywords: ['workspace', 'project'],
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
    id: 'nav:datasets',
    label: 'Datasets',
    description: 'Eval datasets and examples',
    group: 'nav',
    href: '/datasets',
    keywords: ['eval', 'data'],
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
    id: 'nav:eval-playground',
    label: 'Eval playground',
    description: 'Per-row scorer playground',
    group: 'nav',
    href: '/eval/playground',
    keywords: ['eval', 'scorer', 'try'],
  },
  {
    id: 'nav:evaluators',
    label: 'Evaluators',
    description: 'Authoring + test panel',
    group: 'nav',
    href: '/evaluators',
    keywords: ['scorer', 'judge'],
  },
  {
    id: 'nav:gallery',
    label: 'Gallery',
    description: 'Importable agency templates',
    group: 'nav',
    href: '/gallery',
    keywords: ['templates', 'examples'],
  },
  {
    id: 'nav:prompts',
    label: 'Prompts',
    description: 'Prompt library',
    group: 'nav',
    href: '/prompts',
    keywords: ['template', 'library'],
  },
  {
    id: 'nav:integrations-git',
    label: 'Git integration',
    description: 'Connect a GitHub or GitLab repo',
    group: 'nav',
    href: '/integrations/git',
    keywords: ['github', 'gitlab', 'repo', 'sync'],
  },
  {
    id: 'nav:threads',
    label: 'Threads',
    description: 'Conversation threads',
    group: 'nav',
    href: '/threads',
    keywords: ['conversations'],
  },
  {
    id: 'nav:observability',
    label: 'Observability',
    description: 'Traces + logs',
    group: 'nav',
    href: '/observability',
    keywords: ['traces', 'logs', 'metrics'],
  },
  {
    id: 'nav:spend',
    label: 'Spend',
    description: 'Token spend by model',
    group: 'nav',
    href: '/observability/spend',
    keywords: ['cost', 'tokens', 'budget'],
  },
  {
    id: 'nav:playground',
    label: 'Playground',
    description: 'Try a prompt against any model',
    group: 'nav',
    href: '/playground',
    keywords: ['try', 'sandbox'],
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
    id: 'nav:status',
    label: 'Status',
    description: 'Service status page',
    group: 'nav',
    href: '/status',
    keywords: ['health', 'incident', 'uptime'],
  },
  {
    id: 'nav:docs',
    label: 'Documentation',
    description: 'Quickstart, concepts, guides, API, SDKs',
    group: 'nav',
    href: '/docs',
    keywords: ['docs', 'documentation', 'help', 'reference'],
  },
  // Settings sub-routes — each maps to a real page under /settings/.
  {
    id: 'nav:settings',
    label: 'Settings',
    description: 'Workspace settings',
    group: 'nav',
    href: '/settings',
    keywords: ['settings', 'workspace'],
  },
  {
    id: 'nav:settings-members',
    label: 'Settings · Members',
    group: 'settings',
    href: '/settings/members',
    keywords: ['team', 'invite'],
  },
  {
    id: 'nav:settings-roles',
    label: 'Settings · Roles',
    group: 'settings',
    href: '/settings/roles',
    keywords: ['rbac', 'permissions'],
  },
  {
    id: 'nav:settings-api-keys',
    label: 'Settings · API keys',
    group: 'settings',
    href: '/settings/api-keys',
    keywords: ['apikey', 'token'],
  },
  {
    id: 'nav:settings-alerts',
    label: 'Settings · Alerts',
    group: 'settings',
    href: '/settings/alerts',
    keywords: ['alerts', 'notifications'],
  },
  {
    id: 'nav:settings-audit',
    label: 'Settings · Audit log',
    group: 'settings',
    href: '/settings/audit',
    keywords: ['audit', 'log', 'compliance'],
  },
  {
    id: 'nav:settings-cache',
    label: 'Settings · Cache',
    group: 'settings',
    href: '/settings/cache',
    keywords: ['cache'],
  },
  {
    id: 'nav:settings-domains',
    label: 'Settings · Domains',
    group: 'settings',
    href: '/settings/domains',
    keywords: ['domain', 'dns'],
  },
  {
    id: 'nav:settings-integrations',
    label: 'Settings · Integrations',
    group: 'settings',
    href: '/settings/integrations',
    keywords: ['integrations'],
  },
  {
    id: 'nav:settings-quotas',
    label: 'Settings · Quotas',
    group: 'settings',
    href: '/settings/quotas',
    keywords: ['quota', 'limits'],
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
    id: 'nav:secrets',
    label: 'Secrets',
    description: 'Tenant-scoped secret values',
    group: 'nav',
    href: '/secrets',
    keywords: ['keys', 'tokens'],
  },
];

/**
 * Action-group entries. These don't navigate by themselves — the
 * palette dispatches the action-id to a handler. New-resource shortcuts
 * (New prompt, New dataset, Connect repo) DO navigate and so are part
 * of `COMMAND_ACTIONS` only as `href`; the action field is left unset
 * for those.
 */
export const COMMAND_ACTIONS: ReadonlyArray<CommandResult> = [
  {
    id: 'action:compare-runs',
    label: 'Compare runs…',
    description: 'Pick two runs to side-by-side diff',
    group: 'actions',
    href: '/runs/compare',
    action: 'sub:compare-runs',
    keywords: ['diff', 'compare'],
  },
  {
    id: 'action:fork-template',
    label: 'Fork template…',
    description: 'Pick a gallery template to fork',
    group: 'actions',
    href: '/gallery',
    action: 'sub:fork-template',
    keywords: ['gallery', 'template', 'fork'],
  },
  {
    id: 'action:connect-repo',
    label: 'Connect a repo…',
    description: 'Link a GitHub or GitLab repository',
    group: 'actions',
    href: '/integrations/git/connect',
    keywords: ['github', 'gitlab', 'integration'],
  },
  {
    id: 'action:new-prompt',
    label: 'New prompt…',
    description: 'Create a new prompt',
    group: 'actions',
    href: '/prompts/new',
    keywords: ['create', 'prompt'],
  },
  {
    id: 'action:new-dataset',
    label: 'New dataset…',
    description: 'Create a new eval dataset',
    group: 'actions',
    href: '/datasets/new',
    keywords: ['create', 'dataset'],
  },
  {
    id: 'action:toggle-theme',
    label: 'Toggle dark mode',
    description: 'Flip light/dark theme',
    group: 'actions',
    href: '#theme',
    action: 'theme:toggle',
    keywords: ['theme', 'dark', 'light', 'appearance'],
  },
  {
    id: 'action:signout',
    label: 'Sign out',
    description: 'End your session',
    group: 'actions',
    href: '/api/auth/logout',
    action: 'auth:signout',
    keywords: ['logout', 'signout'],
  },
];
