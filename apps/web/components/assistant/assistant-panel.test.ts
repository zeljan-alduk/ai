/**
 * MISSING_PIECES §10 — assistant panel pure-mutator tests.
 *
 * The panel is a `'use client'` React component, but its state-mutator
 * helpers (delta accumulation, tool-tile insertion, finalise/drop) are
 * exported as pure functions. These tests exercise the mutators
 * directly so we can verify the chronological ordering rule
 * ("user → tool → assistant text") without standing up the full
 * React + JSDOM harness.
 */

import { describe, expect, it } from 'vitest';
import {
  type ChatMessage,
  type Entry,
  type ToolMessage,
  dropStreamingPlaceholder,
  finaliseStreamingAssistant,
  insertToolBeforePlaceholder,
  updateStreamingAssistant,
} from './assistant-panel.js';

const userMsg = (content: string): ChatMessage => ({
  kind: 'message',
  role: 'user',
  content,
});

const placeholder = (): ChatMessage => ({
  kind: 'message',
  role: 'assistant',
  content: '',
  streaming: true,
});

const finishedAssistant = (content: string): ChatMessage => ({
  kind: 'message',
  role: 'assistant',
  content,
  streaming: false,
});

const toolTile = (
  callId: string,
  name = 'aldo-fs.fs.read',
  isError = false,
): ToolMessage => ({
  kind: 'tool',
  callId,
  name,
  args: { path: 'README.md' },
  result: { content: 'hi' },
  isError,
});

describe('updateStreamingAssistant', () => {
  it('replaces the streaming placeholder content with the accumulator', () => {
    const initial: Entry[] = [userMsg('hi'), placeholder()];
    const out = updateStreamingAssistant(initial, 'hello there');
    expect(out).toHaveLength(2);
    const last = out[1];
    expect(last?.kind).toBe('message');
    if (last?.kind === 'message') {
      expect(last.content).toBe('hello there');
      expect(last.streaming).toBe(true);
    }
  });

  it('is a no-op when there is no streaming placeholder at the end', () => {
    const initial: Entry[] = [userMsg('hi'), finishedAssistant('done')];
    const out = updateStreamingAssistant(initial, 'noise');
    expect(out).toEqual(initial);
  });

  it('returns a NEW array (no mutation of the caller)', () => {
    const initial: Entry[] = [userMsg('hi'), placeholder()];
    const out = updateStreamingAssistant(initial, 'x');
    expect(out).not.toBe(initial);
  });
});

describe('insertToolBeforePlaceholder', () => {
  it('inserts the tool tile between the user message and the streaming placeholder', () => {
    const initial: Entry[] = [userMsg('hi'), placeholder()];
    const out = insertToolBeforePlaceholder(initial, toolTile('c1'));
    expect(out.map((e) => e.kind)).toEqual(['message', 'tool', 'message']);
    expect((out[2] as ChatMessage).streaming).toBe(true);
  });

  it('appends the tool tile when no streaming placeholder is at the end', () => {
    const initial: Entry[] = [userMsg('hi'), finishedAssistant('done')];
    const out = insertToolBeforePlaceholder(initial, toolTile('c1'));
    expect(out.map((e) => e.kind)).toEqual(['message', 'message', 'tool']);
  });

  it('preserves chronological ordering across multiple tool calls', () => {
    let entries: Entry[] = [userMsg('list /workspace'), placeholder()];
    entries = insertToolBeforePlaceholder(entries, toolTile('c1', 'aldo-fs.fs.list'));
    entries = insertToolBeforePlaceholder(entries, toolTile('c2', 'aldo-fs.fs.read'));
    expect(entries.map((e) => (e.kind === 'tool' ? e.callId : e.role))).toEqual([
      'user',
      'c1',
      'c2',
      'assistant',
    ]);
  });
});

describe('finaliseStreamingAssistant', () => {
  it('drops the streaming flag and attaches meta', () => {
    const initial: Entry[] = [userMsg('hi'), placeholder()];
    const meta = { model: 'claude-sonnet-4-6', tokensIn: 200, tokensOut: 50, latencyMs: 1234 };
    const out = finaliseStreamingAssistant(initial, 'final answer', meta);
    const last = out[1] as ChatMessage;
    expect(last.streaming).toBe(false);
    expect(last.content).toBe('final answer');
    expect(last.meta).toEqual(meta);
  });

  it('preserves prior tool tiles in the entry list', () => {
    const initial: Entry[] = [
      userMsg('list it'),
      toolTile('c1'),
      placeholder(),
    ];
    const out = finaliseStreamingAssistant(initial, 'here you go', undefined);
    expect(out.map((e) => e.kind)).toEqual(['message', 'tool', 'message']);
    expect((out[2] as ChatMessage).streaming).toBe(false);
  });

  it('preserves the placeholder content when accumulator is empty', () => {
    const initial: Entry[] = [userMsg('hi'), { ...placeholder(), content: 'partial' }];
    const out = finaliseStreamingAssistant(initial, '', undefined);
    expect((out[1] as ChatMessage).content).toBe('partial');
  });
});

describe('dropStreamingPlaceholder', () => {
  it('removes the trailing streaming placeholder', () => {
    const initial: Entry[] = [userMsg('hi'), placeholder()];
    const out = dropStreamingPlaceholder(initial);
    expect(out).toEqual([userMsg('hi')]);
  });

  it('is a no-op when nothing is streaming', () => {
    const initial: Entry[] = [userMsg('hi'), finishedAssistant('done')];
    expect(dropStreamingPlaceholder(initial)).toEqual(initial);
  });

  it('preserves earlier tool tiles in the entry list (only the placeholder is dropped)', () => {
    const initial: Entry[] = [userMsg('hi'), toolTile('c1'), placeholder()];
    const out = dropStreamingPlaceholder(initial);
    expect(out).toEqual([userMsg('hi'), toolTile('c1')]);
  });
});
