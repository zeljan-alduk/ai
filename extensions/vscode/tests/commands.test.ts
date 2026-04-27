import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { ApiClient } from '../src/api/client.js';
import { readCredentials } from '../src/api/credentials.js';
import {
  formatPlaygroundResult,
  loginCommand,
  logoutCommand,
  openRunInBrowserCommand,
  registerCommands,
} from '../src/commands/index.js';
import { _makeExtensionContext, _resetVscodeMock } from './vscode-mock.js';

const expectedCommands = [
  'aldoAi.login',
  'aldoAi.logout',
  'aldoAi.refresh',
  'aldoAi.runOnSelection',
  'aldoAi.runOnFile',
  'aldoAi.openRunInBrowser',
  'aldoAi.openTraceInline',
  'aldoAi.quickPrompt',
];

describe('command registration', () => {
  beforeEach(() => {
    _resetVscodeMock();
  });

  it('registers all advertised commands', () => {
    const ctx = _makeExtensionContext() as unknown as vscode.ExtensionContext;
    let statusText = '';
    registerCommands({
      ctx,
      getClient: () => null,
      refreshAll: () => {},
      setStatusBarText: (t) => {
        statusText = t;
      },
    });
    const registered = (vscode.commands as unknown as { getCommands(): string[] }).getCommands();
    for (const c of expectedCommands) {
      expect(registered, `should register ${c}`).toContain(c);
    }
    expect(statusText).toBe('');
  });

  it('login → secret-storage round-trips and updates status bar', async () => {
    const ctx = _makeExtensionContext() as unknown as vscode.ExtensionContext;
    let statusText = '';
    let refreshes = 0;
    // stub showInputBox: first call → URL, second call → token
    let n = 0;
    (
      vscode.window as unknown as { showInputBox: (o: unknown) => Promise<string | undefined> }
    ).showInputBox = async () => {
      n++;
      return n === 1 ? 'https://api.test' : 'sk-abc';
    };
    await loginCommand({
      ctx,
      getClient: () => null,
      refreshAll: () => {
        refreshes++;
      },
      setStatusBarText: (t) => {
        statusText = t;
      },
    });
    const creds = await readCredentials(ctx);
    expect(creds).toEqual({ apiBaseUrl: 'https://api.test', token: 'sk-abc' });
    expect(statusText).toMatch(/^ALDO AI:/);
    expect(refreshes).toBe(1);
  });

  it('logout clears the secret', async () => {
    const ctx = _makeExtensionContext() as unknown as vscode.ExtensionContext;
    // pre-seed
    await ctx.secrets.store('aldoAi.token', 'sk-abc');
    let statusText = '';
    await logoutCommand({
      ctx,
      getClient: () => null,
      refreshAll: () => {},
      setStatusBarText: (t) => {
        statusText = t;
      },
    });
    expect(await ctx.secrets.get('aldoAi.token')).toBeUndefined();
    expect(statusText).toBe('ALDO AI: signed out');
  });

  it('openRunInBrowser opens the configured web url', async () => {
    const ctx = _makeExtensionContext() as unknown as vscode.ExtensionContext;
    let opened = '';
    (
      vscode.env as unknown as { openExternal: (uri: { toString(): string }) => Promise<boolean> }
    ).openExternal = async (uri) => {
      opened = uri.toString();
      return true;
    };
    // workspace config is read fresh each time
    await vscode.workspace
      .getConfiguration('aldoAi')
      .update('webBaseUrl', 'https://web.example.com');
    await openRunInBrowserCommand(
      {
        ctx,
        getClient: () => null,
        refreshAll: () => {},
        setStatusBarText: () => {},
      },
      'run_xyz',
    );
    expect(opened).toBe('https://web.example.com/runs/run_xyz');
  });

  it('formatPlaygroundResult produces a readable markdown block', () => {
    const md = formatPlaygroundResult('reviewer', 'hi', { ok: true });
    expect(md).toContain('# ALDO AI · reviewer');
    expect(md).toContain('## Prompt');
    expect(md).toContain('## Result');
    expect(md).toContain('"ok": true');
  });
});

describe('status-bar after login', () => {
  beforeEach(() => {
    _resetVscodeMock();
  });

  it('reflects the configured tenant slug after login', async () => {
    const ctx = _makeExtensionContext() as unknown as vscode.ExtensionContext;
    await vscode.workspace.getConfiguration('aldoAi').update('tenantSlug', 'aldo-tech-labs');
    let statusText = '';
    let n = 0;
    (
      vscode.window as unknown as { showInputBox: (o: unknown) => Promise<string | undefined> }
    ).showInputBox = async () => {
      n++;
      return n === 1 ? 'https://api.test' : 'sk-abc';
    };
    await loginCommand({
      ctx,
      getClient: () => null,
      refreshAll: () => {},
      setStatusBarText: (t) => {
        statusText = t;
      },
    });
    expect(statusText).toBe('ALDO AI: aldo-tech-labs');
  });
});

describe('client construction', () => {
  it('builds a working ApiClient from credentials', () => {
    const c = new ApiClient({ baseUrl: 'https://api.test', token: 'tk' });
    expect(c).toBeInstanceOf(ApiClient);
  });
});
