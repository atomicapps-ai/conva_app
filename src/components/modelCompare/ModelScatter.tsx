import type { BenchmarkModel } from "@/lib/modelCompare/benchmarkData";
import {
  LIVE_TARGET,
  dotRadius,
  formatCost,
  labelOffsets,
  linear,
  modelColor,
  ticks,
  xDomain,
  yDomain,
  type ScatterData,
} from "@/lib/modelCompare/compare";

const W = 720;
const H = 380;
const PAD = { left: 52, right: 28, top: 20, bottom: 52 };

/**
 * Speed against quality, one dot per model: how fast it starts answering (x,
 * seconds to first token) against how well it answered (y). The shaded band is
 * the product's live first-token budget (300-600 ms); dot size is cost. Click
 * or press Enter on a dot to select that model.
 *
 * Pure SVG from the data so it follows the app theme; the table under it in
 * `ModelsView` carries the same numbers for anyone who prefers rows.
 */
export function ModelScatter({
  models,
  data,
  measureLabel,
  selectedId,
  onSelect,
}: {
  models: readonly BenchmarkModel[];
  data: ScatterData;
  measureLabel: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [x0, x1] = xDomain(data.points);
  const [y0, y1] = yDomain(data.points);
  const sx = linear([x0, x1], [PAD.left, W - PAD.right]);
  const sy = linear([y0, y1], [H - PAD.bottom, PAD.top]);
  const maxCost = Math.max(0, ...data.points.map((p) => p.costUsd));

  const placed = data.points.map((p) => ({
    ...p,
    px: sx(p.x),
    py: sy(p.y),
    r: dotRadius(p.costUsd, maxCost),
  }));
  const offsets = labelOffsets(placed);
  // Large dots first so a small dot at nearly the same spot stays visible.
  const drawOrder = [...placed].sort((a, b) => b.r - a.r);

  const bandX0 = sx(LIVE_TARGET.fromS);
  const bandX1 = sx(LIVE_TARGET.toS);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label={`Speed against ${measureLabel}: one dot per model`}
      className="h-auto w-full"
    >
      {/* live-target band */}
      <rect
        x={bandX0}
        y={PAD.top}
        width={bandX1 - bandX0}
        height={H - PAD.bottom - PAD.top}
        fill="var(--color-primary)"
        fillOpacity={0.14}
      />
      <text
        x={bandX1 + 6}
        y={PAD.top + 12}
        fontSize={11}
        fill="var(--color-fg-muted)"
      >
        live target (0.3–0.6 s)
      </text>

      {/* grid + axes */}
      {ticks([y0, y1], 10).map((t) => (
        <g key={`y${t}`}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={sy(t)}
            y2={sy(t)}
            stroke="var(--color-border)"
          />
          <text
            x={PAD.left - 8}
            y={sy(t) + 4}
            textAnchor="end"
            fontSize={11}
            fill="var(--color-fg-faint)"
          >
            {t}%
          </text>
        </g>
      ))}
      {ticks([x0, x1], 1).map((t) => (
        <g key={`x${t}`}>
          <line
            x1={sx(t)}
            x2={sx(t)}
            y1={H - PAD.bottom}
            y2={H - PAD.bottom + 4}
            stroke="var(--color-fg-faint)"
          />
          <text
            x={sx(t)}
            y={H - PAD.bottom + 18}
            textAnchor="middle"
            fontSize={11}
            fill="var(--color-fg-faint)"
          >
            {t} s
          </text>
        </g>
      ))}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={H - PAD.bottom}
        y2={H - PAD.bottom}
        stroke="var(--color-border-strong)"
      />
      <text
        x={(PAD.left + W - PAD.right) / 2}
        y={H - 12}
        textAnchor="middle"
        fontSize={12}
        fill="var(--color-fg-muted)"
      >
        Median time to first token (left is faster)
      </text>
      <text
        x={14}
        y={(PAD.top + H - PAD.bottom) / 2}
        textAnchor="middle"
        fontSize={12}
        fill="var(--color-fg-muted)"
        transform={`rotate(-90 14 ${(PAD.top + H - PAD.bottom) / 2})`}
      >
        {measureLabel} (higher is better)
      </text>

      {/* dots */}
      {drawOrder.map((p) => {
        const selected = p.id === selectedId;
        const color = modelColor(models, p.id);
        return (
          <g
            key={p.id}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${p.label}: first token ${p.x.toFixed(2)} seconds, ${p.y}%, ${formatCost(p.costUsd)} per answer`}
            onClick={() => onSelect(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(p.id);
              }
            }}
            className="cursor-pointer outline-none focus-visible:[&>circle:first-child]:stroke-[var(--color-fg)]"
          >
            <title>{`${p.label}: ${p.x.toFixed(2)} s to first token, ${p.y}%, ${formatCost(p.costUsd)} per answer`}</title>
            <circle
              cx={p.px}
              cy={p.py}
              r={p.r}
              fill={color}
              fillOpacity={selected ? 1 : 0.8}
              stroke={selected ? "var(--color-fg)" : "var(--color-bg)"}
              strokeWidth={selected ? 2.5 : 1.5}
            />
          </g>
        );
      })}

      {/* labels (never intercept clicks) */}
      {placed.map((p) => {
        const flip = p.px > W - PAD.right - 130;
        return (
          <text
            key={`label-${p.id}`}
            x={flip ? p.px - p.r - 6 : p.px + p.r + 6}
            y={p.py + 4 + (offsets[p.id] ?? 0)}
            textAnchor={flip ? "end" : "start"}
            fontSize={11}
            fontWeight={p.id === selectedId ? 700 : 400}
            fill="var(--color-fg)"
            pointerEvents="none"
          >
            {p.label}
          </text>
        );
      })}

      <text x={W - PAD.right} y={H - 12} textAnchor="end" fontSize={11} fill="var(--color-fg-faint)">
        Bigger dot = costlier answer
      </text>
    </svg>
  );
}
