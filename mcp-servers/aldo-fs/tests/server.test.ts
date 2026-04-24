import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAcl } from '../src/acl.js';
import { createMeridianFsServer } from '../src/server.js';

let rw = '';
let acl: ReturnType<typeof createAcl>;
let client: Client;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'aldo-fs-server-'));
  rw = join(base, 'rw');
  await mkdir(rw, { recursive: true });
  await writeFile(join(rw, 'greeting.txt'), 'salutations');
  acl = createAcl([{ path: rw, mode: 'rw' }]);

  const server = createMeridianFsServer({ acl });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: 'aldo-fs-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
});

describe('aldo-fs MCP server', () => {
  it('lists the v0 tools via tools/list', async () => {
    const r = await client.listTools();
    const names = r.tools.map((t) => t.name).sort();
    expect(names).toEqual(['fs.list', 'fs.read', 'fs.search', 'fs.stat', 'fs.write']);
  });

  it('fs.read via tools/call returns structuredContent', async () => {
    const r = await client.callTool({
      name: 'fs.read',
      arguments: { path: join(rw, 'greeting.txt'), encoding: 'utf8' },
    });
    expect(r.isError).not.toBe(true);
    const sc = r.structuredContent as { content: string; bytes: number };
    expect(sc?.content).toBe('salutations');
    expect(sc?.bytes).toBe('salutations'.length);
  });

  it('fs.read returns isError for path outside root with code in text body', async () => {
    const r = await client.callTool({
      name: 'fs.read',
      arguments: { path: '/etc/passwd', encoding: 'utf8' },
    });
    expect(r.isError).toBe(true);
    const content = r.content as Array<{ type: string; text: string }>;
    const first = content[0];
    if (!first) throw new Error('expected at least one content entry');
    const body = JSON.parse(first.text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('OUT_OF_BOUNDS');
  });

  it('fs.write + fs.read round trip through the MCP transport', async () => {
    const path = join(rw, 'mcp-roundtrip.txt');
    const w = await client.callTool({
      name: 'fs.write',
      arguments: {
        path,
        content: 'mcp says hi',
        encoding: 'utf8',
        createDirs: true,
        overwrite: true,
      },
    });
    expect(w.isError).not.toBe(true);

    const r = await client.callTool({
      name: 'fs.read',
      arguments: { path, encoding: 'utf8' },
    });
    expect(r.isError).not.toBe(true);
    const sc = r.structuredContent as { content: string };
    expect(sc.content).toBe('mcp says hi');
  });
});
