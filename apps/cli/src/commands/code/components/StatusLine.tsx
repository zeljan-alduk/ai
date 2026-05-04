/**
 * MISSING_PIECES §11 / Phase B — status line.
 *
 * One-line summary at the bottom of the conversation pane: phase
 * (idle/running/awaiting-approval/...), cycle indicator, rolled-up
 * usage. Refreshes on every reducer tick.
 */

import { Box, Text } from 'ink';
import type { RunPhase, TelemetryRollup } from '../state.js';

export function StatusLine({
  phase,
  telemetry,
}: {
  phase: RunPhase;
  telemetry: TelemetryRollup;
}) {
  return (
    <Box>
      <PhaseTag phase={phase} />
      <Text dimColor> · </Text>
      <Text dimColor>{telemetry.model ?? 'no model yet'}</Text>
      <Text dimColor>
        {' · '}
        {telemetry.tokensIn}/{telemetry.tokensOut} tok · ${telemetry.usd.toFixed(4)}
      </Text>
    </Box>
  );
}

function PhaseTag({ phase }: { phase: RunPhase }) {
  switch (phase.kind) {
    case 'idle':
      return <Text color="cyan">[idle]</Text>;
    case 'running':
      return (
        <Text color="yellow">
          [cycle {phase.cycle}
          {phase.maxCycles !== null ? `/${phase.maxCycles}` : ''}]
        </Text>
      );
    case 'compressing':
      return (
        <Text color="magenta">
          [compress {phase.strategy} @ cycle {phase.cycle}]
        </Text>
      );
    case 'awaiting-approval':
      return (
        <Text color="red" bold>
          [approve? {phase.tool}]
        </Text>
      );
    case 'completed':
      return (
        <Text color="green">
          [done · {phase.cycles} cycle{phase.cycles === 1 ? '' : 's'}]
        </Text>
      );
    case 'errored':
      return <Text color="red">[error: {truncate(phase.message, 60)}]</Text>;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
