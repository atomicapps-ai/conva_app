import type {
  FoundGroups,
  FoundItem,
} from "@/components/transcript/foundGroups";

/**
 * The Found half (spec §3.2) — everything the AI surfaced, grouped in
 * urgency order, each item one tap from showing its card in the View half
 * below. Groups hide entirely while empty; the sanctioned mono eyebrow is
 * the group header. Chip dots: azure = detected live, gold = doc term,
 * neutral = mention.
 */
export function FoundList({
  groups,
  onSelect,
}: {
  groups: FoundGroups;
  onSelect: (item: FoundItem) => void;
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
      className="flex w-full items-baseline gap-2 rounded-[var(--radius)] border border-border bg-panel px-2.5 py-1.5 text-left transition hover:border-ai/40"
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
      className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-[3px] text-[0.86em] font-semibold text-fg-muted transition hover:text-fg"
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
        <div className="flex flex-col gap-1.5">
          {header("They asked")}
          {groups.questions.map(row)}
        </div>
      )}
      {groups.commitments.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {header("Commitments")}
          {groups.commitments.map(row)}
        </div>
      )}
      {groups.terms.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {header("Terms")}
          <div className="flex flex-wrap gap-1.5">
            {groups.terms.map(chipButton)}
          </div>
        </div>
      )}
      {groups.mentions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {header("Mentioned")}
          <div className="flex flex-wrap gap-1.5">
            {groups.mentions.map(chipButton)}
          </div>
        </div>
      )}
    </div>
  );
}
