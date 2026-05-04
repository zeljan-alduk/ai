/**
 * MISSING_PIECES §11 / Phase B — single tool-call row.
 *
 * Three states (driven by `result`):
 *   - undefined → in-flight (spinner-styled tag)
 *   - error     → red bracket + truncated error preview
 *   - ok        → green bracket + truncated result preview
 *
 * Stateless. Width-aware via ink's automatic wrapping; we only
 * truncate the args/result string to keep one row per call.
 */

import { Box, Text } from 'ink';
import type { ToolEntry } from '../state.js';

export function ToolCall({ entry }: { entry: ToolEntry }) {
  const inFlight = entry.result === undefined;
  const tag = inFlight ? '⟳' : entry.isError ? '✕' : '✓';
  const tagColor = inFlight ? 'yellow' : entry.isError ? 'red' : 'green';
  const summary = previewArgs(entry.args);
  const resultPreview = inFlight ? null : previewResult(entry.result);

  return (
    <Box flexDirection="column" marginLeft={2} marginY={0}>
      <Text>
        <Text color={tagColor}>{tag}</Text>{' '}
        <Text bold>{entry.name}</Text>
        {summary !== '' ? <Text dimColor>{` ${summary}`}</Text> : null}
      </Text>
      {resultPreview !== null ? (
        <Box marginLeft={2}>
          <Text dimColor wrap="truncate-end">
            {resultPreview}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function previewArgs(args: unknown): string {
  if (args === null || args === undefined) return '';
  // Special-case the common shapes for readability.
  if (typeof args === 'object') {
    const a = args as Record<string, unknown>;
    if (typeof a.path === 'string') {
      const path: string = a.path;
      const ctx =
        typeof a.content === 'string'
          ? ` (${(a.content as string).length}b)`
          : '';
      return `${path}${ctx}`;
    }
    if (typeof a.cmd === 'string') return (a.cmd as string).slice(0, 80);
  }
  try {
    return JSON.stringify(args).slice(0, 80);
  } catch {
    return '';
  }
}

function previewResult(result: unknown): string {
  if (result === null || result === undefined) return '';
  if (typeof result === 'string') {
    return result.length > 200 ? `${result.slice(0, 200)}…` : result;
  }
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.exitCode === 'number') {
      const stdoutPreview =
        typeof r.stdout === 'string' && r.stdout.length > 0
          ? ` · stdout: ${(r.stdout as string).split('\n')[0]?.slice(0, 80) ?? ''}`
          : '';
      return `exit ${r.exitCode}${stdoutPreview}`;
    }
    if (r.rejected === true) {
      const reason =
        typeof r.reason === 'string' ? (r.reason as string) : 'rejected';
      return `rejected: ${reason}`;
    }
    if (typeof r.bytes === 'number') {
      return `wrote ${r.bytes} bytes`;
    }
  }
  try {
    return JSON.stringify(result).slice(0, 200);
  } catch {
    return '';
  }
}
