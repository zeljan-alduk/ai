import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPolicy } from '../src/policy.js';
import { createAldoShellServer } from '../src/server.js';

let root = '';
let client: Client;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-shell-server-')));
  await writeFile(join(root, 'hello.js'), "process.stdout.write('hi');\n");
  const policy = createPolicy({
    allowedRoots: [root],
    allowedCommands: ['node'],
    defaultTimeoutMs: 10_000,
    maxTimeoutMs: 30_000,
  });
  const server = createAldoShellServer({ policy });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'aldo-shell-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
});

describe('aldo-shell MCP server', () => {
  it('lists shell.exec via tools/list', async () => {
    const r = await client.listTools();
    const names = r.tools.map((t) => t.name).sort();
    expect(names).toEqual(['shell.exec']);
  });

  it('shell.exec round trip via the MCP transport', async () => {
    const r = await client.callTool({
      name: 'shell.exec',
      arguments: { command: 'node', args: ['hello.js'], cwd: root },
    });
    expect(r.isError).not.toBe(true);
    const sc = r.structuredContent as {
      exitCode: number;
      stdout: string;
      timedOut: boolean;
    };
    expect(sc.exitCode).toBe(0);
    expect(sc.stdout).toBe('hi');
    expect(sc.timedOut).toBe(false);
  });

  it('returns isError envelope when policy rejects the command', async () => {
    const r = await client.callTool({
      name: 'shell.exec',
      arguments: { command: 'rm', args: ['-rf', root], cwd: root },
    });
    expect(r.isError).toBe(true);
    const content = r.content as Array<{ type: 'text'; text: string }> | undefined;
    const first = content?.[0];
    if (!first) throw new Error('expected at least one content entry');
    const body = JSON.parse(first.text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('PERMISSION_DENIED');
  });
});
