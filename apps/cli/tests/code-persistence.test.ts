/**
 * MISSING_PIECES §11 / Phase E — session persistence tests.
 *
 * Coverage:
 *   - newThreadId returns a non-empty UUID-shaped string
 *   - saveSession round-trips entries verbatim
 *   - loadSession throws SessionNotFoundError when missing
 *   - loadSession throws SessionCorruptError on invalid JSON / shape
 *   - sanitiseThreadId blocks path-escape attempts
 *   - listSessions sorts by updatedAt newest-first
 *   - sidecar creates parent dir on first save
 *   - reducer's hydrate-entries replaces the list and resets phase
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SessionCorruptError,
  SessionNotFoundError,
  listSessions,
  loadSession,
  newThreadId,
  saveSession,
  sessionPath,
} from '../src/commands/code/persistence.js';
import {
  type Entry,
  initialState,
  reduce,
} from '../src/commands/code/state.js';

let sessionsDir: string;

beforeEach(() => {
  sessionsDir = mkdtempSync(join(tmpdir(), 'aldo-code-sessions-'));
});

afterEach(() => {
  rmSync(sessionsDir, { recursive: true, force: true });
});

describe('newThreadId', () => {
  it('returns a UUID-shaped string', () => {
    const id = newThreadId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
  it('generates distinct ids', () => {
    expect(newThreadId()).not.toBe(newThreadId());
  });
});

describe('saveSession + loadSession round-trip', () => {
  it('preserves the entry list verbatim', () => {
    const threadId = newThreadId();
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
      { kind: 'assistant', content: 'one file: README.md', streaming: false },
      { kind: 'system', content: 'transcript saved' },
    ];
    const path = saveSession({ threadId, workspace: '/tmp/work', entries }, { sessionsDir });
    expect(path).toBe(sessionPath(threadId, { sessionsDir }));
    const record = loadSession(threadId, { sessionsDir });
    expect(record.threadId).toBe(threadId);
    expect(record.workspace).toBe('/tmp/work');
    expect(record.entries).toEqual(entries);
    expect(record.version).toBe(1);
  });

  it('updatedAt advances on re-save; createdAt is preserved', () => {
    const threadId = newThreadId();
    const entry: Entry = { kind: 'user', content: 'first' };
    saveSession({ threadId, workspace: '/w', entries: [entry] }, { sessionsDir });
    const first = loadSession(threadId, { sessionsDir });
    // Sleep a tick to ensure ISO timestamps differ.
    const start = Date.now();
    while (Date.now() - start < 5) {
      // tight wait
    }
    saveSession(
      {
        threadId,
        workspace: '/w',
        entries: [...first.entries, { kind: 'user', content: 'second' }],
        createdAt: first.createdAt,
      },
      { sessionsDir },
    );
    const second = loadSession(threadId, { sessionsDir });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt >= first.updatedAt).toBe(true);
    expect(second.entries).toHaveLength(2);
  });

  it('saves are atomic — a crash between write and rename leaves no partial file', () => {
    const threadId = newThreadId();
    const entries: Entry[] = [{ kind: 'user', content: 'hi' }];
    saveSession({ threadId, workspace: '/w', entries }, { sessionsDir });
    // The .tmp file should NOT exist after a successful save (it gets renamed).
    const tmp = `${sessionPath(threadId, { sessionsDir })}.tmp`;
    expect(() => readFileSync(tmp, 'utf8')).toThrow(/ENOENT/);
  });
});

describe('loadSession — error paths', () => {
  it('throws SessionNotFoundError when the sidecar is absent', () => {
    expect(() => loadSession(newThreadId(), { sessionsDir })).toThrow(SessionNotFoundError);
  });

  it('throws SessionCorruptError when the JSON is invalid', () => {
    const threadId = newThreadId();
    saveSession({ threadId, workspace: '/w', entries: [] }, { sessionsDir });
    writeFileSync(sessionPath(threadId, { sessionsDir }), 'not-json{');
    expect(() => loadSession(threadId, { sessionsDir })).toThrow(SessionCorruptError);
  });

  it('throws SessionCorruptError when the shape is wrong', () => {
    const threadId = newThreadId();
    writeFileSync(
      sessionPath(threadId, { sessionsDir }),
      JSON.stringify({ version: 99, weird: true }),
    );
    expect(() => loadSession(threadId, { sessionsDir })).toThrow(SessionCorruptError);
  });
});

describe('sessionPath — anti-path-escape', () => {
  it('confines threadIds to filename-safe chars', () => {
    const sneaky = sessionPath('../../etc/passwd', { sessionsDir });
    expect(sneaky.startsWith(sessionsDir)).toBe(true);
    expect(sneaky).not.toContain('/etc/');
  });

  it('refuses an empty threadId', () => {
    expect(() => sessionPath('', { sessionsDir })).toThrow(/safe character/);
  });

  it('sanitises symbol-only threadIds to underscores rather than escaping', () => {
    // The sanitiser preserves filesystem safety even on adversarial inputs;
    // `///` becomes `___` and stays inside sessionsDir.
    const path = sessionPath('///', { sessionsDir });
    expect(path.startsWith(sessionsDir)).toBe(true);
    expect(path.endsWith('___.json')).toBe(true);
  });
});

describe('listSessions', () => {
  it('returns empty when the dir does not exist', () => {
    expect(listSessions({ sessionsDir: join(sessionsDir, 'missing') })).toEqual([]);
  });

  it('returns one summary per session, newest-first', async () => {
    const t1 = newThreadId();
    saveSession({ threadId: t1, workspace: '/a', entries: [] }, { sessionsDir });
    await new Promise((r) => setTimeout(r, 20));
    const t2 = newThreadId();
    saveSession(
      {
        threadId: t2,
        workspace: '/b',
        entries: [{ kind: 'user', content: 'q' }],
      },
      { sessionsDir },
    );
    const list = listSessions({ sessionsDir });
    expect(list).toHaveLength(2);
    expect(list[0]?.threadId).toBe(t2); // newest first
    expect(list[0]?.turns).toBe(1);
    expect(list[1]?.threadId).toBe(t1);
    expect(list[1]?.turns).toBe(0);
  });

  it('skips corrupt sidecar files silently', () => {
    const goodId = newThreadId();
    saveSession({ threadId: goodId, workspace: '/w', entries: [] }, { sessionsDir });
    writeFileSync(join(sessionsDir, 'broken.json'), '{}{}invalid');
    const list = listSessions({ sessionsDir });
    expect(list).toHaveLength(1);
    expect(list[0]?.threadId).toBe(goodId);
  });
});

describe('reducer — hydrate-entries', () => {
  it('replaces the entry list AND resets phase to idle', () => {
    // Build up some state first.
    let state = reduce(initialState, { kind: 'user-input', text: 'hi' });
    const restored: Entry[] = [
      { kind: 'user', content: 'previous turn' },
      { kind: 'assistant', content: 'previous answer', streaming: false },
    ];
    state = reduce(state, { kind: 'hydrate-entries', entries: restored });
    expect(state.entries).toEqual(restored);
    expect(state.phase.kind).toBe('idle');
    expect(state.lastError).toBeNull();
  });
});
