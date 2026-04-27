// Lightweight "run output" webview. The brief asks for a streaming
// view of run events when an agent is invoked from the editor. We
// post messages from the extension host as events arrive (or when the
// initial `createRun` reply lands) and the webview appends them to a
// scrolling log. No model-provider knowledge here — the events are
// the platform's own normalised lifecycle events.
import * as vscode from 'vscode';

export interface RunOutputPanel {
  panel: vscode.WebviewPanel;
  log: (line: string) => void;
  setStatus: (status: string) => void;
}

export function openRunOutputPanel(agentName: string, runId: string): RunOutputPanel {
  const panel = vscode.window.createWebviewPanel(
    'aldoAiRunOutput',
    `ALDO · ${agentName}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = renderRunOutputHtml(agentName, runId);
  return {
    panel,
    log: (line: string) => {
      panel.webview.postMessage({ type: 'log', line });
    },
    setStatus: (status: string) => {
      panel.webview.postMessage({ type: 'status', status });
    },
  };
}

export function renderRunOutputHtml(agentName: string, runId: string): string {
  return `<!doctype html><html><head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0d1117; color: #c9d1d9; padding: 12px; margin: 0; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    h2 { font-size: 14px; margin: 0; }
    #status { font-size: 12px; color: #8b949e; padding: 2px 8px; background: #21262d; border-radius: 10px; }
    #log { background: #010409; border: 1px solid #30363d; border-radius: 4px; padding: 8px; height: 70vh; overflow: auto; font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; }
  </style>
</head><body>
  <header>
    <h2>${escText(agentName)} · <code>${escText(runId)}</code></h2>
    <span id="status">queued</span>
  </header>
  <div id="log"></div>
  <script>
    const log = document.getElementById('log');
    const status = document.getElementById('status');
    window.addEventListener('message', (event) => {
      const m = event.data;
      if (m.type === 'log') {
        const line = document.createElement('div');
        line.textContent = m.line;
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
      } else if (m.type === 'status') {
        status.textContent = m.status;
      }
    });
  </script>
</body></html>`;
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
