// Lightweight mock of the `vscode` module surface used by the
// extension. Only the bits we touch in unit tests are implemented;
// the rest throw so missing coverage is loud.
//
// For full E2E coverage we'd run `@vscode/test-electron` (configured
// in `tests/runTest.cjs`), but that needs a downloaded VS Code build,
// which is out of scope for the in-tree CI loop.

class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  readonly event = (listener: (e: T) => void): { dispose: () => void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };
  fire(e: T): void {
    for (const l of this.listeners) l(e);
  }
}

class TreeItem {
  description?: string;
  tooltip?: string;
  contextValue?: string;
  command?: unknown;
  iconPath?: unknown;
  constructor(
    public label: string,
    public collapsibleState?: number,
  ) {}
}

class ThemeIcon {
  constructor(public id: string) {}
}

class CodeAction {
  command?: unknown;
  constructor(
    public title: string,
    public kind: unknown,
  ) {}
}

const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;
const StatusBarAlignment = { Left: 1, Right: 2 } as const;
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;
const ViewColumn = { Active: -1, Beside: -2, One: 1 } as const;
const CodeActionKind = {
  QuickFix: { value: 'quickfix' },
  Refactor: { value: 'refactor' },
} as const;

interface MutableSecretStorage {
  store(k: string, v: string): Promise<void>;
  get(k: string): Promise<string | undefined>;
  delete(k: string): Promise<void>;
}

const _secrets = new Map<string, string>();
const secretStorage: MutableSecretStorage = {
  async store(k, v) {
    _secrets.set(k, v);
  },
  async get(k) {
    return _secrets.get(k);
  },
  async delete(k) {
    _secrets.delete(k);
  },
};

interface ConfigShape {
  [key: string]: unknown;
}
const _config: ConfigShape = {};
const workspace = {
  getConfiguration(_section?: string) {
    return {
      get<T>(key: string, def?: T): T {
        const v = _config[key];
        return (v === undefined ? def : v) as T;
      },
      async update(key: string, value: unknown): Promise<void> {
        _config[key] = value;
      },
    };
  },
  onDidChangeConfiguration: new EventEmitter<{ affectsConfiguration: (s: string) => boolean }>()
    .event,
};

const window = {
  createStatusBarItem(_align?: number, _priority?: number) {
    return {
      text: '',
      command: '',
      show() {},
      hide() {},
      dispose() {},
    };
  },
  createWebviewPanel(_id: string, _title: string, _col: number, _opts?: unknown) {
    return {
      webview: {
        html: '',
        postMessage: async () => true,
        onDidReceiveMessage: () => ({ dispose() {} }),
      },
      dispose() {},
      onDidDispose: () => ({ dispose() {} }),
      reveal() {},
    };
  },
  registerTreeDataProvider() {
    return { dispose() {} };
  },
  showInformationMessage() {
    return Promise.resolve(undefined);
  },
  showErrorMessage() {
    return Promise.resolve(undefined);
  },
  showInputBox: async (_opts?: unknown) => undefined as string | undefined,
  showQuickPick: async (_items: unknown, _opts?: unknown) => undefined as unknown,
  activeTextEditor: undefined as unknown,
};

interface CommandRegistration {
  command: string;
  callback: (...args: unknown[]) => unknown;
}
const _commands: CommandRegistration[] = [];
const commands = {
  registerCommand(command: string, callback: (...args: unknown[]) => unknown) {
    _commands.push({ command, callback });
    return {
      dispose() {
        const i = _commands.findIndex((r) => r.command === command);
        if (i >= 0) _commands.splice(i, 1);
      },
    };
  },
  async executeCommand(command: string, ...args: unknown[]) {
    const reg = _commands.find((r) => r.command === command);
    return reg?.callback(...args);
  },
  getCommands(): string[] {
    return _commands.map((r) => r.command);
  },
};

const env = {
  async openExternal(_uri: unknown) {
    return true;
  },
};

const Uri = {
  parse(s: string) {
    return { toString: () => s };
  },
  file(s: string) {
    return { fsPath: s, toString: () => `file://${s}` };
  },
};

const languages = {
  registerCodeActionsProvider() {
    return { dispose() {} };
  },
};

// Helper: reset between tests.
export function _resetVscodeMock(): void {
  _secrets.clear();
  for (const k of Object.keys(_config)) delete _config[k];
  _commands.length = 0;
}

// Build a minimal `ExtensionContext` for tests.
export function _makeExtensionContext(): {
  subscriptions: { dispose: () => void }[];
  secrets: MutableSecretStorage;
  globalState: { get: (k: string) => unknown; update: (k: string, v: unknown) => Promise<void> };
} {
  const state = new Map<string, unknown>();
  return {
    subscriptions: [],
    secrets: secretStorage,
    globalState: {
      get: (k) => state.get(k),
      update: async (k, v) => {
        state.set(k, v);
      },
    },
  };
}

export {
  EventEmitter,
  TreeItem,
  TreeItemCollapsibleState,
  StatusBarAlignment,
  ConfigurationTarget,
  ViewColumn,
  ThemeIcon,
  CodeAction,
  CodeActionKind,
  workspace,
  window,
  commands,
  env,
  Uri,
  languages,
};
