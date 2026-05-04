/**
 * MISSING_PIECES §11 / Phase D — slash command parser + transcript writer.
 *
 * Pure module. Splits user input that starts with `/` into a
 * discriminated union of commands; the App intercepts each before
 * dispatching the regular `user-input` action that would route to
 * the agent. Side effects (writing the save file, exiting) are
 * handled by the App, not here.
 *
 * Commands:
 *   /help           — show the keybind + command list
 *   /clear          — reset the conversation (keeps spec + tools)
 *   /exit           — same as Ctrl+D
 *   /save <path>    — write the transcript as markdown to <path>
 *   /model          — show the active capability class (read-only v0)
 *   /tools          — show the active tool list (read-only v0)
 *
 * Mutating /model + /tools mid-session is deferred — both require
 * a fresh runtime + spec rebuild because the agent's capability
 * class and tool allowlist are baked into the AgentSpec. Until that
 * lands, the read-only view is the correct affordance: the user
 * sees what the session is using and can restart with new flags.
 */

import type { Entry } from './state.js';

export type SlashCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'exit' }
  | { readonly kind: 'save'; readonly path: string }
  | { readonly kind: 'model' }
  | { readonly kind: 'tools' }
  | { readonly kind: 'unknown'; readonly raw: string };

/**
 * Parse a leading-slash input. Returns null when the text doesn't
 * start with `/` — the App falls through to the regular user-input
 * dispatch. Whitespace around the input is trimmed.
 */
export function parseSlashCommand(text: string): SlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const body = trimmed.slice(1);
  if (body.length === 0) return { kind: 'unknown', raw: trimmed };
  const spaceIdx = body.indexOf(' ');
  const head = (spaceIdx === -1 ? body : body.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? '' : body.slice(spaceIdx + 1).trim();
  switch (head) {
    case 'help':
    case '?':
      return { kind: 'help' };
    case 'clear':
    case 'reset':
      return { kind: 'clear' };
    case 'exit':
    case 'quit':
    case 'q':
      return { kind: 'exit' };
    case 'save': {
      if (rest.length === 0) return { kind: 'unknown', raw: trimmed };
      return { kind: 'save', path: rest };
    }
    case 'model':
      return { kind: 'model' };
    case 'tools':
      return { kind: 'tools' };
    default:
      return { kind: 'unknown', raw: trimmed };
  }
}

/** Body of `/help` — kept as data so tests can assert on its shape. */
export const HELP_TEXT = [
  'Slash commands:',
  '  /help               this list',
  '  /clear              reset the conversation (keeps spec + tools)',
  '  /save <path>        write the transcript as markdown to <path>',
  '  /model              show the active capability class',
  '  /tools              show the active tool list',
  '  /exit               exit (same as Ctrl+D)',
  '',
  'Keybinds:',
  '  Enter               send message',
  '  Alt+Enter           newline (multi-line message)',
  '  Ctrl+C              abort the in-flight run',
  '  Ctrl+D              exit',
  '',
  'Approval dialog (when a tool call requires approval):',
  '  a / r / v           approve / reject / view full args',
].join('\n');

/**
 * Render a session transcript as Markdown. Emits one section per
 * entry — user messages as quoted blocks, assistant text as plain
 * paragraphs, tool calls as collapsed details with args + result.
 *
 * Pure — no I/O. The App writes the returned string to disk.
 */
export function renderTranscriptMarkdown(entries: readonly Entry[]): string {
  if (entries.length === 0) {
    return '# aldo code transcript\n\n*(empty session)*\n';
  }
  const lines: string[] = ['# aldo code transcript', ''];
  for (const e of entries) {
    if (e.kind === 'user') {
      lines.push('## you', '');
      for (const line of e.content.split('\n')) {
        lines.push(`> ${line}`);
      }
      lines.push('');
      continue;
    }
    if (e.kind === 'assistant') {
      const tag = e.streaming ? 'aldo (in-flight)' : 'aldo';
      lines.push(`## ${tag}`, '');
      lines.push(e.content.length > 0 ? e.content : '_(no text)_');
      lines.push('');
      continue;
    }
    if (e.kind === 'tool') {
      const status = e.result === undefined ? 'pending' : e.isError ? 'error' : 'ok';
      lines.push(`### tool · ${e.name} · ${status}`);
      lines.push('');
      lines.push('```json');
      lines.push(safeJson(e.args));
      lines.push('```');
      if (e.result !== undefined) {
        lines.push('');
        lines.push('```json');
        lines.push(safeJson(e.result));
        lines.push('```');
      }
      lines.push('');
      continue;
    }
    if (e.kind === 'system') {
      lines.push('### system', '');
      lines.push(e.content);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function safeJson(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
