/**
 * MISSING_PIECES §11 / Phase D — slash command parser + transcript renderer tests.
 *
 * Pure tests, no ink. Coverage:
 *   - parser: every command, aliases, unknown, missing-arg, no-leading-/
 *   - help text contains every command name
 *   - transcript renderer round-trips a representative session
 *   - reducer's new system-info action appends a SystemEntry
 */

import { describe, expect, it } from 'vitest';
import {
  HELP_TEXT,
  parseSlashCommand,
  renderTranscriptMarkdown,
} from '../src/commands/code/slash-commands.js';
import {
  type Entry,
  initialState,
  reduce,
} from '../src/commands/code/state.js';

describe('parseSlashCommand', () => {
  it('returns null for non-slash input (caller falls through to user-input)', () => {
    expect(parseSlashCommand('hello there')).toBeNull();
    expect(parseSlashCommand('  hello')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
  });

  it('parses /help (and the ? alias)', () => {
    expect(parseSlashCommand('/help')).toEqual({ kind: 'help' });
    expect(parseSlashCommand('/?')).toEqual({ kind: 'help' });
    expect(parseSlashCommand('  /help  ')).toEqual({ kind: 'help' });
  });

  it('parses /clear and /reset alias', () => {
    expect(parseSlashCommand('/clear')).toEqual({ kind: 'clear' });
    expect(parseSlashCommand('/reset')).toEqual({ kind: 'clear' });
  });

  it('parses /exit, /quit, /q', () => {
    expect(parseSlashCommand('/exit')).toEqual({ kind: 'exit' });
    expect(parseSlashCommand('/quit')).toEqual({ kind: 'exit' });
    expect(parseSlashCommand('/q')).toEqual({ kind: 'exit' });
  });

  it('parses /save with a path arg', () => {
    expect(parseSlashCommand('/save transcript.md')).toEqual({
      kind: 'save',
      path: 'transcript.md',
    });
    expect(parseSlashCommand('/save /tmp/aldo.md')).toEqual({
      kind: 'save',
      path: '/tmp/aldo.md',
    });
  });

  it('/save without a path returns unknown (forces an explicit error path)', () => {
    expect(parseSlashCommand('/save')).toEqual({
      kind: 'unknown',
      raw: '/save',
    });
  });

  it('parses /model and /tools (read-only commands)', () => {
    expect(parseSlashCommand('/model')).toEqual({ kind: 'model' });
    expect(parseSlashCommand('/tools')).toEqual({ kind: 'tools' });
  });

  it('is case-insensitive on the command name', () => {
    expect(parseSlashCommand('/HELP')).toEqual({ kind: 'help' });
    expect(parseSlashCommand('/Save foo.md')).toEqual({ kind: 'save', path: 'foo.md' });
  });

  it('returns unknown for typos / unrecognised commands', () => {
    expect(parseSlashCommand('/heelp')).toEqual({ kind: 'unknown', raw: '/heelp' });
    expect(parseSlashCommand('/   ')).toEqual({ kind: 'unknown', raw: '/' });
  });
});

describe('HELP_TEXT', () => {
  it('contains every supported command + key keybind', () => {
    for (const name of ['/help', '/clear', '/save', '/model', '/tools', '/exit']) {
      expect(HELP_TEXT).toContain(name);
    }
    expect(HELP_TEXT).toContain('Ctrl+C');
    expect(HELP_TEXT).toContain('Ctrl+D');
    expect(HELP_TEXT).toContain('approve');
  });
});

describe('renderTranscriptMarkdown', () => {
  it('returns a placeholder section for an empty transcript', () => {
    const md = renderTranscriptMarkdown([]);
    expect(md).toContain('# aldo code transcript');
    expect(md).toContain('empty session');
  });

  it('renders user, assistant, tool, and system entries with the right headings', () => {
    const entries: Entry[] = [
      { kind: 'user', content: 'list /workspace' },
      {
        kind: 'tool',
        callId: 'c1',
        name: 'aldo-fs.fs.list',
        args: { path: '.' },
        result: { entries: [{ name: 'README.md' }] },
        isError: false,
      },
      { kind: 'assistant', content: 'two files: README.md and src/.', streaming: false },
      { kind: 'system', content: 'transcript saved to /tmp/x.md' },
    ];
    const md = renderTranscriptMarkdown(entries);
    expect(md).toContain('## you');
    expect(md).toContain('list /workspace');
    expect(md).toContain('### tool · aldo-fs.fs.list · ok');
    expect(md).toContain('"path": "."');
    expect(md).toContain('"name": "README.md"');
    expect(md).toContain('## aldo');
    expect(md).toContain('two files');
    expect(md).toContain('### system');
    expect(md).toContain('transcript saved to /tmp/x.md');
  });

  it('marks pending tool calls (no result) and errored ones distinctly', () => {
    const entries: Entry[] = [
      {
        kind: 'tool',
        callId: 'p',
        name: 'shell.exec',
        args: {},
        result: undefined,
        isError: false,
      },
      {
        kind: 'tool',
        callId: 'e',
        name: 'shell.exec',
        args: {},
        result: { exitCode: 1 },
        isError: true,
      },
    ];
    const md = renderTranscriptMarkdown(entries);
    expect(md).toContain('· pending');
    expect(md).toContain('· error');
  });

  it('marks an in-flight assistant entry distinctly', () => {
    const md = renderTranscriptMarkdown([
      { kind: 'assistant', content: 'partial', streaming: true },
    ]);
    expect(md).toContain('aldo (in-flight)');
  });

  it('uses an explicit placeholder when an assistant entry has no text', () => {
    const md = renderTranscriptMarkdown([
      { kind: 'assistant', content: '', streaming: false },
    ]);
    expect(md).toContain('_(no text)_');
  });
});

describe('reducer — system-info action', () => {
  it('appends a system entry without disturbing any in-flight phase', () => {
    const state = reduce(initialState, {
      kind: 'system-info',
      content: 'hello from /help',
    });
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toEqual({
      kind: 'system',
      content: 'hello from /help',
    });
    expect(state.phase.kind).toBe('idle');
  });

  it('preserves prior entries (system entry just appends)', () => {
    let state = reduce(initialState, { kind: 'user-input', text: 'hi' });
    state = reduce(state, { kind: 'system-info', content: 'note' });
    // user + assistant placeholder + system note = 3 entries.
    expect(state.entries.map((e) => e.kind)).toEqual(['user', 'assistant', 'system']);
  });
});
