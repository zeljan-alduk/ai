'use client';

/**
 * Wave-14C — interactive product tour.
 *
 * Wraps the protected app surface in `@reactour/tour`'s provider and
 * exposes a `useStartTour()` hook the user-menu (and the welcome page)
 * call to launch the coach-marks. The provider also auto-launches on
 * the first visit ever (`localStorage.aldo_tour_step` unset) when the
 * caller renders `<TourAutoLaunch />` on the welcome page.
 *
 * Steps target stable `data-tour` attributes throughout the app — we
 * rely on `data-*` rather than CSS classes so a refactor of the design
 * system doesn't silently break the tour.
 *
 * Persistence: every step transition writes
 * `localStorage.aldo_tour_step = '<index>'`. The welcome page checks
 * this before auto-launching so a user who skipped never gets it
 * re-launched. A "Take the tour" menu item resets the value and
 * relaunches.
 *
 * LLM-agnostic: nothing here references a model; the steps walk the
 * platform surfaces (runs, eval, observability, settings).
 */

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'aldo_tour_step';
const COMPLETE_KEY = 'aldo_tour_complete';

// `@reactour/tour` is a client-only library that imports DOM types at
// module-eval time. Loading it dynamically with `ssr: false` keeps it
// out of the server bundle and removes the Node-only crash path.
const TourProviderImpl = dynamic(() => import('@reactour/tour').then((m) => m.TourProvider), {
  ssr: false,
});

interface TourCtx {
  start(): void;
  reset(): void;
}

const TourContext = createContext<TourCtx | null>(null);

export function useTour(): TourCtx {
  const ctx = useContext(TourContext);
  if (ctx === null) {
    // Defensive fallback so a component outside the provider doesn't
    // crash the page; we just render a no-op.
    return { start: () => undefined, reset: () => undefined };
  }
  return ctx;
}

/**
 * Tour step definitions. Each step targets a stable `[data-tour="..."]`
 * selector. The selector MUST exist on the corresponding page; if the
 * user is on a different route when the step fires, we navigate first.
 */
const STEPS = [
  {
    selector: '[data-tour="welcome"]',
    route: '/welcome',
    content: (
      <TourCard
        title="Welcome to ALDO AI"
        body="A virtual software agency you control. Take the 60-second tour — six stops, skip anytime. Press / on any page to open the command palette."
      />
    ),
    position: 'right' as const,
  },
  {
    selector: '[data-tour="welcome-default-template"]',
    route: '/welcome',
    content: (
      <TourCard
        title="Use the default agency template"
        body="Seeds your tenant with the same principal -> architect -> engineers -> reviewers mesh we use to ship ALDO AI itself. Click to seed your own copy."
      />
    ),
    position: 'bottom' as const,
  },
  {
    selector: '[data-tour="agents-card"]',
    route: '/agents',
    content: (
      <TourCard
        title="Versioned agent specs"
        body="Each card shows the agent name, privacy tier, recent run statuses, and team. Cards link straight into the agent's run history + composite affinity."
      />
    ),
    position: 'right' as const,
  },
  {
    selector: '[data-tour="runs-list"]',
    route: '/runs',
    content: (
      <TourCard
        title="Runs — flame graphs + replay scrubber"
        body="Open any run to see the full flame graph and a scrubber on the right — drag back to any step, swap a model on any node, and re-execute the rest of the tree."
      />
    ),
    position: 'top' as const,
  },
  {
    selector: '[data-tour="eval-radar"]',
    route: '/eval',
    content: (
      <TourCard
        title="Eval sweeps + radar charts"
        body="Run a suite across multiple models, locality classes, and prompt templates. The radar chart compares pass rates per dimension at a glance."
      />
    ),
    position: 'bottom' as const,
  },
  {
    selector: '[data-tour="privacy-feed"]',
    route: '/observability',
    content: (
      <TourCard
        title="Privacy-tier feed"
        body="Every run is tagged with its privacy tier. The feed shows where data went, fail-closed enforcement, and a permanent audit trail. The router drops sensitive runs that try to reach the cloud — agents can't override it."
      />
    ),
    position: 'left' as const,
  },
  {
    selector: '[data-tour="api-keys"]',
    route: '/settings/api-keys',
    content: (
      <TourCard
        title="Generate your first API key"
        body="Mint a scoped key for CI / scripts. Keys are shown ONCE on creation and never re-derivable — copy yours immediately."
      />
    ),
    position: 'bottom' as const,
  },
] as const;

function TourCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-sm">
      <p className="text-base font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-slate-600">{body}</p>
      <p className="mt-3 text-[11px] text-slate-400">Press Esc to skip · arrow keys to navigate</p>
    </div>
  );
}

export function TourProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [resetKey, setResetKey] = useState(0);

  const start = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, '0');
      window.localStorage.removeItem(COMPLETE_KEY);
      // Fire a CustomEvent the inner provider listens to so it can
      // open without us needing to plumb its setIsOpen function up
      // through React context.
      window.dispatchEvent(new CustomEvent('aldo:tour:start'));
      setResetKey((v) => v + 1);
    }
  }, []);

  const reset = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(COMPLETE_KEY);
      setResetKey((v) => v + 1);
    }
  }, []);

  const ctx = useMemo<TourCtx>(() => ({ start, reset }), [start, reset]);

  // Translate step changes into a route navigation when the step's
  // route differs from the current pathname. The library calls
  // `afterOpen` and `beforeClose`; we re-implement minimal navigation
  // by reading `currentStep` via window event.
  //
  // GUARD: ignore step events when the user has marked the tour as
  // complete OR has no in-progress tour state. Without this, the
  // bridge effect in `<TourBridge />` re-fires `aldo:tour:step` on
  // every layout mount with `currentStep=0`, which triggers a
  // router.push('/welcome'). End result: any sidebar click drops the
  // user back to /welcome until they finish the tour. Detected via
  // chrome-mcp e2e on 2026-04-28.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStep = (e: Event) => {
      const complete = window.localStorage.getItem(COMPLETE_KEY);
      const stepState = window.localStorage.getItem(STORAGE_KEY);
      // Tour not active — never auto-navigate.
      if (complete === 'true' || stepState === null) return;
      const ce = e as CustomEvent<number>;
      const step = STEPS[ce.detail];
      if (step !== undefined && window.location.pathname !== step.route) {
        router.push(step.route);
      }
      window.localStorage.setItem(STORAGE_KEY, String(ce.detail));
    };
    window.addEventListener('aldo:tour:step', onStep);
    return () => window.removeEventListener('aldo:tour:step', onStep);
  }, [router]);

  return (
    <TourContext.Provider value={ctx}>
      <TourProviderImpl
        key={resetKey}
        steps={STEPS as unknown as never[]}
        afterOpen={() => {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY, '0');
          }
        }}
        beforeClose={() => {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(COMPLETE_KEY, 'true');
          }
        }}
        onClickClose={({ setIsOpen }) => {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(COMPLETE_KEY, 'true');
          }
          setIsOpen(false);
        }}
        onClickHighlighted={(
          _e: unknown,
          props: { setCurrentStep: (n: number) => void; currentStep: number },
        ) => {
          // Advance on highlight click — feels right for coach-marks.
          if (props.currentStep < STEPS.length - 1) {
            props.setCurrentStep(props.currentStep + 1);
          }
        }}
        styles={{
          popover: (base: Record<string, unknown>) => ({
            ...base,
            borderRadius: 8,
            padding: 16,
            maxWidth: 360,
          }),
        }}
      >
        <TourBridge />
        {children}
      </TourProviderImpl>
    </TourContext.Provider>
  );
}

/**
 * Tiny bridge that listens for the `aldo:tour:start` event the
 * `useTour().start()` hook fires and toggles the library's open
 * state via the actual hook (which is only available below
 * `<TourProviderImpl>`).
 */
function TourBridge() {
  // We import the hook lazily so SSR doesn't crash.
  // Using `require` keeps Next from tree-shaking the dynamic boundary.
  // Fallback to no-op when the hook is unavailable (older bundles).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const useTourHook = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('@reactour/tour').useTour as
        | (() => {
            setIsOpen: (v: boolean) => void;
            setCurrentStep: (n: number) => void;
            currentStep: number;
          })
        | undefined;
    } catch {
      return undefined;
    }
  })();
  const tour = useTourHook?.();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (tour === undefined) return;
    const onStart = () => {
      tour.setCurrentStep(0);
      tour.setIsOpen(true);
    };
    window.addEventListener('aldo:tour:start', onStart);
    return () => window.removeEventListener('aldo:tour:start', onStart);
  }, [tour]);

  // Forward step changes via custom event so the provider can navigate.
  useEffect(() => {
    if (tour === undefined) return;
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('aldo:tour:step', { detail: tour.currentStep }));
  }, [tour, tour?.currentStep]);

  return null;
}

/**
 * Render this on the welcome page to auto-launch the tour the first
 * time the user lands there. Skipped when `aldo_tour_complete` is set.
 */
export function TourAutoLaunch() {
  const { start } = useTour();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const complete = window.localStorage.getItem(COMPLETE_KEY);
    const step = window.localStorage.getItem(STORAGE_KEY);
    if (complete === 'true') return;
    if (step !== null) return;
    // Defer so the welcome page has time to render its `data-tour` targets.
    const t = setTimeout(start, 600);
    return () => clearTimeout(t);
  }, [start]);
  return null;
}
