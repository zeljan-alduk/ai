/**
 * First-run / onboarding bridge.
 *
 * After signup or after a tenant-switch into an empty workspace, the
 * auth flow lands here instead of /runs. This page is intentionally a
 * stub — wave 12's full onboarding will replace it. The two seams
 * we expose now are:
 *
 *   1. "Use the default agency template" — calls the
 *      /v1/tenants/me/seed-default endpoint Engineer O is adding.
 *      We render a server action that hits it and redirects to /runs.
 *
 *   2. "Create my first agent" — link to the (yet-unbuilt) agent
 *      authoring flow. For now it just sends the operator into the
 *      empty agents list, which already has its own copy explaining
 *      how to define an agent spec.
 *
 * LLM-agnostic: the seed-default endpoint creates AgentSpec rows
 * declaring capabilities; provider selection happens at run time
 * through the gateway.
 */

import { PageHeader } from '@/components/page-header';
import Link from 'next/link';
import { seedDefaultAgencyAction } from './actions';

export const dynamic = 'force-dynamic';

export default function WelcomePage() {
  return (
    <>
      <PageHeader
        title="Welcome to ALDO AI"
        description="Your workspace is empty. Pick a starting point — you can always change course later."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Start from the default agency</h2>
          <p className="mt-1 text-sm text-slate-600">
            Seeds your workspace with the dogfood org we use to ship ALDO AI itself: principal,
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
        Wave 12 will replace this stub with a guided onboarding. For now, both buttons land you in a
        workspace ready to run.
      </p>
    </>
  );
}
