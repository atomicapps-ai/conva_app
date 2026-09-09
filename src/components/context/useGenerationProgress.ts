import { useEffect, useState } from "react";

import { useBackend } from "@/lib/backend";
import type { ContextGenerateProgressEvent } from "@/lib/ipc";

export interface GenerationProgress {
  percent: number;
  label: string;
  elapsedMs: number;
}

const STAGE_LABEL: Record<ContextGenerateProgressEvent["stage"], string> = {
  researching: "Researching the web…",
  writing_qa: "Writing prepared Q&A…",
  compiling_knowledge: "Compiling Context Intelligence…",
  saving: "Saving…",
};

/**
 * Live progress for the Generate/Regenerate resources pipeline.
 * `context.generateDossier` is one blocking round trip with no return until
 * every stage finishes, so without this the button's spinner was the only
 * signal a run was even happening, with no sense of how far along it was.
 *
 * Backed by `contextGenerateProgress` events (desktop only — the web backend
 * has no producer for it yet, so `percent`/`label` there just never move
 * past "Starting…", the same harmless no-op every other Layer-4-only event
 * degrades to). `elapsedMs` ticks every second from the moment `active`
 * turns true, independent of the events — there's no real ETA to give (it
 * depends on LLM + web-research latency), so this answers "how long has
 * this been running", not "how long is left".
 */
export function useGenerationProgress(
  active: boolean,
  contextId: string | undefined,
): GenerationProgress {
  const backend = useBackend();
  const [event, setEvent] = useState<ContextGenerateProgressEvent | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setEvent(null);
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedMs(0);
    const tick = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    // Some test/fake backends stub only the operations a given test cares
    // about, so `subscribe` itself may be absent — the elapsed timer above
    // still runs either way, just without live stage updates.
    if (backend.subscribe) {
      void backend
        .subscribe("contextGenerateProgress", (e) => {
          if (e.context_id === contextId) setEvent(e);
        })
        .then((u) => {
          if (cancelled) u();
          else unsubscribe = u;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      window.clearInterval(tick);
      unsubscribe?.();
    };
  }, [active, backend, contextId]);

  return {
    percent: event?.percent ?? 0,
    label: event ? STAGE_LABEL[event.stage] : "Starting…",
    elapsedMs,
  };
}
