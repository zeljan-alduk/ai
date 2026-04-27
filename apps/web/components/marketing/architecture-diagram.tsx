/**
 * Inline-SVG architecture diagram for the marketing landing.
 *
 * One-glance picture of the platform shape: client surfaces -> API
 * gateway -> privacy-tier router -> {cloud, local} models, with the
 * eval harness + replay store hanging off the side. No vendor names —
 * the cloud branch is labelled by capability class.
 *
 * Pure SVG; renders identically server-side and client-side. Sized to
 * scale on small screens via viewBox + preserveAspectRatio.
 */

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly title: string;
  readonly subtitle?: string;
  readonly variant: 'client' | 'core' | 'router' | 'cloud' | 'local' | 'side';
}

const VARIANT: Record<Box['variant'], { fill: string; stroke: string; title: string; sub: string }> = {
  client: { fill: 'fill-slate-50', stroke: 'stroke-slate-300', title: 'fill-slate-900', sub: 'fill-slate-500' },
  core:   { fill: 'fill-blue-50',  stroke: 'stroke-blue-300',  title: 'fill-blue-900',  sub: 'fill-blue-700' },
  router: { fill: 'fill-amber-50', stroke: 'stroke-amber-300', title: 'fill-amber-900', sub: 'fill-amber-700' },
  cloud:  { fill: 'fill-slate-50', stroke: 'stroke-slate-300', title: 'fill-slate-700', sub: 'fill-slate-500' },
  local:  { fill: 'fill-emerald-50', stroke: 'stroke-emerald-300', title: 'fill-emerald-900', sub: 'fill-emerald-700' },
  side:   { fill: 'fill-violet-50', stroke: 'stroke-violet-300', title: 'fill-violet-900', sub: 'fill-violet-700' },
};

const BOXES: ReadonlyArray<Box> = [
  // Top row — client surfaces.
  { x:  40, y:  10, w: 130, h: 44, title: 'Web app',       subtitle: 'ai.aldo.tech',     variant: 'client' },
  { x: 200, y:  10, w: 130, h: 44, title: 'CLI',           subtitle: 'aldo run …',       variant: 'client' },
  { x: 360, y:  10, w: 130, h: 44, title: 'SDK / API',     subtitle: 'Python · TS · MCP', variant: 'client' },

  // Core gateway.
  { x: 165, y:  90, w: 200, h: 50, title: 'API gateway',   subtitle: 'auth · quotas · rate-limit', variant: 'core' },

  // Router with privacy gate.
  { x: 145, y: 170, w: 240, h: 56, title: 'Privacy-tier router', subtitle: 'public  ·  internal  ·  sensitive', variant: 'router' },

  // Bottom branches — cloud on left, local on right.
  { x:  20, y: 270, w: 200, h: 60, title: 'Cloud capabilities', subtitle: 'reasoning-strong · tool-use · vision', variant: 'cloud' },
  { x: 310, y: 270, w: 200, h: 60, title: 'Local capabilities', subtitle: 'Ollama · vLLM · llama.cpp · MLX',     variant: 'local' },

  // Side chips — eval + replay.
  { x: 540, y: 110, w: 130, h: 44, title: 'Eval harness', subtitle: 'gate before promote', variant: 'side' },
  { x: 540, y: 200, w: 130, h: 44, title: 'Replay store', subtitle: 'every run, every step', variant: 'side' },
];

/**
 * Connector — a soft right-angled arrow from (x1,y1) to (x2,y2)
 * threaded through a midpoint. Stroked + arrowhead.
 */
function Connector({ from, to }: { from: [number, number]; to: [number, number] }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const midY = (y1 + y2) / 2;
  return (
    <path
      d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
      className="fill-none stroke-slate-300"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      markerEnd="url(#arrowhead)"
    />
  );
}

export function ArchitectureDiagram() {
  return (
    <figure className="w-full">
      <svg
        viewBox="0 0 700 360"
        role="img"
        aria-labelledby="arch-title arch-desc"
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id="arch-title">ALDO AI platform architecture</title>
        <desc id="arch-desc">
          Three client surfaces — web, CLI and SDK — flow into the API gateway, then into the
          privacy-tier router, which directs requests to either cloud or local model capabilities.
          The eval harness and replay store are attached to the gateway.
        </desc>
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-slate-400" />
          </marker>
        </defs>

        {/* Connectors — drawn first so boxes overlay them. */}
        <Connector from={[105, 54]} to={[265, 90]} />
        <Connector from={[265, 54]} to={[265, 90]} />
        <Connector from={[425, 54]} to={[265, 90]} />

        <Connector from={[265, 140]} to={[265, 170]} />

        <Connector from={[265, 226]} to={[120, 270]} />
        <Connector from={[265, 226]} to={[410, 270]} />

        <Connector from={[365, 115]} to={[540, 132]} />
        <Connector from={[365, 200]} to={[540, 222]} />

        {/* Boxes. */}
        {BOXES.map((b) => {
          const v = VARIANT[b.variant];
          const cx = b.x + b.w / 2;
          return (
            <g key={`${b.x}-${b.y}-${b.title}`}>
              <rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={8}
                ry={8}
                className={`${v.fill} ${v.stroke}`}
                strokeWidth="1.5"
              />
              <text
                x={cx}
                y={b.y + (b.subtitle ? 19 : b.h / 2 + 4)}
                textAnchor="middle"
                className={`${v.title} text-[11.5px] font-semibold`}
              >
                {b.title}
              </text>
              {b.subtitle ? (
                <text
                  x={cx}
                  y={b.y + 36}
                  textAnchor="middle"
                  className={`${v.sub} text-[10px]`}
                >
                  {b.subtitle}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        Architecture: web, CLI and SDK clients → API gateway → privacy-tier router → cloud or local
        models. Eval harness and replay store flank the gateway.
      </figcaption>
    </figure>
  );
}
