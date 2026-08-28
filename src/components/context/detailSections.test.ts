import { describe, expect, it } from "vitest";

import { toggleDetailSection } from "@/components/context/detailSections";

describe("toggleDetailSection", () => {
  it("opens a section from fully-collapsed", () => {
    expect(toggleDetailSection(null, "knowledge")).toBe("knowledge");
  });

  it("switches between sections (exclusive — only one open at a time)", () => {
    expect(toggleDetailSection("counterparty", "knowledge")).toBe("knowledge");
  });

  it("collapses the open section back to none when clicked again", () => {
    expect(toggleDetailSection("knowledge", "knowledge")).toBe(null);
  });
});
