import type { RagDocument } from "@/lib/ipc";

/**
 * Marks a CSV / XLSX document that carries a typed table. "Table" means
 * totals and counts over it are computed exactly; "Search only" is said out
 * loud when the sheet's structure (merged cells, no header row) rules that
 * out, so nobody expects a total that will never come.
 */
export function TableBadge({ doc }: { doc: Pick<RagDocument, "table"> }) {
  const table = doc.table;
  if (!table) return null;
  if (!table.supported) {
    return (
      <span
        title="This sheet's layout can't be totalled safely, so it is searchable as text only. A single-sheet CSV with one heading row works."
        className="shrink-0 rounded-full border border-notice/50 px-1.5 py-0.5 text-[10px] font-semibold text-notice"
      >
        Search only
      </span>
    );
  }
  return (
    <span
      title="Totals and counts over this sheet are computed exactly, not guessed."
      className="shrink-0 rounded-full border border-primary/45 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
    >
      Table · {table.rows.toLocaleString()} rows
    </span>
  );
}
