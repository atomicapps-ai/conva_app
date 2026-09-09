import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import markSource from "@/assets/brand/conva-mark-cutout-white.svg?raw";
import { LockedMark, LockedMarkBadge } from "@/components/ui/LockedIcon";

function sourcePath(): string {
  const match = markSource.match(/<path[^>]+d="([^"]+)"/);
  if (!match?.[1]) throw new Error("Brand mark source has no path geometry");
  return match[1];
}

describe("locked Conva mark", () => {
  it("uses the owner-supplied geometry instead of the retired web export", () => {
    const d = sourcePath();
    expect(d).toContain("M500.89,337.75");
    expect(d).not.toContain("M489.65 333.91");
  });

  it("keeps the dashboard badge and compact mark identical to the SVG source", () => {
    const d = sourcePath();
    const { unmount } = render(<LockedMark title="compact conva mark" />);
    expect(screen.getByRole("img", { name: "compact conva mark" }).querySelector("path"))
      .toHaveAttribute("d", d);
    unmount();

    render(<LockedMarkBadge title="dashboard conva mark" />);
    const badgePaths = screen
      .getByRole("img", { name: "dashboard conva mark" })
      .querySelectorAll("path");
    expect(badgePaths[1]).toHaveAttribute("d", d);
  });
});
