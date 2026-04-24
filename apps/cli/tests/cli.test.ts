/**
 * CLI integration tests. We drive `main(argv, { io })` directly and capture
 * stdout / stderr into buffers so we can assert against them. The registry
 * is mocked via `setRegistry` so these tests don't depend on the real
 * `@meridian/registry` package being built.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import type { CliIO } from '../src/io.js';
import { type RegistryLike, setRegistry } from '../src/registry-adapter.js';

function bufferedIO(): { io: CliIO; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s) => {
        out.push(s);
      },
      stderr: (s) => {
        err.push(s);
      },
      isTTY: false,
    },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

/**
 * Minimal mock registry: says "ok" if the YAML contains `name: sample-agent`,
 * otherwise returns a single error. Mirrors the shape the real validator
 * produces so commands don't care.
 */
function mockRegistry(): RegistryLike {
  return {
    validate(text) {
      if (text.includes('name: sample-agent')) {
        return {
          ok: true,
          errors: [],
          spec: {
            apiVersion: 'meridian/agent.v1',
            kind: 'Agent',
            identity: {
              name: 'sample-agent',
              version: '0.1.0',
              description: 'mock',
              owner: 'test',
              tags: [],
            },
            // The rest of AgentSpec is unused by the CLI paths under test;
            // cast through unknown so we don't need the full tree here.
          } as unknown as import('@meridian/types').AgentSpec,
        };
      }
      return {
        ok: false,
        errors: [{ path: 'identity.name', message: 'required' }],
      };
    },
  };
}

const FIXTURES = new URL('./fixtures/', import.meta.url);

describe('meridian cli', () => {
  let tmp: string;

  beforeEach(async () => {
    setRegistry(mockRegistry());
    tmp = await mkdtemp(join(tmpdir(), 'meridian-cli-'));
  });

  afterEach(async () => {
    setRegistry(null);
    await rm(tmp, { recursive: true, force: true });
  });

  it('--help prints usage and exits 0', async () => {
    const { io, out } = bufferedIO();
    const code = await main(['--help'], { io });
    expect(code).toBe(0);
    const text = out();
    expect(text).toContain('meridian');
    expect(text).toContain('Usage:');
    expect(text).toContain('init');
    expect(text).toContain('agent');
  });

  it('no args prints help and exits 0', async () => {
    const { io, out } = bufferedIO();
    const code = await main([], { io });
    expect(code).toBe(0);
    expect(out()).toContain('Usage:');
  });

  it('agent validate succeeds on a valid fixture', async () => {
    const { io, out } = bufferedIO();
    const path = new URL('./valid.yaml', FIXTURES).pathname;
    const code = await main(['agent', 'validate', path], { io });
    expect(code).toBe(0);
    expect(out()).toContain('ok:');
  });

  it('agent validate fails on an invalid fixture and mentions the path', async () => {
    const { io, err } = bufferedIO();
    const path = new URL('./invalid.yaml', FIXTURES).pathname;
    const code = await main(['agent', 'validate', path], { io });
    expect(code).toBe(1);
    const text = err();
    expect(text).toContain(path);
    expect(text).toContain('identity.name');
  });

  it('agent validate --json emits machine-readable output', async () => {
    const { io, out } = bufferedIO();
    const path = new URL('./invalid.yaml', FIXTURES).pathname;
    const code = await main(['agent', 'validate', path, '--json'], { io });
    expect(code).toBe(1);
    const parsed = JSON.parse(out()) as {
      ok: boolean;
      file: string;
      errors: { path: string; message: string }[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.file).toBe(path);
    expect(parsed.errors[0]?.path).toBe('identity.name');
  });

  it('init scaffolds expected files', async () => {
    const { io } = bufferedIO();
    const target = join(tmp, 'proj');
    const code = await main(['init', target], { io });
    expect(code).toBe(0);

    for (const rel of [
      '.meridianrc',
      'agency/.gitkeep',
      'agents/code-reviewer.yaml',
      'prompts/code-reviewer.md',
    ]) {
      const s = await stat(join(target, rel));
      expect(s.isFile()).toBe(true);
    }

    const rc = JSON.parse(await readFile(join(target, '.meridianrc'), 'utf8')) as {
      version: number;
    };
    expect(rc.version).toBe(1);

    const sample = await readFile(join(target, 'agents/code-reviewer.yaml'), 'utf8');
    expect(sample).toContain('name: code-reviewer');
    expect(sample).not.toContain('{{');
  });

  it('agent new writes a YAML file into a custom dir', async () => {
    const { io, out } = bufferedIO();
    const dir = join(tmp, 'agents');
    const code = await main(['agent', 'new', 'my-agent', '--dir', dir, '--owner', 'team-x'], {
      io,
    });
    expect(code).toBe(0);
    expect(out()).toContain(join(dir, 'my-agent.yaml'));
    const text = await readFile(join(dir, 'my-agent.yaml'), 'utf8');
    expect(text).toContain('name: my-agent');
    expect(text).toContain('owner: team-x');
  });

  it('agent new rejects non-kebab names', async () => {
    const { io, err } = bufferedIO();
    const code = await main(['agent', 'new', 'Bad_Name'], { io });
    expect(code).toBe(1);
    expect(err()).toContain('kebab-case');
  });

  it('dev is a stub that exits 2', async () => {
    const { io, err } = bufferedIO();
    const code = await main(['dev'], { io });
    expect(code).toBe(2);
    expect(err()).toContain('not yet implemented');
  });

  it('models ls is a stub that exits 2', async () => {
    const { io, err } = bufferedIO();
    const code = await main(['models', 'ls'], { io });
    expect(code).toBe(2);
    expect(err()).toContain('not yet implemented');
  });

  it('mcp ls is a stub that exits 2', async () => {
    const { io, err } = bufferedIO();
    const code = await main(['mcp', 'ls'], { io });
    expect(code).toBe(2);
    expect(err()).toContain('not yet implemented');
  });

  it('runs ls / runs view are stubs that exit 2', async () => {
    {
      const { io, err } = bufferedIO();
      expect(await main(['runs', 'ls'], { io })).toBe(2);
      expect(err()).toContain('not yet implemented');
    }
    {
      const { io, err } = bufferedIO();
      expect(await main(['runs', 'view', 'r_abc'], { io })).toBe(2);
      expect(err()).toContain('not yet implemented');
    }
  });

  it('agent ls handles a missing agents dir gracefully', async () => {
    const { io, out } = bufferedIO();
    const missing = join(tmp, 'does-not-exist');
    const code = await main(['agent', 'ls', '--dir', missing], { io });
    expect(code).toBe(0);
    expect(out()).toContain('no agents directory');
  });

  it('agent ls lists a valid agent from disk (--json)', async () => {
    const { io: io1 } = bufferedIO();
    const target = join(tmp, 'proj2');
    await main(['init', target], { io: io1 });

    const { io, out } = bufferedIO();
    const code = await main(['agent', 'ls', '--dir', join(target, 'agents'), '--json'], { io });
    expect(code).toBe(0);
    // The seeded agent won't validate via our mock (name: code-reviewer, not
    // sample-agent) so it'll appear with ok=false — what matters is the
    // shape: `{ dir, agents: [...] }`.
    const parsed = JSON.parse(out()) as {
      dir: string;
      agents: { file: string; ok: boolean }[];
    };
    expect(parsed.dir).toBe(join(target, 'agents'));
    expect(parsed.agents).toHaveLength(1);
  });

  it('unknown command exits non-zero', async () => {
    const { io } = bufferedIO();
    const code = await main(['totally-made-up'], { io });
    expect(code).not.toBe(0);
  });
});
