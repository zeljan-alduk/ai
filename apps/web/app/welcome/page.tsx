/**
 * /welcome — first-run onboarding bridge.
 *
 * Wave-14C makes this a real page (the wave-12 stub is gone) with two
 * clear paths to a working tenant:
 *
 *   1. "Use the default agency template" — POSTs the wave-10
 *      seed-default endpoint, then redirects to /runs.
 *   2. "Define your first agent" — links into /agents.
 *
 * The page also auto-launches the interactive product tour the FIRST
 * time it loads (gated by localStorage). The tour walks every major
 * surface — see components/tour/tour-provider.tsx for the step list.
 *
 * `data-tour="welcome"` and `data-tour="welcome-default-template"`
 * are the anchors the tour's first two steps target. Don't rename
 * without updating tour-provider.tsx.
 *
 * LLM-agnostic: the seed-default endpoint creates AgentSpec rows
 * declaring capabilities; provider selection happens at run time
 * through the gateway.
 */

import { PageHeader } from '@/components/page-header';
import { TourAutoLaunch } from '@/components/tour/tour-provider';
import Link from 'next/link';
import { seedDefaultAgencyAction } from './actions';
import { TakeTourLink } from './take-tour-link';

export const dynamic = 'force-dynamic';

export default function WelcomePage() {
  return (
    <>
      <TourAutoLaunch />
      <PageHeader
        title="Welcome to ALDO AI"
        description="Two paths from here. The first seeds a working agency in your tenant; the second drops you into the registry to define your own. The product tour is one click away."
      />
      <div data-tour="welcome" className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          New here? <TakeTourLink /> or pick a starting point below.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section
          data-tour="welcome-default-template"
          className="rounded-lg border border-slate-200 bg-white p-5"
        >
          <h2 className="text-sm font-semibold text-slate-900">Start from the default agency</h2>
          <p className="mt-1 text-sm text-slate-600">
            Seeds your workspace with the in-house org we use to ship ALDO AI itself: principal,
            architect, engineers, reviewers. Great for kicking the tires.
          </p>
          <form action={seedDefaultAgencyAction} className="mt-4">
            <button
              type="submit"
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Use the default agency template
            </button>
          </form>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Define your first agent</h2>
          <p className="mt-1 text-sm text-slate-600">
            Agents are YAML specs declaring capabilities and a privacy tier. The control plane picks
            a model from the live catalog at run time — local-first when you mark it sensitive.
          </p>
          <Link
            href="/agents"
            className="mt-4 inline-block rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Create my first agent
          </Link>
        </section>
      </div>
      <p className="mt-6 text-xs text-slate-500">
        Need a hand later? Open the user menu in the sidebar and pick &ldquo;Take the tour&rdquo; to
        relaunch this guide on any page.
      </p>
    </>
  );
}
