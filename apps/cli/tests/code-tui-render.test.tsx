/**
 * MISSING_PIECES §11 / Phase B — ink-testing-library smoke tests.
 *
 * These tests render Conversation + StatusLine + ToolCall against
 * crafted state snapshots and assert the rendered output contains
 * the right text + glyphs. We don't snapshot the full ink frame
 * (those drift with terminal width), but we do assert structural
 * invariants:
 *   - empty conversation shows the welcome hint
 *   - user + streaming-assistant turns appear with the right glyphs
 *   - tool entries render in-flight ⟳, success ✓, error ✕
 *   - status line tags the active phase
 *
 * The reducer-driven state transitions are already covered by
 * `code-state.test.ts`; these tests focus on the rendering surface.
 */

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { Conversation } from '../src/commands/code/components/Conversation.js';
import { StatusLine } from '../src/commands/code/components/StatusLine.js';
import {
  type Entry,
  type RunPhase,
  type TelemetryRollup,
} from '../src/commands/code/state.js';

const noTelemetry: TelemetryRollup = {
  tokensIn: 0,
  tokensOut: 0,
  usd: 0,
  model: null,
};

describe('Conversation', () => {
  it('shows the welcome hint when no entries', () => {
    const { lastFrame } = render(<Conversation entries={[]} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('Type a brief');
    expect(out).toContain('Ctrl+D');
  });

  it('renders user and streaming-assistant entries with the right glyphs', () => {
    const entries: Entry[] = [
      { kind: 'user', content: 'list /workspace' },
      { kind: 'assistant', content: '', streaming: true },
    ];
    const { lastFrame } = render(<Conversation entries={entries} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('you');
    expect(out).toContain('list /workspace');
    expect(out).toContain('aldo');
    expect(out).toContain('◇'); // streaming marker
  });

  it('renders a finished assistant entry with the solid marker', () => {
    const entries: Entry[] = [
      { kind: 'user', content: 'hi' },
      { kind: 'assistant', content: 'all done', streaming: false },
    ];
    const { lastFrame } = render(<Conversation entries={entries} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('◆');
    expect(out).toContain('all done');
  });

  it('renders an in-flight tool call with the spinner glyph', () => {
    const entries: Entry[] = [
      { kind: 'user', content: 'go' },
      {
        kind: 'tool',
        callId: 'c1',
        name: 'aldo-fs.fs.read',
        args: { path: 'README.md' },
        result: undefined,
        isError: false,
      },
      { kind: 'assistant', content: '', streaming: true },
    ];
    const { lastFrame } = render(<Conversation entries={entries} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('⟳');
    expect(out).toContain('aldo-fs.fs.read');
    expect(out).toContain('README.md');
  });

  it('renders a successful tool call with ✓ + a result preview', () => {
    const entries: Entry[] = [
      {
        kind: 'tool',
        callId: 'c1',
        name: 'aldo-shell.shell.exec',
        args: { cmd: 'pnpm typecheck' },
        result: { exitCode: 0, stdout: 'tsc OK\n' },
        isError: false,
      },
    ];
    const { lastFrame } = render(<Conversation entries={entries} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('✓');
    expect(out).toContain('aldo-shell.shell.exec');
    expect(out).toContain('exit 0');
  });

  it('renders a failed tool call with ✕ glyph', () => {
    const entries: Entry[] = [
      {
        kind: 'tool',
        callId: 'c1',
        name: 'aldo-shell.shell.exec',
        args: { cmd: 'false' },
        result: { exitCode: 1, stderr: 'fail' },
        isError: true,
      },
    ];
    const { lastFrame } = render(<Conversation entries={entries} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('✕');
    expect(out).toContain('exit 1');
  });
});

describe('StatusLine', () => {
  it('idle phase reads "[idle]"', () => {
    const { lastFrame } = render(
      <StatusLine phase={{ kind: 'idle' }} telemetry={noTelemetry} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('[idle]');
    expect(out).toContain('no model yet');
  });

  it('running phase shows cycle and maxCycles', () => {
    const phase: RunPhase = { kind: 'running', cycle: 3, maxCycles: 50 };
    const { lastFrame } = render(<StatusLine phase={phase} telemetry={noTelemetry} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('cycle 3/50');
  });

  it('compressing phase mentions the strategy', () => {
    const phase: RunPhase = {
      kind: 'compressing',
      cycle: 4,
      strategy: 'rolling-window',
    };
    const { lastFrame } = render(<StatusLine phase={phase} telemetry={noTelemetry} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('compress');
    expect(out).toContain('rolling-window');
  });

  it('awaiting-approval phase highlights the gated tool', () => {
    const phase: RunPhase = {
      kind: 'awaiting-approval',
      callId: 'c1',
      tool: 'aldo-shell.shell.exec',
    };
    const { lastFrame } = render(<StatusLine phase={phase} telemetry={noTelemetry} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('approve?');
    expect(out).toContain('aldo-shell.shell.exec');
  });

  it('completed phase shows total cycle count', () => {
    const phase: RunPhase = {
      kind: 'completed',
      cycles: 7,
      terminatedBy: null,
    };
    const { lastFrame } = render(<StatusLine phase={phase} telemetry={noTelemetry} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('done');
    expect(out).toContain('7 cycles');
  });

  it('errored phase truncates long error messages', () => {
    const long = 'x'.repeat(200);
    const phase: RunPhase = { kind: 'errored', message: long };
    const { lastFrame } = render(<StatusLine phase={phase} telemetry={noTelemetry} />);
    const out = lastFrame() ?? '';
    expect(out).toContain('error:');
    expect(out).toContain('…');
  });

  it('telemetry rollup renders tokens + USD with 4 decimals', () => {
    const tel: TelemetryRollup = {
      tokensIn: 250,
      tokensOut: 50,
      usd: 0.012345,
      model: 'claude-sonnet-4-6',
    };
    const { lastFrame } = render(
      <StatusLine phase={{ kind: 'idle' }} telemetry={tel} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('claude-sonnet-4-6');
    expect(out).toContain('250/50 tok');
    expect(out).toContain('$0.0123');
  });
});
