/**
 * Visual composite diagram — pure SVG, no external DAG library.
 *
 * Strategies:
 *
 *   - sequential: horizontal chain (a -> b -> c) with arrows
 *   - parallel:   fan-out from supervisor to N siblings, fan-in to "join"
 *   - debate:     fan-out + an "aggregator" node consuming all siblings
 *   - iterative:  single subagent in a self-loop, with maxRounds /
 *                 terminate annotated
 *
 * Layout positions are computed by pure functions exported below
 * (`computeLayout`) and exercised by the vitest suite — the rendering
 * just translates the layout into SVG.
 *
 * Each subagent node is a small rounded card with the subagent's name
 * + role; the link target is /agents/[that-name]. If the subagent
 * doesn't exist in the registry (we accept `knownAgents` Set on the
 * server) the node renders with a warning indicator and a tooltip.
 *
 * LLM-agnostic: nothing here mentions a provider; subagent names are
 * opaque strings.
 */

import type { CompositeWire } from '@aldo-ai/api-contract';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Pure layout — exported for vitest.
// ---------------------------------------------------------------------------

export interface NodePosition {
  /** Identifies the node for testing; not rendered. */
  readonly id: string;
  /** What text the node card displays as its primary label. */
  readonly label: string;
  /** Optional secondary label (role / strategy / iteration annotation). */
  readonly sublabel?: string;
  readonly x: number;
  readonly y: number;
  /** Node kind drives styling. */
  readonly kind: 'supervisor' | 'subagent' | 'join' | 'aggregator';
  /** Underlying agent name when kind === 'subagent'; null for synthetic nodes. */
  readonly agentName: string | null;
  /** Display alias (`as`). Falls back to agentName. */
  readonly alias?: string;
  /** Optional inputMap for hover. */
  readonly inputMap?: Readonly<Record<string, string>>;
  /** When true, the agent isn't in the registry — render a warning. */
  readonly missing?: boolean;
}

export interface EdgeSpec {
  readonly from: string; // node id
  readonly to: string; // node id
  /** When true, render a curved self-loop (used by iterative). */
  readonly selfLoop?: boolean;
  /** Optional label rendered near the midpoint. */
  readonly label?: string;
}

export interface DiagramLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: ReadonlyArray<NodePosition>;
  readonly edges: ReadonlyArray<EdgeSpec>;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 64;
const H_GAP = 70;
const V_GAP = 30;

export interface LayoutInput {
  /** The supervisor's display name (the parent agent). */
  readonly supervisorName: string;
  readonly composite: CompositeWire;
  /** Names known in the registry — used to flag missing references. */
  readonly knownAgents?: ReadonlySet<string>;
}

/**
 * Compute layout positions for every strategy. Pure: same input ->
 * same output, independent of any DOM / window APIs.
 */
export function computeLayout(input: LayoutInput): DiagramLayout {
  const { composite } = input;
  switch (composite.strategy) {
    case 'sequential':
      return layoutSequential(input);
    case 'parallel':
      return layoutParallel(input);
    case 'debate':
      return layoutDebate(input);
    case 'iterative':
      return layoutIterative(input);
    default: {
      // Exhaustive — TS will yell on contract additions.
      const _exhaustive: never = composite.strategy;
      throw new Error(`unknown strategy: ${_exhaustive as string}`);
    }
  }
}

function isMissing(input: LayoutInput, agentName: string): boolean {
  if (!input.knownAgents) return false;
  return !input.knownAgents.has(agentName);
}

function subagentNode(
  input: LayoutInput,
  sub: CompositeWire['subagents'][number],
  id: string,
  x: number,
  y: number,
): NodePosition {
  const node: NodePosition = {
    id,
    label: sub.as ?? sub.agent,
    sublabel: sub.agent,
    x,
    y,
    kind: 'subagent',
    agentName: sub.agent,
    missing: isMissing(input, sub.agent),
  };
  if (sub.as !== undefined) (node as { alias?: string }).alias = sub.as;
  if (sub.inputMap !== undefined)
    (node as { inputMap?: Readonly<Record<string, string>> }).inputMap = sub.inputMap;
  return node;
}

function layoutSequential(input: LayoutInput): DiagramLayout {
  const subs = input.composite.subagents;
  const nodes: NodePosition[] = [];
  const edges: EdgeSpec[] = [];
  // Single horizontal row: supervisor -> sub1 -> sub2 -> ...
  const supId = '__sup__';
  nodes.push({
    id: supId,
    label: input.supervisorName,
    sublabel: 'sequential',
    x: 0,
    y: 0,
    kind: 'supervisor',
    agentName: null,
  });
  let prevId = supId;
  subs.forEach((sub, i) => {
    const id = `sub-${i}`;
    const x = (i + 1) * (NODE_WIDTH + H_GAP);
    nodes.push(subagentNode(input, sub, id, x, 0));
    edges.push({ from: prevId, to: id });
    prevId = id;
  });
  const width = (subs.length + 1) * NODE_WIDTH + subs.length * H_GAP;
  return { width, height: NODE_HEIGHT, nodes, edges };
}

function layoutParallel(input: LayoutInput): DiagramLayout {
  const subs = input.composite.subagents;
  const nodes: NodePosition[] = [];
  const edges: EdgeSpec[] = [];
  // Three columns: supervisor | siblings (rows) | join
  const colSup = 0;
  const colSib = NODE_WIDTH + H_GAP;
  const colJoin = 2 * (NODE_WIDTH + H_GAP);
  const totalHeight = Math.max(NODE_HEIGHT, subs.length * NODE_HEIGHT + (subs.length - 1) * V_GAP);
  const supY = (totalHeight - NODE_HEIGHT) / 2;
  nodes.push({
    id: '__sup__',
    label: input.supervisorName,
    sublabel: 'parallel',
    x: colSup,
    y: supY,
    kind: 'supervisor',
    agentName: null,
  });
  subs.forEach((sub, i) => {
    const id = `sub-${i}`;
    const y = i * (NODE_HEIGHT + V_GAP);
    nodes.push(subagentNode(input, sub, id, colSib, y));
    edges.push({ from: '__sup__', to: id });
    edges.push({ from: id, to: '__join__' });
  });
  nodes.push({
    id: '__join__',
    label: 'join',
    sublabel: 'aggregate outputs',
    x: colJoin,
    y: supY,
    kind: 'join',
    agentName: null,
  });
  return {
    width: colJoin + NODE_WIDTH,
    height: totalHeight,
    nodes,
    edges,
  };
}

function layoutDebate(input: LayoutInput): DiagramLayout {
  // Same fan-out as parallel but the join is replaced by an aggregator
  // (named — coming from composite.aggregator). The aggregator is a
  // synthetic supervisor-style node carrying its agent name in
  // `agentName` so the click-through still resolves.
  const subs = input.composite.subagents;
  const aggregatorName = input.composite.aggregator ?? 'aggregator';
  const nodes: NodePosition[] = [];
  const edges: EdgeSpec[] = [];
  const colSup = 0;
  const colSib = NODE_WIDTH + H_GAP;
  const colAgg = 2 * (NODE_WIDTH + H_GAP);
  const totalHeight = Math.max(NODE_HEIGHT, subs.length * NODE_HEIGHT + (subs.length - 1) * V_GAP);
  const supY = (totalHeight - NODE_HEIGHT) / 2;
  nodes.push({
    id: '__sup__',
    label: input.supervisorName,
    sublabel: 'debate',
    x: colSup,
    y: supY,
    kind: 'supervisor',
    agentName: null,
  });
  subs.forEach((sub, i) => {
    const id = `sub-${i}`;
    const y = i * (NODE_HEIGHT + V_GAP);
    nodes.push(subagentNode(input, sub, id, colSib, y));
    edges.push({ from: '__sup__', to: id });
    edges.push({ from: id, to: '__agg__' });
  });
  nodes.push({
    id: '__agg__',
    label: aggregatorName,
    sublabel: 'aggregator',
    x: colAgg,
    y: supY,
    kind: 'aggregator',
    agentName: aggregatorName,
    missing: isMissing(input, aggregatorName),
  });
  return {
    width: colAgg + NODE_WIDTH,
    height: totalHeight,
    nodes,
    edges,
  };
}

function layoutIterative(input: LayoutInput): DiagramLayout {
  // One subagent looping back to itself; supervisor on the left.
  const sub = input.composite.subagents[0];
  if (!sub) {
    return { width: NODE_WIDTH, height: NODE_HEIGHT, nodes: [], edges: [] };
  }
  const it = input.composite.iteration;
  const nodes: NodePosition[] = [
    {
      id: '__sup__',
      label: input.supervisorName,
      sublabel: 'iterative',
      x: 0,
      y: 0,
      kind: 'supervisor',
      agentName: null,
    },
    subagentNode(input, sub, 'sub-0', NODE_WIDTH + H_GAP, 0),
  ];
  const edges: EdgeSpec[] = [
    { from: '__sup__', to: 'sub-0' },
    {
      from: 'sub-0',
      to: 'sub-0',
      selfLoop: true,
      label: it ? `loop x${it.maxRounds} until ${it.terminate}` : 'loop',
    },
  ];
  return {
    width: 2 * NODE_WIDTH + H_GAP,
    height: NODE_HEIGHT + 60, // extra room for the self-loop arc
    nodes,
    edges,
  };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export interface CompositeDiagramProps {
  supervisorName: string;
  composite: CompositeWire;
  knownAgents?: ReadonlyArray<string>;
}

const KIND_FILL: Record<NodePosition['kind'], string> = {
  supervisor: '#0f172a', // slate-900
  subagent: '#1e293b', // slate-800
  join: '#475569', // slate-600
  aggregator: '#1e293b',
};
const KIND_TEXT: Record<NodePosition['kind'], string> = {
  supervisor: '#f8fafc',
  subagent: '#f1f5f9',
  join: '#f8fafc',
  aggregator: '#f1f5f9',
};

export function CompositeDiagram({
  supervisorName,
  composite,
  knownAgents,
}: CompositeDiagramProps) {
  const known = knownAgents ? new Set(knownAgents) : undefined;
  const layoutInput: LayoutInput = known
    ? { supervisorName, composite, knownAgents: known }
    : { supervisorName, composite };
  const layout = computeLayout(layoutInput);
  const padding = 24;

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white p-4">
      <svg
        width={layout.width + padding * 2}
        height={layout.height + padding * 2}
        viewBox={`0 0 ${layout.width + padding * 2} ${layout.height + padding * 2}`}
        role="img"
        aria-label={`Composite diagram for ${supervisorName} (${composite.strategy})`}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>
        <g transform={`translate(${padding}, ${padding})`}>
          {layout.edges.map((e) => (
            <EdgeView
              key={`${e.from}->${e.to}${e.selfLoop ? ':loop' : ''}`}
              edge={e}
              layout={layout}
            />
          ))}
          {layout.nodes.map((n) => (
            <NodeView key={n.id} node={n} />
          ))}
        </g>
      </svg>
    </div>
  );
}

function NodeView({ node }: { node: NodePosition }) {
  const fill = KIND_FILL[node.kind];
  const textFill = KIND_TEXT[node.kind];
  const tooltip = buildTooltip(node);

  const card = (
    <g transform={`translate(${node.x}, ${node.y})`}>
      <title>{tooltip}</title>
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={10}
        ry={10}
        fill={fill}
        stroke={node.missing ? '#ef4444' : 'rgba(15,23,42,0.2)'}
        strokeWidth={node.missing ? 2 : 1}
      />
      <text
        x={NODE_WIDTH / 2}
        y={26}
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize={13}
        fontWeight={600}
        fill={textFill}
      >
        {truncate(node.label, 20)}
      </text>
      {node.sublabel ? (
        <text
          x={NODE_WIDTH / 2}
          y={45}
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize={11}
          fill="#cbd5e1"
        >
          {truncate(node.sublabel, 24)}
        </text>
      ) : null}
      {node.missing ? (
        <g transform={`translate(${NODE_WIDTH - 20}, 6)`}>
          <circle cx={6} cy={6} r={6} fill="#ef4444" />
          <text
            x={6}
            y={9}
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize={9}
            fontWeight={700}
            fill="#fff"
          >
            !
          </text>
        </g>
      ) : null}
    </g>
  );

  // Only subagent and aggregator nodes click through. The synthetic
  // supervisor / join are non-navigable.
  if ((node.kind === 'subagent' || node.kind === 'aggregator') && node.agentName) {
    return (
      <Link href={`/agents/${encodeURIComponent(node.agentName)}`} aria-label={node.agentName}>
        {card}
      </Link>
    );
  }
  return card;
}

function buildTooltip(n: NodePosition): string {
  const parts: string[] = [];
  if (n.alias && n.agentName) parts.push(`${n.alias} -> ${n.agentName}`);
  else if (n.agentName) parts.push(n.agentName);
  if (n.inputMap) {
    const entries = Object.entries(n.inputMap);
    if (entries.length > 0) {
      parts.push('inputMap:');
      for (const [k, v] of entries) parts.push(`  ${k} <- ${v}`);
    }
  }
  if (n.missing) parts.push('(not in registry)');
  return parts.join('\n');
}

function EdgeView({ edge, layout }: { edge: EdgeSpec; layout: DiagramLayout }) {
  const from = layout.nodes.find((n) => n.id === edge.from);
  const to = layout.nodes.find((n) => n.id === edge.to);
  if (!from || !to) return null;

  if (edge.selfLoop) {
    // Loop above the node: start at top-right, arc up, end at top-left.
    const cx = from.x + NODE_WIDTH;
    const cy = from.y + 10;
    const ex = from.x;
    const ey = from.y + 10;
    const d = `M ${cx} ${cy} C ${cx + 50} ${cy - 60}, ${ex - 50} ${ey - 60}, ${ex} ${ey}`;
    const labelX = from.x + NODE_WIDTH / 2;
    const labelY = from.y - 36;
    return (
      <g>
        <path d={d} fill="none" stroke="#94a3b8" strokeWidth={1.5} markerEnd="url(#arrow)" />
        {edge.label ? (
          <text
            x={labelX}
            y={labelY}
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize={10}
            fill="#475569"
          >
            {edge.label}
          </text>
        ) : null}
      </g>
    );
  }

  const x1 = from.x + NODE_WIDTH;
  const y1 = from.y + NODE_HEIGHT / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_HEIGHT / 2;
  // Slight horizontal offset so the arrow doesn't disappear into the
  // node border.
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2 - 2}
        y2={y2}
        stroke="#94a3b8"
        strokeWidth={1.5}
        markerEnd="url(#arrow)"
      />
      {edge.label ? (
        <text
          x={(x1 + x2) / 2}
          y={(y1 + y2) / 2 - 4}
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize={10}
          fill="#475569"
        >
          {edge.label}
        </text>
      ) : null}
    </g>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
