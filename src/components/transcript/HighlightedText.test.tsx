import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HighlightedText } from "./TranscriptView";

// The real bubble path: terms come from `analyze_terms`, origins say why each
// is highlighted. A term recognised only by a domain pack renders quieter and
// says so; everything else keeps full weight.
describe("HighlightedText origins", () => {
  const text = "Did you use an ORM for modeling data?";

  it("renders a pack-only term quieter than the user's own and entity terms", () => {
    render(
      <HighlightedText
        text={text}
        terms={["ORM", "modeling data"]}
        origins={{ orm: "entity", "modeling data": "domain" }}
        onAsk={vi.fn()}
      />,
    );
    const quiet = screen.getByRole("button", { name: "modeling data" });
    const strong = screen.getByRole("button", { name: "ORM" });
    expect(quiet.className).toContain("font-medium");
    expect(quiet).toHaveAttribute("title", "Recognised vocabulary");
    expect(strong.className).toContain("font-semibold");
    expect(strong).not.toHaveAttribute("title");
  });

  it("keeps full weight when no origin is known (user-added phrases, search hits)", () => {
    render(
      <HighlightedText
        text={text}
        terms={["modeling data"]}
        onAsk={vi.fn()}
      />,
    );
    const hit = screen.getByRole("button", { name: "modeling data" });
    expect(hit.className).toContain("font-semibold");
  });

  it("matches origins case-insensitively against the spoken surface", () => {
    render(
      <HighlightedText
        text="We did Modeling   Data yesterday."
        terms={["modeling data"]}
        origins={{ "modeling data": "domain" }}
        onAsk={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Modeling\s+Data/ }).className,
    ).toContain("font-medium");
  });
});
