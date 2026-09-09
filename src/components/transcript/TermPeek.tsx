import { useEffect } from "react";

import { Icon } from "@/components/ui/Icon";

export interface TermPeekModel {
  term: string;
  definition: string;
  sourceLabel: string;
  status: "cached" | "streaming" | "ready" | "busy" | "error";
  pinned: boolean;
}
const STATUS_LABEL: Record<TermPeekModel["status"], string> = {
  cached: "From this Context",
  streaming: "Defining…",
  ready: "Defined by Ally",
  busy: "Ally is busy",
  error: "Definition unavailable",
};

export function TermPeek({
  model,
  canOpenDetails,
  onClose,
  onTogglePin,
  onAskMore,
  onOpenDetails,
}: {
  model: TermPeekModel | null;
  canOpenDetails: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onAskMore: () => void;
  onOpenDetails: () => void;
}) {
  useEffect(() => {
    if (!model || model.pinned) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [model, onClose]);

  if (!model) return null;

  return (
    <>
      {!model.pinned && (
        <button
          type="button"
          aria-label="Close term definition"
          onClick={onClose}
          className="fixed inset-0 z-50 cursor-default bg-black/15"
        />
      )}
      <section
        role="dialog"
        aria-label={`Definition of ${model.term}`}
        className={[
          "glass-raised fixed z-[60] flex max-h-[min(480px,78vh)] w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border-strong bg-panel-raised shadow-[var(--shadow-lg)]",
          model.pinned
            ? "bottom-12 right-4"
            : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
        ].join(" ")}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius)] bg-ai/12 text-ai">
            <Icon name="book" size={15} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-fg">
            {model.term}
          </span>
          <span className="font-mono text-[9px] text-fg-faint">
            {STATUS_LABEL[model.status]}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close term definition"
            className="grid h-7 w-7 place-items-center rounded text-fg-faint transition hover:text-fg"
          >
            <Icon name="close" size={13} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-ai">
            Used here as
          </p>
          <div className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-fg">
            {model.definition ||
              (model.status === "busy"
                ? "Finish the current Ally request, then try this definition again."
                : model.status === "error"
                  ? "Ally could not define this term. You can retry or ask about it in Focus."
                  : "Ally is resolving the meaning from this conversation…")}
          </div>
          {model.sourceLabel && (
            <p className="mt-3 text-[10.5px] text-fg-faint">{model.sourceLabel}</p>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-2.5 py-2">
          <button
            type="button"
            aria-pressed={model.pinned}
            onClick={onTogglePin}
            className={[
              "flex h-7 items-center gap-1 rounded border px-2 text-[10.5px] transition",
              model.pinned
                ? "border-ai/55 bg-ai/10 text-ai"
                : "border-border text-fg-muted hover:text-fg",
            ].join(" ")}
          >
            <Icon name="pin" size={12} />
            {model.pinned ? "Pinned" : "Pin"}
          </button>
          <button
            type="button"
            onClick={onAskMore}
            className="h-7 rounded border border-border px-2 text-[10.5px] text-fg-muted transition hover:text-fg"
          >
            Ask more
          </button>
          {canOpenDetails && (
            <button
              type="button"
              onClick={onOpenDetails}
              className="ml-auto flex h-7 items-center gap-1 rounded border border-primary/45 bg-primary/[0.08] px-2 text-[10.5px] text-primary transition hover:brightness-110"
            >
              <Icon name="expand" size={12} />
              Details
            </button>
          )}
        </footer>
      </section>
    </>
  );
}
