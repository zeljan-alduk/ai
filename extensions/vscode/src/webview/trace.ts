// Trace webview. Fetches /v1/runs/:id/tree from the API and renders a
// flame graph + replay scrubber in vanilla SVG/HTML. Self-contained:
// the web app being unreachable does not break this view.
//
// Approx 250 LOC of pure DOM, as called for in the brief.
import * as vscode from 'vscode';
import type { ApiClient, RunTreeNode } from '../api/client.js';

export async function openTraceWebview(
  ctx: vscode.ExtensionContext,
  client: ApiClient,
  runId: string,
): Promise<vscode.WebviewPanel> {
  const panel = vscode.window.createWebviewPanel(
    'aldoAiTrace',
    `Trace · ${runId.slice(0, 12)}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  let tree: RunTreeNode;
  try {
    tree = await client.getRunTree(runId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    panel.webview.html = errorHtml(runId, msg);
    return panel;
  }

  panel.webview.html = renderTraceHtml(runId, tree);

  panel.webview.onDidReceiveMessage(
    (msg: { type?: string; runId?: string }) => {
      if (msg.type === 'open-in-browser' && msg.runId) {
        vscode.commands.executeCommand('aldoAi.openRunInBrowser', msg.runId);
      }
    },
    undefined,
    ctx.subscriptions,
  );

  return panel;
}

interface FlameRow {
  id: string;
  agentName: string;
  status: string;
  depth: number;
  startMs: number;
  durationMs: number;
}

/** Flatten the tree into rows for the flame graph. */
export function flattenTree(root: RunTreeNode): FlameRow[] {
  const rows: FlameRow[] = [];
  const startBase = parseStart(root.startedAt);
  const visit = (node: RunTreeNode, depth: number): void => {
    const start = parseStart(node.startedAt) - startBase;
    rows.push({
      id: node.id,
      agentName: node.agentName,
      status: node.status,
      depth,
      startMs: Math.max(0, start),
      durationMs: Math.max(1, node.durationMs ?? 1),
    });
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  visit(root, 0);
  return rows;
}

function parseStart(s: string | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function statusColour(status: string): string {
  switch (status) {
    case 'succeeded':
      return '#3fb950';
    case 'failed':
      return '#f85149';
    case 'running':
      return '#58a6ff';
    case 'queued':
      return '#d29922';
    default:
      return '#8b949e';
  }
}

export function renderTraceHtml(runId: string, tree: RunTreeNode): string {
  const rows = flattenTree(tree);
  const totalMs = Math.max(1, ...rows.map((r) => r.startMs + r.durationMs));
  const rowHeight = 22;
  const width = 900;
  const leftPad = 160;
  const innerW = width - leftPad - 16;
  const height = rows.length * rowHeight + 40;

  const rects = rows
    .map((r) => {
      const x = leftPad + (r.startMs / totalMs) * innerW;
      const w = Math.max(2, (r.durationMs / totalMs) * innerW);
      const y = 30 + r.depth * rowHeight;
      const colour = statusColour(r.status);
      const label = `${r.agentName} (${r.durationMs}ms)`;
      return `<g class="row" data-run="${escAttr(r.id)}">
  <rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${rowHeight - 4}" fill="${colour}" rx="3"></rect>
  <text x="${(x + 4).toFixed(1)}" y="${y + 14}" font-size="11" fill="#0d1117">${escText(label)}</text>
  <text x="8" y="${y + 14}" font-size="11" fill="#c9d1d9">${escText(r.agentName.slice(0, 22))}</text>
</g>`;
    })
    .join('\n');

  // CSP: only allow inline styles + scripts for this specific webview.
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0d1117; color: #c9d1d9; padding: 12px; }
    h2 { margin: 0 0 4px 0; font-size: 14px; }
    .meta { font-size: 12px; color: #8b949e; margin-bottom: 12px; }
    .row { cursor: pointer; }
    .row:hover rect { stroke: #f0f6fc; stroke-width: 1; }
    .scrubber { width: ${width}px; margin-top: 12px; display: flex; gap: 8px; align-items: center; }
    .scrubber input { flex: 1; }
    .scrubber-label { font-size: 12px; color: #8b949e; min-width: 80px; text-align: right; }
    button { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
    button:hover { background: #30363d; }
  </style>
</head>
<body>
  <h2>Run ${escText(runId)}</h2>
  <div class="meta">${rows.length} span(s) · total ${totalMs} ms</div>
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <line x1="${leftPad}" y1="20" x2="${width - 16}" y2="20" stroke="#30363d" />
    <text x="${leftPad}" y="14" font-size="10" fill="#8b949e">0 ms</text>
    <text x="${width - 16}" y="14" font-size="10" fill="#8b949e" text-anchor="end">${totalMs} ms</text>
    ${rects}
    <line id="cursor" x1="${leftPad}" y1="20" x2="${leftPad}" y2="${height}" stroke="#f0f6fc" stroke-dasharray="2,2" opacity="0.6" />
  </svg>
  <div class="scrubber">
    <button id="open">Open in browser</button>
    <input id="scrub" type="range" min="0" max="${totalMs}" value="0" />
    <span class="scrubber-label" id="scrubLabel">0 ms</span>
  </div>
  <script>
    (function() {
      const totalMs = ${totalMs};
      const leftPad = ${leftPad};
      const innerW = ${innerW};
      const cursor = document.getElementById('cursor');
      const label = document.getElementById('scrubLabel');
      document.getElementById('scrub').addEventListener('input', (e) => {
        const v = Number(e.target.value);
        const x = leftPad + (v / totalMs) * innerW;
        cursor.setAttribute('x1', x);
        cursor.setAttribute('x2', x);
        label.textContent = v + ' ms';
      });
      const vscode = acquireVsCodeApi();
      document.getElementById('open').addEventListener('click', () => {
        vscode.postMessage({ type: 'open-in-browser', runId: ${JSON.stringify(runId)} });
      });
      document.querySelectorAll('.row').forEach((g) => {
        g.addEventListener('click', () => {
          vscode.postMessage({ type: 'open-in-browser', runId: g.getAttribute('data-run') });
        });
      });
    })();
  </script>
</body>
</html>`;
}

function errorHtml(runId: string, message: string): string {
  return `<!doctype html><html><body style="font-family: sans-serif; padding: 16px; background: #0d1117; color: #c9d1d9;">
  <h2>Trace unavailable</h2>
  <p>Could not load run <code>${escText(runId)}</code>:</p>
  <pre style="background: #161b22; padding: 8px; border-radius: 4px;">${escText(message)}</pre>
</body></html>`;
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s: string): string {
  return escText(s).replace(/"/g, '&quot;');
}
