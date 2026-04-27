/**
 * Sandbox + Guards visibility panels for /agents/[name].
 *
 * Read-only on purpose. Wave 7 made the safety story (sandbox + guards)
 * a first-class operational surface but the YAML lived deep in the repo;
 * reviewers had to grep to know how an agent was gated. These panels
 * surface the *declared* policy at a glance:
 *
 *  - "Sandbox" reflects what the spec authors wrote (or "default sandbox"
 *    when nothing is declared). Runtime resolution still happens in
 *    @aldo-ai/sandbox; we never invent values here.
 *  - "Guards" reflects `tools.guards` from the spec; defaults are filled
 *    by @aldo-ai/guards, so an empty section means "use defaults".
 *
 * Editing remains YAML/PR-gated — there is no write path through the UI.
 */

import type { GetAgentResponse, GuardSeverityWire } from '@aldo-ai/api-contract';
import { CollapsiblePanel } from './collapsible-panel';
import { PolicyPill, type PolicyPillTone, PolicyValue, TokenList } from './policy-value';

type AgentDetail = GetAgentResponse['agent'];

/**
 * Pinned count of curated prompt-leak markers shipped by @aldo-ai/guards.
 * Mirror of `PROMPT_LEAK_PATTERNS.length` in
 * platform/guards/src/output-scanner.ts. Bump when the curated list grows.
 * This is informational — the runtime always uses the canonical list.
 */
const PROMPT_LEAK_MARKER_COUNT = 13;

const SEVERITY_TONE: Record<GuardSeverityWire, PolicyPillTone> = {
  info: 'neutral',
  warn: 'warn',
  error: 'danger',
  critical: 'danger',
};

export function PolicyPanels({ agent }: { agent: AgentDetail }) {
  return (
    <div className="flex flex-col gap-4">
      <SandboxPanel agent={agent} />
      <GuardsPanel agent={agent} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sandbox panel.

function SandboxPanel({ agent }: { agent: AgentDetail }) {
  const sandbox = agent.sandbox ?? null;
  const summary = sandbox ? (
    <PolicyPill tone="neutral" title="Declared sandbox policy">
      declared
    </PolicyPill>
  ) : (
    <PolicyPill tone="off" title="No sandbox block on the spec — platform defaults apply">
      default sandbox
    </PolicyPill>
  );

  return (
    <CollapsiblePanel title="Sandbox" summary={summary}>
      {sandbox ? <SandboxBody sandbox={sandbox} /> : <SandboxEmpty />}
    </CollapsiblePanel>
  );
}

function SandboxEmpty() {
  return (
    <p className="text-sm text-slate-600">
      Running in the platform default sandbox. Timeout, env scrub, and egress are supplied by{' '}
      <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">
        @aldo-ai/sandbox
      </code>{' '}
      based on the agent's <code className="font-mono text-xs">tools.permissions</code> block. Add a
      top-level <code className="font-mono text-xs">sandbox:</code> section in YAML to override.
    </p>
  );
}

function SandboxBody({ sandbox }: { sandbox: NonNullable<AgentDetail['sandbox']> }) {
  const network = sandbox.network;
  const fs = sandbox.filesystem;
  const networkMode = network?.mode ?? 'none';
  const networkPill: { tone: PolicyPillTone; label: string } =
    networkMode === 'none'
      ? { tone: 'on', label: 'egress: none' }
      : networkMode === 'allowlist'
        ? { tone: 'warn', label: 'egress: allowlist' }
        : { tone: 'danger', label: 'egress: host' };

  return (
    <div className="flex flex-col">
      <PolicyValue
        label="Timeout"
        value={
          sandbox.timeoutMs !== undefined ? (
            <span className="font-mono">{sandbox.timeoutMs.toLocaleString()} ms</span>
          ) : (
            <span className="text-slate-500">platform default</span>
          )
        }
        hint="Wall-clock cap per tool invocation."
      />
      <PolicyValue
        label="Env scrub"
        value={sandbox.envScrub === false ? 'inherit host env' : 'strip host env before tool call'}
        pill={
          sandbox.envScrub === false ? (
            <PolicyPill tone="danger" title="Host env vars are visible to tools">
              off
            </PolicyPill>
          ) : (
            <PolicyPill tone="on" title="Tools see only an empty/scrubbed env">
              on
            </PolicyPill>
          )
        }
      />
      <PolicyValue
        label="Network"
        value={
          network ? (
            networkMode === 'allowlist' ? (
              <TokenList
                items={network.allowedHosts ?? []}
                empty="allowlist mode declared but no hosts listed"
              />
            ) : networkMode === 'host' ? (
              <span className="text-slate-600">inherits host network</span>
            ) : (
              <span className="text-slate-600">all egress blocked</span>
            )
          ) : (
            <span className="text-slate-500">platform default</span>
          )
        }
        pill={<PolicyPill tone={networkPill.tone}>{networkPill.label}</PolicyPill>}
      />
      <PolicyValue
        label="Filesystem"
        value={
          fs ? (
            <div className="flex flex-col gap-1.5">
              <div>
                <span className="font-mono text-xs text-slate-700">{fs.permission}</span>
              </div>
              {(fs.readPaths?.length ?? 0) > 0 ? (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-500">read</div>
                  <TokenList items={fs.readPaths ?? []} />
                </div>
              ) : null}
              {(fs.writePaths?.length ?? 0) > 0 ? (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-500">write</div>
                  <TokenList items={fs.writePaths ?? []} />
                </div>
              ) : null}
            </div>
          ) : (
            <span className="text-slate-500">inherits tools.permissions.filesystem</span>
          )
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guards panel.

function GuardsPanel({ agent }: { agent: AgentDetail }) {
  const guards = agent.guards ?? null;
  const summary = guards ? (
    <PolicyPill tone="on" title="Agent declares a tools.guards block">
      guards on
    </PolicyPill>
  ) : (
    <PolicyPill tone="off" title="No tools.guards block — platform defaults apply">
      no guards
    </PolicyPill>
  );

  return (
    <CollapsiblePanel title="Guards" summary={summary}>
      {guards ? <GuardsBody guards={guards} /> : <GuardsEmpty />}
    </CollapsiblePanel>
  );
}

function GuardsEmpty() {
  return (
    <p className="text-sm text-slate-600">
      No <code className="font-mono text-xs">tools.guards</code> block on this spec. The platform
      will apply the defaults from{' '}
      <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">
        @aldo-ai/guards
      </code>{' '}
      (spotlighting on, output scanner off, quarantine off).
    </p>
  );
}

function GuardsBody({ guards }: { guards: NonNullable<AgentDetail['guards']> }) {
  const spotlighting = guards.spotlighting ?? true;
  const scanner = guards.outputScanner;
  const scannerEnabled = scanner?.enabled ?? false;
  const quarantine = guards.quarantine;
  const quarantineEnabled = quarantine?.enabled ?? false;
  const severity = scanner?.severityBlock;

  return (
    <div className="flex flex-col">
      <PolicyValue
        label="Spotlighting"
        value={
          spotlighting
            ? 'untrusted tool output wrapped in <untrusted-content> blocks'
            : 'disabled — tool output passed through verbatim'
        }
        pill={
          spotlighting ? (
            <PolicyPill tone="on">on</PolicyPill>
          ) : (
            <PolicyPill tone="danger">off</PolicyPill>
          )
        }
        hint="Delimiter style: <trusted-content> / <untrusted-content> XML wrappers."
      />
      <PolicyValue
        label="Output scanner"
        value={
          scannerEnabled ? (
            <div className="flex flex-col gap-1.5">
              {(scanner?.urlAllowlist?.length ?? 0) > 0 ? (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-500">
                    URL allowlist
                  </div>
                  <TokenList items={scanner?.urlAllowlist ?? []} />
                </div>
              ) : (
                <span className="text-xs text-slate-500">no URL allowlist declared</span>
              )}
              <div className="text-xs text-slate-500">
                Curated prompt-leak markers: {PROMPT_LEAK_MARKER_COUNT} patterns shipped by
                @aldo-ai/guards. See platform/guards/README.md for the full list.
              </div>
            </div>
          ) : (
            <span className="text-slate-500">scanner disabled</span>
          )
        }
        pill={
          <div className="flex items-center gap-1">
            {scannerEnabled ? (
              <PolicyPill tone="on">enabled</PolicyPill>
            ) : (
              <PolicyPill tone="off">off</PolicyPill>
            )}
            {scannerEnabled && severity ? (
              <PolicyPill
                tone={SEVERITY_TONE[severity]}
                title={`Block runs at severity ≥ ${severity}`}
              >
                ≥ {severity}
              </PolicyPill>
            ) : null}
          </div>
        }
      />
      <PolicyValue
        label="Quarantine"
        value={
          quarantineEnabled ? (
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-slate-700">
                Tool output above the threshold is summarised by an isolated capability class before
                reaching the primary model.
              </div>
              {quarantine?.thresholdChars !== undefined ? (
                <div className="text-xs text-slate-600">
                  Threshold:{' '}
                  <span className="font-mono">
                    {quarantine.thresholdChars.toLocaleString()} chars
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <span className="text-slate-500">quarantine disabled</span>
          )
        }
        pill={
          quarantineEnabled ? (
            <PolicyPill tone="on">on</PolicyPill>
          ) : (
            <PolicyPill tone="off">off</PolicyPill>
          )
        }
      />
    </div>
  );
}
