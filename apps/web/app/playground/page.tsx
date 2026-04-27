/**
 * /playground — wave-13 multi-model prompt playground.
 *
 * Server component shell. Owns the session check (delegated to the
 * root layout — auth gate is global) and renders the client island
 * which holds all the streaming + state.
 *
 * Layout:
 *   - Top: system prompt + user message editors + capability + privacy + run.
 *   - Below: up to 5 streaming response columns (model id badge,
 *     locality badge, token area, latency, token count, $ tally).
 *   - Compare button below columns: textual diff of any two outputs.
 *   - Save-as-eval-case button: bundles prompt + manually-edited
 *     expected-output into a new eval suite via POST /v1/eval/suites.
 *
 * Privacy is fail-closed at the gateway router; the UI just surfaces
 * the resulting 422 cleanly when no model in the requested capability
 * class allows the chosen tier.
 */

import { PageHeader } from '@/components/page-header';
import { PlaygroundShell } from '@/components/playground/playground-shell';

export const dynamic = 'force-dynamic';

export default function PlaygroundPage() {
  return (
    <>
      <PageHeader
        title="Playground"
        description="Fan one prompt out to up to 5 models. Capability-class selection; privacy enforced by the gateway."
      />
      <PlaygroundShell />
    </>
  );
}
