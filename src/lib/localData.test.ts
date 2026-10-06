import { describe, expect, it } from "vitest";

import { describeCategory, erasableBytes, formatDuration, plural } from "@/lib/localData";

const cat = (count: number, bytes: number) => ({ count, bytes });

describe("local data formatting", () => {
  it("formats a recording length as m:ss or h:mm:ss, and an unreadable one as a dash", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(48 * 60_000 + 5_000)).toBe("48:05");
    expect(formatDuration(3600_000 + 12 * 60_000 + 40_000)).toBe("1:12:40");
    expect(formatDuration(null)).toBe("—");
  });

  it("pluralizes and describes a category", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(3, "file")).toBe("3 files");
    expect(plural(1, "Context")).toBe("1 Context");
    expect(describeCategory(cat(0, 0), "file")).toBe("None");
    expect(describeCategory(cat(3, 412 * 1024 * 1024), "file")).toBe("3 files · 412 MB");
  });

  it("totals what an erase removes without the models", () => {
    expect(
      erasableBytes({
        recordings: cat(1, 100),
        conversations: cat(1, 10),
        session_logs: cat(1, 1),
        library: cat(1, 1000),
        contexts: cat(1, 5),
        diagnostics: cat(1, 2),
      }),
    ).toBe(1118);
  });
});
