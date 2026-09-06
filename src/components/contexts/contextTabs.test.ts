import { describe, expect, it } from "vitest";

import {
  CONTEXT_TABS,
  defaultTab,
  tabForKey,
  type ContextTab,
} from "@/components/contexts/contextTabs";

describe("CONTEXT_TABS", () => {
  it("is exactly the four approved first-level tabs, in order", () => {
    expect(CONTEXT_TABS.map((t) => t.label)).toEqual([
      "Overview",
      "Q&A",
      "Briefing",
      "Research",
    ]);
  });
});

describe("defaultTab", () => {
  it("opens Q&A when prepared Q&A exists", () => {
    expect(defaultTab(true)).toBe("qa");
  });

  it("falls back to Overview otherwise", () => {
    expect(defaultTab(false)).toBe("overview");
  });
});

describe("tabForKey", () => {
  it("moves right and wraps at the end", () => {
    expect(tabForKey("overview", "ArrowRight")).toBe("qa");
    expect(tabForKey("research", "ArrowRight")).toBe("overview");
  });

  it("moves left and wraps at the start", () => {
    expect(tabForKey("qa", "ArrowLeft")).toBe("overview");
    expect(tabForKey("overview", "ArrowLeft")).toBe("research");
  });

  it("jumps to the ends with Home/End", () => {
    expect(tabForKey("briefing", "Home")).toBe("overview");
    expect(tabForKey("briefing", "End")).toBe("research");
  });

  it("leaves the tab alone for any other key", () => {
    for (const key of ["a", "Enter", "ArrowDown", " "]) {
      expect(tabForKey("briefing", key)).toBe("briefing");
    }
  });

  it("is a no-op for an unknown current tab", () => {
    expect(tabForKey("nope" as ContextTab, "ArrowRight")).toBe("nope");
  });
});
