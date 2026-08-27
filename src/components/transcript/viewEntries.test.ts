import { describe, expect, it } from "vitest";

import {
  prependOrFocus,
  removeEntry,
  toggleExpanded,
  type ViewEntry,
} from "@/components/transcript/viewEntries";
import type { FoundItem } from "@/components/transcript/foundGroups";

function item(id: string): FoundItem {
  return { id, group: "term", label: id, detail: null };
}

describe("prependOrFocus", () => {
  it("prepends a new entry with an increasing seq and reports appended — newest first, so it pushes the rest down", () => {
    const r1 = prependOrFocus([], item("a"), 1);
    const r2 = prependOrFocus(r1.entries, item("b"), 2);
    expect(r2.entries.map((e) => e.key)).toEqual(["b", "a"]);
    expect(r2.entries[0]?.seq).toBe(2);
    expect(r2.appended).toBe(true);
    expect(r2.focusKey).toBe("b");
  });

  it("focuses an existing entry instead of duplicating", () => {
    const r1 = prependOrFocus([], item("a"), 1);
    const r2 = prependOrFocus(r1.entries, item("a"), 2);
    expect(r2.entries).toHaveLength(1);
    expect(r2.appended).toBe(false);
    expect(r2.focusKey).toBe("a");
  });

  it("a third selection lands at the very top, ahead of both prior picks", () => {
    let entries: ViewEntry[] = prependOrFocus([], item("a"), 1).entries;
    entries = prependOrFocus(entries, item("b"), 2).entries;
    entries = prependOrFocus(entries, item("c"), 3).entries;
    expect(entries.map((e) => e.key)).toEqual(["c", "b", "a"]);
  });
});

describe("removeEntry / toggleExpanded", () => {
  it("removes by key", () => {
    const { entries } = prependOrFocus([], item("a"), 1);
    expect(removeEntry(entries, "a")).toEqual([]);
    expect(removeEntry(entries, "zz")).toHaveLength(1);
  });

  it("toggles expanded on one entry only", () => {
    let entries: ViewEntry[] = prependOrFocus([], item("a"), 1).entries;
    entries = prependOrFocus(entries, item("b"), 2).entries;
    const toggled = toggleExpanded(entries, "a");
    expect(toggled.find((e) => e.key === "a")?.expanded).toBe(true);
    expect(toggled.find((e) => e.key === "b")?.expanded).toBe(false);
  });
});
