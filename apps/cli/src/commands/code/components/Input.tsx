/**
 * MISSING_PIECES §11 / Phase B — multi-line input box.
 *
 * Implements the bottom-of-screen input affordance:
 *   - text typing (printable chars + space + tab)
 *   - Backspace deletes
 *   - Enter sends (when content non-empty AND `disabled === false`)
 *   - Shift+Enter inserts a newline (most terminals send '\r' for plain
 *     Enter and '\n' for shift+Enter — we treat the inverse forgiving
 *     for either escape, falling back on the convention that the
 *     `meta.option` modifier signals "newline not send")
 *   - Ctrl+C aborts the in-flight run (parent supplies `onAbort`)
 *   - Ctrl+D exits cleanly (parent supplies `onExit`)
 */

import { Box, Text, useInput } from 'ink';
import { useState } from 'react';

export function Input({
  disabled,
  onSubmit,
  onAbort,
  onExit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
  onAbort: () => void;
  onExit: () => void;
}) {
  const [draft, setDraft] = useState('');

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onAbort();
      return;
    }
    if (key.ctrl && input === 'd') {
      onExit();
      return;
    }
    if (disabled) return;

    if (key.return) {
      // Most terminals send Shift+Enter as ESC \r or M-\r. The ink
      // `key.meta` flag lights for option/alt — we use it as a proxy
      // for "newline, don't send" since true shift detection isn't
      // available across all terminals.
      if (key.meta) {
        setDraft((d) => `${d}\n`);
        return;
      }
      const text = draft;
      if (text.trim().length === 0) return;
      setDraft('');
      onSubmit(text);
      return;
    }
    if (key.backspace || key.delete) {
      setDraft((d) => d.slice(0, -1));
      return;
    }
    // Treat any non-control input as a literal character. ink filters
    // mouse / arrow / function keys via the `key.*` flags.
    if (input.length > 0 && !key.ctrl) {
      setDraft((d) => d + input);
    }
  });

  const lines = draft.length === 0 ? ['_'] : draft.split('\n');

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={disabled ? 'gray' : 'cyan'} paddingX={1}>
      <Box>
        <Text bold color={disabled ? 'gray' : 'cyan'}>
          {disabled ? '· ' : '> '}
        </Text>
        <Box flexDirection="column">
          {lines.map((line, i) => (
            <Text key={i} dimColor={disabled}>
              {line}
            </Text>
          ))}
        </Box>
      </Box>
      <Box>
        <Text dimColor>
          {disabled
            ? 'agent working… (Ctrl+C to abort)'
            : 'Enter to send · Alt+Enter for newline · Ctrl+D to exit'}
        </Text>
      </Box>
    </Box>
  );
}
