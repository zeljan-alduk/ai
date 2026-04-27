// Code action provider — surfaces "Send to ALDO agent" on TODO
// comments and on function-like declarations across all languages.
// We keep the heuristic deliberately language-agnostic (regex on the
// current line) so it works for any file the user has open. The list
// of agents is sourced from the API so privacy-tier-incompatible
// agents the user can't reach are not even offered.
import * as vscode from 'vscode';
import type { AgentSummary, ApiClient } from '../api/client.js';

const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/i;
const FUNC_RE = /\b(function|def|fn|fun|func|class)\b/;

export class AldoCodeActionProvider implements vscode.CodeActionProvider {
  private cache: { at: number; agents: AgentSummary[] } | null = null;

  constructor(private clientFactory: () => ApiClient | null) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const line = document.lineAt(range.start.line).text;
    const isTodo = TODO_RE.test(line);
    const isFunc = FUNC_RE.test(line);
    if (!isTodo && !isFunc) return [];
    const client = this.clientFactory();
    if (!client) return [];
    const agents = await this.getAgents(client);
    const top = agents.slice(0, 4);
    return top.map((a) => {
      const action = new vscode.CodeAction(
        `Send to ALDO agent: ${a.name}`,
        vscode.CodeActionKind.QuickFix,
      );
      action.command = {
        command: 'aldoAi.runOnSelection',
        title: 'Send to ALDO agent',
        arguments: [a.name],
      };
      return action;
    });
  }

  private async getAgents(client: ApiClient): Promise<AgentSummary[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < 60_000) return this.cache.agents;
    try {
      const agents = await client.listAgents();
      this.cache = { at: now, agents };
      return agents;
    } catch {
      return [];
    }
  }
}
