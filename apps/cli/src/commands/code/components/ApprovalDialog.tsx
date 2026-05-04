/**
 * MISSING_PIECES §11 / Phase C — approval dialog overlay.
 *
 * Renders when the reducer's phase is `awaiting-approval`. Three
 * states:
 *   - choose      → `[a]pprove · [r]eject · [v]iew-full-args` keybind
 *                   row. Default landing.
 *   - viewing     → expands the full args JSON below the row.
 *   - rejecting   → focused reason input; Enter sends the reject,
 *                   Esc returns to `choose`.
 *
 * Pure-ish renderer: takes the active sub-state + the pending payload
 * via props and emits an `<Box>` block. The parent App owns the
 * keypress handler that drives sub-state transitions and ultimately
 * calls `approvalController.resolve(...)`.
 */

import { Box, Text } from 'ink';
import type { RunPhase } from '../state.js';

export type DialogSubState =
  | { readonly kind: 'choose' }
  | { readonly kind: 'viewing' }
  | { readonly kind: 'rejecting'; readonly reasonDraft: string };

export function ApprovalDialog({
  phase,
  subState,
}: {
  phase: Extract<RunPhase, { kind: 'awaiting-approval' }>;
  subState: DialogSubState;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="red"
      paddingX={1}
      marginY={1}
    >
      <Text bold color="red">
        ⚠ approval required
      </Text>
      <Text>
        <Text bold>tool</Text> <Text color="cyan">{phase.tool}</Text>
        <Text dimColor> · {phase.callId.slice(0, 8)}</Text>
      </Text>
      {phase.reason !== null ? (
        <Text>
          <Text bold>reason </Text>
          <Text>{phase.reason}</Text>
        </Text>
      ) : null}
      <Text>
        <Text bold>args </Text>
        <Text dimColor>{previewArgs(phase.args, subState.kind === 'viewing')}</Text>
      </Text>
      {subState.kind === 'rejecting' ? (
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text bold color="red">
              reject reason:{' '}
            </Text>
            <Text>{subState.reasonDraft.length === 0 ? '_' : subState.reasonDraft}</Text>
          </Text>
          <Text dimColor>Enter to confirm · Esc to cancel</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text>
            <Text bold color="green">
              [a]pprove
            </Text>
            <Text dimColor> · </Text>
            <Text bold color="red">
              [r]eject
            </Text>
            <Text dimColor> · </Text>
            <Text bold color="yellow">
              [v]
            </Text>
            <Text dimColor>{subState.kind === 'viewing' ? 'collapse args' : 'iew full args'}</Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}

function previewArgs(args: unknown, expanded: boolean): string {
  if (args === null || args === undefined) return '(none)';
  let json: string;
  try {
    json = JSON.stringify(args, null, expanded ? 2 : 0);
  } catch {
    return String(args);
  }
  if (expanded) return json;
  // Collapsed — single line, truncated.
  return json.length > 120 ? `${json.slice(0, 120)}…` : json;
}
