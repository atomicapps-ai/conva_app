import type {
  FoundGroups,
  FoundItem,
} from "@/components/transcript/foundGroups";

/** Per-section empty-state copy for single-group (`only`) mode. */
const ONLY_EMPTY: Record<"questions" | "tracking" | "terms", string> = {
  questions: "Nothing yet — questions from the other side land here.",
  tracking: "Commitments and mentions appear as the call goes.",
  terms: "Terms appear as they're detected — and from your grounded documents.",
};

/**
 * The Found half (spec §3.2) — everything the AI surfaced, grouped in
 * urgency order, each item one tap from showing its card in the View half
 * below. Groups hide entirely while empty; the sanctioned mono eyebrow is
 * the group header. Chip dots: azure = detected live, gold = doc term,
 * neutral = mention.
 *
 * Single-group mode (spine accordion, spec 2026-08-26): with `only` set,
 * render ONLY that accordion section's items with NO eyebrow headers (the
 * accordion's own section header replaces them) — `tracking` is commitment
 * rows followed by mention chips — plus a per-section empty-state line.
 */
export function FoundList({
  groups,
  onSelect,
  only,
}: {
  groups: FoundGroups;
  onSelect: (item: FoundItem) => void;
  only?: "questions" | "tracking" | "terms";
}) {
  const empty =
    groups.questions.length === 0 &&
    groups.commitments.length === 0 &&
    groups.terms.length === 0 &&
    groups.mentions.length === 0;

  const header = (label: string) => (
    <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
      {label}
    </h4>
  );

  const row = (item: FoundItem) => (
    <button
      key={item.id}
      type="button"
      onClick={() => onSelect(item)}
      className="flex w-full items-baseline gap-2 rounded-[var(--radius)] border border-border bg-panel px-2 py-1 text-left transition hover:border-ai/40"
    >
      <span className="min-w-0 flex-1 truncate text-[0.9em] text-fg">
        {item.label}
      </span>
      {item.detail && (
        <span className="shrink-0 font-mono text-[9.5px] text-fg-faint">
          {item.detail}
        </span>
      )}
    </button>
  );

  const chipButton = (item: FoundItem) => (
    <button
      key={item.id}
      type="button"
      onClick={() => onSelect(item)}
      className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-panel px-2 py-[2px] text-[0.86em] font-semibold text-fg-muted transition hover:text-fg"
    >
      <span
        className={`h-[5px] w-[5px] shrink-0 rounded-full ${
          item.group === "mention"
            ? "bg-fg-muted"
            : item.chip?.source === "doc"
              ? "bg-ai"
              : "bg-primary"
        }`}
        aria-hidden
      />
      <span className="min-w-0 truncate">{item.label}</span>
    </button>
  );

  if (only) {
    const emptyLine = (
      <p className="px-1 py-3 text-[0.86em] text-fg-faint">{ONLY_EMPTY[only]}</p>
    );
    if (only === "questions") {
      if (groups.questions.length === 0) return emptyLine;
      return (
        <div className="flex flex-col gap-1">{groups.questions.map(row)}</div>
      );
    }
    if (only === "tracking") {
      if (groups.commitments.length === 0 && groups.mentions.length === 0)
        return emptyLine;
      return (
        <div className="flex flex-col gap-3">
          {groups.commitments.length > 0 && (
            <div className="flex flex-col gap-1">
              {groups.commitments.map(row)}
            </div>
          )}
          {groups.mentions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {groups.mentions.map(chipButton)}
            </div>
          )}
        </div>
      );
    }
    if (groups.terms.length === 0) return emptyLine;
    return (
      <div className="flex flex-wrap gap-1">{groups.terms.map(chipButton)}</div>
    );
  }

  if (empty) {
    return (
      <p className="px-1 py-3 text-[0.86em] text-fg-faint">
        Questions, commitments, terms, and mentions Ally catches appear here
        as the conversation runs.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.questions.length > 0 && (
        <div className="flex flex-col gap-1">
          {header("They asked")}
          {groups.questions.map(row)}
        </div>
      )}
      {groups.commitments.length > 0 && (
        <div className="flex flex-col gap-1">
          {header("Commitments")}
          {groups.commitments.map(row)}
        </div>
      )}
      {groups.terms.length > 0 && (
        <div className="flex flex-col gap-1">
          {header("Terms")}
          <div className="flex flex-wrap gap-1">
            {groups.terms.map(chipButton)}
          </div>
        </div>
      )}
      {groups.mentions.length > 0 && (
        <div className="flex flex-col gap-1">
          {header("Mentioned")}
          <div className="flex flex-wrap gap-1">
            {groups.mentions.map(chipButton)}
          </div>
        </div>
      )}
    </div>
  );
}
