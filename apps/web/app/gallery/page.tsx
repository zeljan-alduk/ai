/**
 * /gallery — discoverability surface for agent templates.
 *
 * Lists the curated agency templates an operator can adopt. Two
 * adoption paths now coexist on the page:
 *
 *   1. **Page-level "Use the default agency"** — fork-the-whole-org;
 *      atomically inserts ALL templates into the caller's tenant via
 *      `POST /v1/tenants/me/seed-default`. Same flow as `/welcome`.
 *   2. **Per-card "Fork into project"** (wave-3) — fork-one-template;
 *      hits `POST /v1/gallery/fork` and registers a single spec under
 *      the operator's chosen project. Slug collisions auto-rotate to
 *      `<name>-2`, `-3`, … so re-clicking is non-destructive.
 *
 * Closes the AutoGen-Studio Gallery + CrewAI templates parallel —
 * every modern agent platform ships fork-this-one-template; until
 * wave-3 we only had fork-the-whole-org.
 *
 * LLM-agnostic: every template is described by capability + privacy
 * tier; no provider names appear here.
 */

import { seedDefaultAgencyAction } from '@/app/welcome/actions';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Library, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { ForkButton } from './fork-button';

export const dynamic = 'force-dynamic';

interface GalleryEntry {
  readonly name: string;
  readonly team: 'direction' | 'delivery' | 'support' | 'meta';
  readonly privacyTier: 'public' | 'internal' | 'sensitive';
  readonly description: string;
  /** Optional capability-class hint shown on the card. */
  readonly capability?: string;
}

const FEATURED: ReadonlyArray<GalleryEntry> = [
  {
    name: 'principal',
    team: 'direction',
    privacyTier: 'internal',
    description:
      'Top-level coordinator. Reads the strategic brief, assigns work to the architect and program manager, and decides what ships.',
    capability: 'reasoning-large',
  },
  {
    name: 'architect',
    team: 'direction',
    privacyTier: 'internal',
    description:
      'Translates a product brief into a system design + delivery plan. Composite supervisor over the engineers.',
    capability: 'reasoning-large',
  },
  {
    name: 'backend-engineer',
    team: 'delivery',
    privacyTier: 'sensitive',
    description:
      'Implements API + service code in TypeScript / Hono. Sandboxed filesystem + scoped repo write paths.',
    capability: 'reasoning-medium',
  },
  {
    name: 'frontend-engineer',
    team: 'delivery',
    privacyTier: 'internal',
    description:
      'Builds Next.js + Tailwind UI. Knows the design-token system and ships polished, responsive screens.',
    capability: 'reasoning-medium',
  },
  {
    name: 'code-reviewer',
    team: 'support',
    privacyTier: 'sensitive',
    description:
      'Reviews diffs against a checklist (security, contracts, edge cases). Never invents files; quotes paths.',
    capability: 'reasoning-medium',
  },
  {
    name: 'security-auditor',
    team: 'support',
    privacyTier: 'sensitive',
    description:
      'Audits code for security issues. Runs on local models only — `privacy_tier: sensitive` keeps the audit air-gapped.',
    capability: 'reasoning-medium',
  },
  {
    name: 'eval-runner',
    team: 'meta',
    privacyTier: 'internal',
    description:
      'Runs eval suites against a candidate agent version and produces a promotion decision.',
    capability: 'reasoning-small',
  },
  {
    name: 'agent-smith',
    team: 'meta',
    privacyTier: 'sensitive',
    description:
      'Authors and revises other agents’ specs and prompts, given a role brief. Dogfooding all the way down.',
    capability: 'reasoning-large',
  },
];

const TEAM_LABEL: Record<GalleryEntry['team'], string> = {
  direction: 'Direction',
  delivery: 'Delivery',
  support: 'Support',
  meta: 'Meta',
};

const TIER_TONE: Record<GalleryEntry['privacyTier'], string> = {
  public: 'border-success/30 bg-success/10 text-success',
  internal: 'border-accent/30 bg-accent/10 text-accent',
  sensitive: 'border-danger/30 bg-danger/10 text-danger',
};

export default function GalleryPage() {
  return (
    <>
      <PageHeader
        title="Template gallery"
        description="The reference agent organization we dogfood internally — fork the whole agency in one click, or pick individual templates per card and drop them into any project."
        actions={<SeedAgencyButton />}
      />

      <div className="mb-6 flex items-start gap-3 rounded-md border border-accent/30 bg-accent/5 p-4 text-sm">
        <Library aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="text-fg">
          <p className="font-medium">Pick your starting point.</p>
          <p className="mt-1 text-fg-muted">
            Eight featured agents below; the full agency seed includes ~25 specs across direction,
            delivery, support, and meta. Each carries its own privacy tier — sensitive agents are
            physically incapable of reaching a cloud model, regardless of what your config says.
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURED.map((entry) => (
          <li key={entry.name}>
            <Card className="h-full">
              <CardContent className="flex h-full flex-col gap-3 pt-6">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/agents/${encodeURIComponent(entry.name)}`}
                    className="text-base font-semibold text-fg hover:underline"
                  >
                    {entry.name}
                  </Link>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${TIER_TONE[entry.privacyTier]}`}
                  >
                    {entry.privacyTier}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-fg-muted">
                  <span className="flex items-center gap-1">
                    <Users aria-hidden className="h-3 w-3" />
                    {TEAM_LABEL[entry.team]}
                  </span>
                  {entry.capability ? (
                    <span className="flex items-center gap-1">
                      <ShieldCheck aria-hidden className="h-3 w-3" />
                      <code className="font-mono">{entry.capability}</code>
                    </span>
                  ) : null}
                </div>
                <p className="text-sm leading-relaxed text-fg-muted">{entry.description}</p>
                <div className="mt-auto flex flex-col gap-3 pt-2">
                  <ForkButton templateId={entry.name} />
                  <Link
                    href={`/agents/${encodeURIComponent(entry.name)}`}
                    className="text-xs font-medium text-accent hover:text-accent-hover"
                  >
                    View spec →
                  </Link>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-xs text-fg-faint">
        Templates ship as YAML under <code className="font-mono">agency/</code> in the open repo. To
        add a new template to the gallery, drop the YAML in and add a row to{' '}
        <code className="font-mono">apps/web/app/gallery/page.tsx</code>. The retrofit to load the
        list at runtime from the registry is tracked as a follow-up.
      </p>
    </>
  );
}

/**
 * Form-action button that triggers the same `seedDefaultAgencyAction`
 * the welcome page uses. Renders nothing else — the action redirects
 * to /agents on success or returns an error string we just swallow
 * (the welcome flow already covers the error path with a richer UI).
 */
function SeedAgencyButton() {
  return (
    <form action={seedDefaultAgencyAction}>
      <Button type="submit" size="sm">
        Use the default agency
      </Button>
    </form>
  );
}
