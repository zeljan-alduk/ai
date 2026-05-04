/**
 * MISSING_PIECES §11 / Phase B — Conversation pane.
 *
 * Renders the entry list (user / assistant / tool) as a vertical
 * stack of bubbles. Pure-ish: takes a static slice of entries and
 * draws them; the parent App owns the reducer.
 */

import { Box, Text } from 'ink';
import type { Entry } from '../state.js';
import { ToolCall } from './ToolCall.js';

export function Conversation({ entries }: { entries: readonly Entry[] }) {
  if (entries.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text dimColor>
          Type a brief and press Enter. The agent will read your workspace, write
          files, and run shell commands inside <Text bold>{process.cwd()}</Text>.
        </Text>
        <Text dimColor>
          Ctrl+D to exit · Ctrl+C to abort an in-flight run.
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {entries.map((e, i) => (
        <EntryRow key={`${e.kind}-${i}`} entry={e} />
      ))}
    </Box>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  if (entry.kind === 'user') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold color="cyan">
          {'> '}you
        </Text>
        <Text>{entry.content}</Text>
      </Box>
    );
  }
  if (entry.kind === 'assistant') {
    const placeholder = entry.streaming && entry.content.length === 0;
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold color="green">
          {entry.streaming ? '◇ ' : '◆ '}aldo
        </Text>
        <Text>{placeholder ? '…' : entry.content}</Text>
      </Box>
    );
  }
  if (entry.kind === 'system') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold dimColor>
          ※ system
        </Text>
        <Text dimColor>{entry.content}</Text>
      </Box>
    );
  }
  return <ToolCall entry={entry} />;
}
