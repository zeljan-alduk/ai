// Sidebar tree: agents available in the connected tenant. The tree
// pulls from /v1/agents and renders each agent with its privacy tier
// as a description so the platform's privacy-tier model is visible at
// a glance. Tier enforcement happens server-side; this is informative.
import * as vscode from 'vscode';
import type { AgentSummary, ApiClient } from '../api/client.js';

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private readonly emitter = new vscode.EventEmitter<AgentTreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private clientFactory: () => ApiClient | null) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AgentTreeItem): Promise<AgentTreeItem[]> {
    if (element) return [];
    const client = this.clientFactory();
    if (!client) {
      return [
        new AgentTreeItem({ name: 'Not logged in', description: 'Run "ALDO AI: Login"' }, true),
      ];
    }
    try {
      const agents = await client.listAgents();
      if (agents.length === 0) {
        return [new AgentTreeItem({ name: 'No agents yet' }, true)];
      }
      return agents.map((a) => new AgentTreeItem(a, false));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return [new AgentTreeItem({ name: `Error: ${msg}` }, true)];
    }
  }
}

export class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agent: AgentSummary,
    placeholder: boolean,
  ) {
    super(agent.name, vscode.TreeItemCollapsibleState.None);
    if (!placeholder) {
      this.description = agent.privacyTier ?? agent.version ?? agent.description ?? '';
      this.tooltip = agent.description ?? agent.name;
      this.contextValue = 'aldoAgent';
      this.command = {
        command: 'aldoAi.runOnSelection',
        title: 'Run on selection',
        arguments: [agent.name],
      };
      this.iconPath = new vscode.ThemeIcon('robot');
    } else {
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }
}
