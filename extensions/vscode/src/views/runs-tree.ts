// Sidebar tree: recent runs in the connected tenant. Each row carries
// the run id as `contextValue` + a click-to-open-trace action.
import * as vscode from 'vscode';
import type { ApiClient, RunSummary } from '../api/client.js';

export class RunsTreeProvider implements vscode.TreeDataProvider<RunTreeItem> {
  private readonly emitter = new vscode.EventEmitter<RunTreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private clientFactory: () => ApiClient | null) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: RunTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RunTreeItem): Promise<RunTreeItem[]> {
    if (element) return [];
    const client = this.clientFactory();
    if (!client) {
      return [new RunTreeItem({ id: '', agentName: 'Not logged in', status: '' }, true)];
    }
    try {
      const runs = await client.listRuns(20);
      if (runs.length === 0) {
        return [new RunTreeItem({ id: '', agentName: 'No runs yet', status: '' }, true)];
      }
      return runs.map((r) => new RunTreeItem(r, false));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return [new RunTreeItem({ id: '', agentName: `Error: ${msg}`, status: '' }, true)];
    }
  }
}

export class RunTreeItem extends vscode.TreeItem {
  constructor(
    public readonly run: RunSummary,
    placeholder: boolean,
  ) {
    super(
      placeholder ? run.agentName : `${run.agentName} · ${run.status}`,
      vscode.TreeItemCollapsibleState.None,
    );
    if (!placeholder) {
      this.description = run.id.slice(0, 12);
      this.tooltip = `${run.id}\n${run.startedAt ?? ''}`;
      this.contextValue = 'aldoRun';
      this.command = {
        command: 'aldoAi.openTraceInline',
        title: 'Open trace inline',
        arguments: [run.id],
      };
      this.iconPath = new vscode.ThemeIcon(statusIcon(run.status));
    }
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'check';
    case 'failed':
      return 'error';
    case 'running':
      return 'sync~spin';
    case 'queued':
      return 'clock';
    default:
      return 'circle-outline';
  }
}
