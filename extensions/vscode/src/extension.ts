// VS Code extension entry point. Wires the API client, sidebar trees,
// commands, status bar item, and code-action provider together.
//
// Per CLAUDE.md: this is a thin client. It never calls an LLM
// directly — every action goes through the platform API which
// enforces privacy tiers and routes through the gateway. Switching
// providers is a config change in the platform, never in this code.
import * as vscode from 'vscode';
import { ApiClient } from './api/client.js';
import { readCredentials } from './api/credentials.js';
import { registerCommands } from './commands/index.js';
import { AgentsTreeProvider } from './views/agents-tree.js';
import { AldoCodeActionProvider } from './views/code-actions.js';
import { ModelsTreeProvider } from './views/models-tree.js';
import { RunsTreeProvider } from './views/runs-tree.js';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  let cachedClient: ApiClient | null = null;

  const refreshClient = async (): Promise<void> => {
    const creds = await readCredentials(ctx);
    cachedClient = creds ? new ApiClient({ baseUrl: creds.apiBaseUrl, token: creds.token }) : null;
  };
  await refreshClient();

  const getClient = (): ApiClient | null => cachedClient;

  // --- sidebar ---
  const agentsTree = new AgentsTreeProvider(getClient);
  const runsTree = new RunsTreeProvider(getClient);
  const modelsTree = new ModelsTreeProvider(getClient);
  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider('aldoAi.agents', agentsTree),
    vscode.window.registerTreeDataProvider('aldoAi.runs', runsTree),
    vscode.window.registerTreeDataProvider('aldoAi.models', modelsTree),
  );

  // --- status bar ---
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'aldoAi.login';
  ctx.subscriptions.push(statusBar);
  const setStatusBarText = (text: string): void => {
    statusBar.text = text;
    statusBar.show();
  };
  const renderStatusBar = (): void => {
    const cfg = vscode.workspace.getConfiguration('aldoAi');
    const tenantSlug = cfg.get<string>('tenantSlug', '');
    if (cachedClient) {
      setStatusBarText(`ALDO AI: ${tenantSlug || 'connected'}`);
    } else {
      setStatusBarText('ALDO AI: signed out');
    }
  };
  renderStatusBar();

  const refreshAll = (): void => {
    refreshClient()
      .then(() => {
        renderStatusBar();
        agentsTree.refresh();
        runsTree.refresh();
        modelsTree.refresh();
      })
      .catch((err) => console.error('[aldoAi] refresh failed', err));
  };

  // --- commands ---
  ctx.subscriptions.push(
    ...registerCommands({
      ctx,
      getClient,
      refreshAll,
      setStatusBarText,
    }),
  );

  // --- code actions (lightbulb on TODOs / functions) ---
  ctx.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new AldoCodeActionProvider(getClient),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  // Re-read credentials when settings change so the user can switch
  // tenants without restarting VS Code.
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aldoAi')) refreshAll();
    }),
  );
}

export function deactivate(): void {
  // nothing to clean up — disposables are tracked via ctx.subscriptions
}
