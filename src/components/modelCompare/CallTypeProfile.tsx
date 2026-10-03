import type { BenchmarkModel } from "@/lib/modelCompare/benchmarkData";
import {
  callTypeGroups,
  linear,
  modelColor,
  profileModels,
  ticks,
} from "@/lib/modelCompare/compare";

const W = 720;
const H = 400;
const PAD = { left: 48, right: 16, top: 34, bottom: 110 };
const Y_DOMAIN: [number, number] = [55, 100];

/**
 * The line chart: how each model scored on each of Conva's call types, grouped
 * into the product areas they belong to (grey bands). One line per model that
 * has per-call-type results, with a legend. The call types are not ordered, so
 * the lines only join neighbours to make the shape readable; the selected
 * model's line is drawn heavier. Hover a point for the exact figure.
 */
export function CallTypeProfile({
  models,
  selectedId,
}: {
  models: readonly BenchmarkModel[];
  selectedId: string | null;
}) {
  const withData = profileModels(models);
  const first = withData[0]?.callTypes;
  if (!first) return null;

  const n = first.length;
  const plotW = W - PAD.left - PAD.right;
  const sx = (i: number) => PAD.left + ((i + 0.5) * plotW) / n;
  const sy = linear(Y_DOMAIN, [H - PAD.bottom, PAD.top]);
  const groups = callTypeGroups(first);

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1" aria-label="Legend">
        {withData.map((m) => (
          <li key={m.id} className="flex items-center gap-2 text-[12px] text-fg">
            <svg width={26} height={12} aria-hidden>
              <line x1={0} x2={26} y1={6} y2={6} stroke={modelColor(models, m.id)} strokeWidth={2.5} />
              <circle cx={13} cy={6} r={4} fill={modelColor(models, m.id)} />
            </svg>
            {m.name}
          </li>
        ))}
      </ul>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Objective score by call type for each model that has been run on the 55-item suite"
        className="h-auto w-full"
      >
        {groups.map((g, i) => {
          const gx = PAD.left + (g.from * plotW) / n;
          const gw = ((g.to - g.from + 1) * plotW) / n;
          return (
            <g key={g.name}>
              <rect
                x={gx}
                y={PAD.top - 6}
                width={gw}
                height={H - PAD.bottom - PAD.top + 12}
                fill="var(--color-fg-faint)"
                fillOpacity={i % 2 === 0 ? 0.1 : 0.03}
              />
              <text
                x={gx + gw / 2}
                y={PAD.top - 12}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="var(--color-fg-muted)"
              >
                {g.name}
              </text>
            </g>
          );
        })}
        {ticks(Y_DOMAIN, 10).map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(t)}
              y2={sy(t)}
              stroke="var(--color-border)"
            />
            <text x={PAD.left - 8} y={sy(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-fg-faint)">
              {t}%
            </text>
          </g>
        ))}
        {withData.map((m) => {
          const selected = m.id === selectedId;
          const color = modelColor(models, m.id);
          const pts = m.callTypes ?? [];
          const d = pts
            .map((c, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)} ${sy(c.objective).toFixed(1)}`)
            .join(" ");
          return (
            <g key={m.id} data-model={m.id}>
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={selected ? 3 : 2}
                strokeOpacity={selected || selectedId === null ? 1 : 0.65}
              />
              {pts.map((c, i) => (
                <circle key={c.id} cx={sx(i)} cy={sy(c.objective)} r={selected ? 5 : 4} fill={color}>
                  <title>{`${m.name} · ${c.label}: ${c.objective}% (${c.items} items)`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {first.map((c, i) => (
          <text
            key={c.id}
            x={sx(i)}
            y={H - PAD.bottom + 18}
            textAnchor="end"
            fontSize={11}
            fill="var(--color-fg)"
            transform={`rotate(-40 ${sx(i)} ${H - PAD.bottom + 18})`}
          >
            {c.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
