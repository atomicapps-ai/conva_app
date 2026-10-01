import { useState } from "react";

import { Icon } from "@/components/ui/Icon";
import type { ChoiceOption, GridCell, GridPayload } from "@/lib/ipc";

/**
 * A computed table answer (spreadsheet totals) as View (4) shows it. Numbers
 * arrive already formatted and already exact; this component only draws them.
 * Every figure that carries provenance is a button: pressing it shows the file,
 * column and rows behind the number, so nothing on screen is unexplained.
 */
export function GridAnswer({ grid }: { grid: GridPayload }) {
  const [picked, setPicked] = useState<string | null>(null);
  const pickedCell = (() => {
    if (!picked) return null;
    const [r, c] = picked.split(":").map(Number);
    return grid.rows[r!]?.cells[c!] ?? null;
  })();

  return (
    <div className="flex flex-col gap-2.5">
      <div className="font-mono text-[0.62em] font-bold uppercase tracking-[0.16em] text-fg-faint">
        {grid.title}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-strong bg-panel-raised">
        <table className="w-full border-collapse text-[0.92em]">
          <thead>
            <tr>
              {grid.columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={[
                    "whitespace-nowrap border-b border-border-strong bg-bg-2 px-3 py-1.5 font-mono text-[0.68em] font-bold uppercase tracking-[0.12em] text-fg-faint",
                    col.align === "right" ? "text-right" : "text-left",
                  ].join(" ")}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, r) => (
              <tr
                key={r}
                className={
                  row.kind === "total"
                    ? "border-t border-border-strong bg-bg-2 font-bold"
                    : "border-b border-border last:border-b-0"
                }
              >
                {row.cells.map((cell, c) => (
                  <Cell
                    key={c}
                    cell={cell}
                    right={grid.columns[c]?.align === "right"}
                    selected={picked === `${r}:${c}`}
                    onPick={() =>
                      setPicked((cur) => (cur === `${r}:${c}` ? null : `${r}:${c}`))
                    }
                    rowHeader={c === 0}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Provenance cell={pickedCell} />

      {grid.notices.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Things to check">
          {grid.notices.map((n, i) => (
            <li
              key={i}
              className={[
                "rounded-md border px-2.5 py-1.5 text-[0.84em] leading-snug",
                n.level === "caution"
                  ? "border-notice/50 text-fg"
                  : "border-border text-fg-muted",
              ].join(" ")}
            >
              {n.level === "caution" && (
                <span className="mr-1.5 font-mono text-[0.8em] font-bold uppercase tracking-wide text-notice">
                  Check
                </span>
              )}
              {n.text}
              {n.rows && n.rows.length > 0 && (
                <span className="ml-1.5 font-mono text-[0.85em] text-fg-faint">
                  rows {n.rows.join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Cell({
  cell,
  right,
  selected,
  onPick,
  rowHeader,
}: {
  cell: GridCell;
  right: boolean;
  selected: boolean;
  onPick: () => void;
  rowHeader: boolean;
}) {
  const base = [
    "whitespace-nowrap px-3 py-1.5",
    right ? "text-right font-mono tabular-nums" : "text-left",
  ].join(" ");
  const hasSources = (cell.sources?.length ?? 0) > 0;
  const content = hasSources ? (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      title="Show where this number comes from"
      className={[
        "-mx-1 rounded px-1 transition",
        selected ? "bg-ai/15 text-ai ring-1 ring-ai/60" : "hover:bg-white/[0.06]",
      ].join(" ")}
    >
      {cell.text}
    </button>
  ) : (
    cell.text
  );
  return rowHeader ? (
    <th scope="row" className={`${base} font-semibold`}>
      {content}
    </th>
  ) : (
    <td className={base}>{content}</td>
  );
}

function Provenance({ cell }: { cell: GridCell | null }) {
  const src = cell?.sources?.[0];
  if (!cell || !src) return null;
  const rows = src.rows.join(", ");
  const more = src.row_count > src.rows.length ? ` and ${src.row_count - src.rows.length} more` : "";
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-md border border-dashed border-ai/50 px-2.5 py-1.5 text-[0.84em] leading-snug text-fg-muted"
    >
      <Icon name="file" size={13} className="mt-0.5 shrink-0 text-ai" />
      <span className="min-w-0">
        <b className="font-semibold text-fg">{cell.text}</b> is calculated exactly
        from {src.row_count} {src.row_count === 1 ? "row" : "rows"}
        {src.column ? ` of “${src.column}”` : ""} in{" "}
        <span className="font-semibold text-fg">{src.file_name}</span>
        {src.sheet ? ` (sheet ${src.sheet})` : ""}
        {src.rows.length > 0 ? `: ${src.rows.length === 1 ? "row" : "rows"} ${rows}` : ""}
        {more}.
      </span>
    </p>
  );
}

/** Which column or file to use — one tap continues the same result. */
export function ChoicePrompt({
  question,
  options,
  onChoose,
}: {
  question: string;
  options: ChoiceOption[];
  onChoose?: (optionId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.95em] font-semibold text-fg">{question}</p>
      <div role="group" aria-label={question} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={!onChoose}
            onClick={() => onChoose?.(o.id)}
            className="flex flex-col rounded-lg border border-primary/55 bg-primary/10 px-3 py-1.5 text-left text-[0.86em] font-semibold text-primary transition hover:brightness-110 disabled:opacity-50"
          >
            {o.label}
            {o.detail && (
              <span className="font-mono text-[0.78em] font-normal text-fg-faint">
                {o.detail}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The grid as tab-separated text, for Copy and for pasting into a sheet. */
export function gridAsText(grid: GridPayload): string {
  const head = grid.columns.map((c) => c.label).join("\t");
  const body = grid.rows.map((r) => r.cells.map((c) => c.text).join("\t"));
  return [head, ...body].join("\n");
}
