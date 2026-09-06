import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";

export interface FilterGroup {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  /** "all" is the sentinel for "no filter" within this group. */
  selected: string;
  onChange: (value: string) => void;
}

/**
 * Search-bar filter-property popover — a funnel icon on the right edge of
 * a search box; click opens a small menu of filterable properties (owner,
 * 2026-08-29: "the filter icon on the right of the search box, then when
 * clicked the user can select different properties to filter against").
 * Shared by `ContextsPane.tsx` and `LibraryPane.tsx` so both search boxes
 * follow the same rule. Same open/close-on-outside-{click,resize,scroll}
 * shape used throughout this screen (`ContextInfoPopover`,
 * `LibraryRowMenu`, the retired `RowMenu`) — but plain `absolute`
 * positioning rather than `fixed`+viewport-clamp, since the search bar
 * sits above the pane's own scrolling list, not inside it, so there's
 * nothing to escape-clip from.
 */
export function FilterPopover({ groups }: { groups: FilterGroup[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const activeCount = groups.filter((g) => g.selected !== "all").length;

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="Filter"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Filter"
        className={[
          "shrink-0 rounded-sm p-1 transition",
          activeCount > 0
            ? "text-ai hover:bg-ai/10"
            : "text-fg-faint hover:bg-panel-raised/60 hover:text-fg",
        ].join(" ")}
      >
        <Icon name="filter" size={13} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Filter"
          onClick={(e) => e.stopPropagation()}
          className="glass-raised absolute right-0 top-[calc(100%+4px)] z-50 w-[200px] rounded-lg border border-border p-2 shadow-[var(--shadow-lg)]"
        >
          <div className="flex flex-col gap-2.5">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-fg-faint">
                  {g.label}
                </p>
                <div className="flex flex-wrap gap-1">
                  {g.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => g.onChange(o.value)}
                      aria-pressed={g.selected === o.value}
                      className={[
                        "rounded-full border px-2 py-0.5 text-[11px] transition",
                        g.selected === o.value
                          ? "border-primary/50 bg-primary/[0.12] text-fg"
                          : "border-border text-fg-faint hover:text-fg",
                      ].join(" ")}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
