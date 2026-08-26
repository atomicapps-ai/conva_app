import { describe, expect, it } from "vitest";

import {
  appendOrFocus,
  removeEntry,
  toggleExpanded,
  type ViewEntry,
} from "@/components/transcript/viewEntries";
import type { FoundItem } from "@/components/transcript/foundGroups";

function item(id: string): FoundItem {
  return { id, group: "term", label: id, detail: null };
}

describe("appendOrFocus", () => {
  it("appends a new entry with an increasing seq and reports appended", () => {
    const r1 = appendOrFocus([], item("a"), 1);
    const r2 = appendOrFocus(r1.entries, item("b"), 2);
    expect(r2.entries.map((e) => e.key)).toEqual(["a", "b"]);
    expect(r2.entries[1]?.seq).toBe(2);
    expect(r2.appended).toBe(true);
    expect(r2.focusKey).toBe("b");
  });

  it("focuses an existing entry instead of duplicating", () => {
    const r1 = appendOrFocus([], item("a"), 1);
    const r2 = appendOrFocus(r1.entries, item("a"), 2);
    expect(r2.entries).toHaveLength(1);
    expect(r2.appended).toBe(false);
    expect(r2.focusKey).toBe("a");
  });
});

describe("removeEntry / toggleExpanded", () => {
  it("removes by key", () => {
    const { entries } = appendOrFocus([], item("a"), 1);
    expect(removeEntry(entries, "a")).toEqual([]);
    expect(removeEntry(entries, "zz")).toHaveLength(1);
  });

  it("toggles expanded on one entry only", () => {
    let entries: ViewEntry[] = appendOrFocus([], item("a"), 1).entries;
    entries = appendOrFocus(entries, item("b"), 2).entries;
    const toggled = toggleExpanded(entries, "a");
    expect(toggled.find((e) => e.key === "a")?.expanded).toBe(true);
    expect(toggled.find((e) => e.key === "b")?.expanded).toBe(false);
  });
});
