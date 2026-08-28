import { describe, expect, it } from "vitest";

import { formatBytes } from "@/lib/formatBytes";

describe("formatBytes", () => {
  it("shows plain bytes with no decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(5)).toBe("5 B");
    expect(formatBytes(850)).toBe("850 B");
  });

  it("scales to KB, dropping the decimal once the number is >= 10", () => {
    expect(formatBytes(15_400)).toBe("15 KB");
    expect(formatBytes(219_000)).toBe("214 KB");
  });

  it("scales to MB, keeping one decimal under 10 and dropping it at 10+", () => {
    expect(formatBytes(1_258_000)).toBe("1.2 MB");
    expect(formatBytes(45_000_000)).toBe("43 MB");
  });

  it("scales to GB for very large totals", () => {
    expect(formatBytes(5_000_000_000)).toBe("4.7 GB");
  });

  it("caps at GB rather than continuing to TB", () => {
    expect(formatBytes(5_000_000_000_000)).toBe("4657 GB");
  });
});
