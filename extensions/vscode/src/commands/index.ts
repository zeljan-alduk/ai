// Command registry. Each command is a closure over the shared
// extension state — credentials + the API client factory — so they
// can be unit-tested by passing a stub.
//
// The extension is intentionally LLM-agnostic: every command goes
// through the platform API. We never name a provider, never carry a
// model id, never construct a prompt that assumes a specific tokenizer.
import * as vscode from 'vscode';
import type { ApiClient } from '../api/client.js';
import {
  type Credentials,
  clearCredentials,
  readCredentials,
  writeCredentials,
} from '../api/credentials.js';
import { openRunOutputPanel } from '../webview/run-output.js';
import { openTraceWebview } from '../webview/trace.js';

export interface CommandDeps {
  ctx: vscode.ExtensionContext;
  /** Returns null when the user is not logged in. */
  getClient: () => ApiClient | null;
  refreshAll: () => void;
  setStatusBarText: (text: string) => void;
}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const subs: vscode.Disposable[] = [];
  subs.push(
    vscode.commands.registerCommand('aldoAi.login', () => loginCommand(deps)),
    vscode.commands.registerCommand('aldoAi.logout', () => logoutCommand(deps)),
    vscode.commands.registerCommand('aldoAi.refresh', () => deps.refreshAll()),
    vscode.commands.registerCommand('aldoAi.runOnSelection', (agentName?: string) =>
      runOnEditorCommand(deps, 'selection', agentName),
    ),
    vscode.commands.registerCommand('aldoAi.runOnFile', (agentName?: string) =>
      runOnEditorCommand(deps, 'file', agentName),
    ),
    vscode.commands.registerCommand('aldoAi.openRunInBrowser', (runId?: string) =>
      openRunInBrowserCommand(deps, runId),
    ),
    vscode.commands.registerCommand('aldoAi.openTraceInline', (runId?: string) =>
      openTraceInlineCommand(deps, runId),
    ),
    vscode.commands.registerCommand('aldoAi.quickPrompt', () => quickPromptCommand(deps)),
  );
  return subs;
}

// --- login / logout ----------------------------------------------------

export async function loginCommand(deps: CommandDeps): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('aldoAi');
  const apiBaseUrl = await vscode.window.showInputBox({
    prompt: 'ALDO AI API base URL',
    value: cfg.get<string>('apiBaseUrl', 'https://ai.aldo.tech'),
    validateInput: (v) => (/^https?:\/\//.test(v) ? null : 'must start with http:// or https://'),
  });
  if (!apiBaseUrl) return;

  const token = await vscode.window.showInputBox({
    prompt: 'API token (from /settings/api-keys)',
    password: true,
    validateInput: (v) => (v && v.length > 0 ? null : 'token is required'),
  });
  if (!token) return;

  const creds: Credentials = { apiBaseUrl, token };
  await writeCredentials(deps.ctx, creds);
  vscode.window.showInformationMessage('ALDO AI: signed in.');
  const tenantSlug = cfg.get<string>('tenantSlug', '') || 'connected';
  deps.setStatusBarText(`ALDO AI: ${tenantSlug}`);
  deps.refreshAll();
}

export async function logoutCommand(deps: CommandDeps): Promise<void> {
  await clearCredentials(deps.ctx);
  vscode.window.showInformationMessage('ALDO AI: signed out.');
  deps.setStatusBarText('ALDO AI: signed out');
  deps.refreshAll();
}

// --- run on selection / file ------------------------------------------

async function runOnEditorCommand(
  deps: CommandDeps,
  mode: 'selection' | 'file',
  presetAgent?: string,
): Promise<void> {
  const client = deps.getClient();
  if (!client) {
    await loginCommand(deps);
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('ALDO AI: open a file first.');
    return;
  }
  const text =
    mode === 'selection' && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : editor.document.getText();
  if (!text.trim()) {
    vscode.window.showErrorMessage('ALDO AI: nothing to send (empty input).');
    return;
  }

  const agentName = presetAgent ?? (await pickAgent(client));
  if (!agentName) return;

  const filename = editor.document.fileName;
  const input = `# file: ${filename}\n\n${text}`;
  let run: { id: string; status: string };
  try {
    run = await client.createRun(agentName, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`ALDO AI: ${msg}`);
    return;
  }

  const out = openRunOutputPanel(agentName, run.id);
  out.setStatus(run.status);
  out.log(`> sent ${text.length} chars from ${filename}`);
  out.log(`> run ${run.id} ${run.status}`);
  deps.refreshAll();
}

async function pickAgent(client: ApiClient): Promise<string | undefined> {
  const agents = await client.listAgents();
  if (agents.length === 0) {
    vscode.window.showErrorMessage('ALDO AI: no agents in this tenant.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    agents.map((a) => ({
      label: a.name,
      description: a.privacyTier ?? '',
      detail: a.description ?? '',
    })),
    { placeHolder: 'Pick an agent' },
  );
  return pick?.label;
}

// --- open run in browser ----------------------------------------------

export async function openRunInBrowserCommand(deps: CommandDeps, runId?: string): Promise<void> {
  const id = runId ?? (await vscode.window.showInputBox({ prompt: 'Run id' }));
  if (!id) return;
  const cfg = vscode.workspace.getConfiguration('aldoAi');
  const webBase = cfg
    .get<string>('webBaseUrl', 'https://ai.aldo.tech')
    .replace(/\/+$/, '');
  await vscode.env.openExternal(vscode.Uri.parse(`${webBase}/runs/${id}`));
}

// --- open trace inline ------------------------------------------------

async function openTraceInlineCommand(deps: CommandDeps, runId?: string): Promise<void> {
  const client = deps.getClient();
  if (!client) {
    await loginCommand(deps);
    return;
  }
  const id = runId ?? (await vscode.window.showInputBox({ prompt: 'Run id' }));
  if (!id) return;
  await openTraceWebview(deps.ctx, client, id);
}

// --- quick prompt -----------------------------------------------------

async function quickPromptCommand(deps: CommandDeps): Promise<void> {
  const client = deps.getClient();
  if (!client) {
    await loginCommand(deps);
    return;
  }
  const agentName = await pickAgent(client);
  if (!agentName) return;
  const input = await vscode.window.showInputBox({
    prompt: 'Prompt',
    placeHolder: 'Ask the agent…',
  });
  if (!input) return;
  try {
    const result = await client.playgroundRun({ agentName, input });
    const doc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: formatPlaygroundResult(agentName, input, result),
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`ALDO AI: ${msg}`);
  }
}

export function formatPlaygroundResult(agentName: string, input: string, result: unknown): string {
  return [
    `# ALDO AI · ${agentName}`,
    '',
    '## Prompt',
    '',
    '```',
    input,
    '```',
    '',
    '## Result',
    '',
    '```json',
    JSON.stringify(result, null, 2),
    '```',
    '',
  ].join('\n');
}
