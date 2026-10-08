import { useEffect, useState } from "react";

import { useBackend, useCapabilities } from "@/lib/backend";
import { formatBytes } from "@/lib/formatBytes";
import type { EraseReport } from "@/lib/ipc";
import { plural } from "@/lib/localData";

/**
 * Shown once, after the restart that carried out "Erase everything on this
 * computer". The shell keeps the result in a small file until it is read here.
 * Anything it could not remove is listed, so a partial erase is never silent.
 * Desktop only; on the web the read is unsupported and nothing renders.
 */
export function EraseReportToast() {
  const backend = useBackend();
  const caps = useCapabilities();
  const desktop = caps?.system.updater === true;
  const [report, setReport] = useState<EraseReport | null>(null);

  useEffect(() => {
    if (!desktop) return;
    void backend.localData
      .takeEraseReport()
      .then((r) => setReport(r))
      .catch(() => {});
  }, [backend, desktop]);

  if (!report) return null;
  const clean = report.failed.length === 0;
  return (
    <div
      role="status"
      data-testid="erase-report"
      className={`fixed bottom-4 right-4 z-40 max-w-sm rounded-lg border bg-panel-raised p-3 text-[12px] text-fg shadow-lg ${
        clean ? "border-ok/40" : "border-rec/40"
      }`}
    >
      <div className="font-semibold">
        {clean ? "Erased" : "Erased, with problems"}: {plural(report.removed_files, "file")} · {formatBytes(report.removed_bytes)}
        {report.keys_removed ? ", and your API keys" : ""}
      </div>
      {!clean && (
        <p className="mt-1 text-fg-muted">
          Could not remove: <span className="font-mono">{report.failed.join(", ")}</span>. Close anything using them and
          erase again.
        </p>
      )}
      <button type="button" className="btn mt-2" onClick={() => setReport(null)}>
        Dismiss
      </button>
    </div>
  );
}
