// Credential storage. The token lives in VS Code's `SecretStorage`
// (OS keychain on macOS/Windows, libsecret on Linux). The base URL is
// non-secret and lives in workspace settings so different projects can
// point at different ALDO instances (e.g. local dev vs. prod).
import * as vscode from 'vscode';

export const SECRET_KEY_TOKEN = 'aldoAi.token';

export interface Credentials {
  apiBaseUrl: string;
  token: string;
}

export async function readCredentials(ctx: vscode.ExtensionContext): Promise<Credentials | null> {
  const cfg = vscode.workspace.getConfiguration('aldoAi');
  const apiBaseUrl = cfg.get<string>('apiBaseUrl', '').trim();
  const token = (await ctx.secrets.get(SECRET_KEY_TOKEN)) ?? '';
  if (!apiBaseUrl || !token) return null;
  return { apiBaseUrl, token };
}

export async function writeCredentials(
  ctx: vscode.ExtensionContext,
  creds: Credentials,
): Promise<void> {
  await vscode.workspace
    .getConfiguration('aldoAi')
    .update('apiBaseUrl', creds.apiBaseUrl, vscode.ConfigurationTarget.Global);
  await ctx.secrets.store(SECRET_KEY_TOKEN, creds.token);
}

export async function clearCredentials(ctx: vscode.ExtensionContext): Promise<void> {
  await ctx.secrets.delete(SECRET_KEY_TOKEN);
}
