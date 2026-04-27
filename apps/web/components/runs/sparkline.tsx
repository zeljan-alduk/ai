/**
 * Server-rendered SVG sparkline. No client island, no Recharts —
 * just a pure path. The /runs list shows one of these per row, so
 * we keep the cost low.
 *
 * `points` is a non-empty array of numeric values; the sparkline
 * stretches them across `width` × `height`. When all values are
 * equal we render a dashed flat line so the row still has visual
 * weight.
 *
 * LLM-agnostic by construction — there's nothing here that names a
 * provider.
 */

export function Sparkline({
  points,
  width = 96,
  height = 18,
  className = '',
}: {
  points: ReadonlyArray<number>;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (points.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className={className}
      >
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke="#cbd5e1"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;
  const stepX = points.length === 1 ? 0 : width / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * stepX;
      const y = range === 0 ? height / 2 : height - ((v - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className={className}
    >
      <path d={path} fill="none" stroke="#0f172a" strokeWidth={1.25} strokeLinecap="round" />
    </svg>
  );
}
