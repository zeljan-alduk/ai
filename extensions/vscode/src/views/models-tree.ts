// Sidebar tree: registered models. Pulled from /v1/models. Strictly
// informational — the extension never picks a model; agents declare
// capabilities and the gateway routes. We surface privacy_tier per
// row so an engineer can sanity-check a tenant's eligible-model pool.
import * as vscode from 'vscode';
import type { ApiClient, ModelSummary } from '../api/client.js';

export class ModelsTreeProvider implements vscode.TreeDataProvider<ModelTreeItem> {
  private readonly emitter = new vscode.EventEmitter<ModelTreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private clientFactory: () => ApiClient | null) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: ModelTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
    if (element) return [];
    const client = this.clientFactory();
    if (!client) {
      return [new ModelTreeItem({ id: 'Not logged in' }, true)];
    }
    try {
      const models = await client.listModels();
      if (models.length === 0) {
        return [new ModelTreeItem({ id: 'No models registered' }, true)];
      }
      return models.map((m) => new ModelTreeItem(m, false));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return [new ModelTreeItem({ id: `Error: ${msg}` }, true)];
    }
  }
}

export class ModelTreeItem extends vscode.TreeItem {
  constructor(
    public readonly model: ModelSummary,
    placeholder: boolean,
  ) {
    super(model.id, vscode.TreeItemCollapsibleState.None);
    if (!placeholder) {
      const bits: string[] = [];
      if (model.capabilityClass) bits.push(model.capabilityClass);
      if (model.privacyTier) bits.push(model.privacyTier);
      this.description = bits.join(' · ');
      this.tooltip = `${model.id}\nprovider: ${model.provider ?? '?'}`;
      this.iconPath = new vscode.ThemeIcon('database');
      this.contextValue = 'aldoModel';
    } else {
      this.iconPath = new vscode.ThemeIcon('info');
    }
  }
}
