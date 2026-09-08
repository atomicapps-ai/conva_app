import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownDocument, parseMarkdownBlocks } from "@/components/ui/MarkdownDocument";

afterEach(cleanup);

describe("MarkdownDocument", () => {
  it("renders generated markdown as a readable document by default", () => {
    render(<MarkdownDocument text={"# Context Knowledge\n\n## Facts\n- **Seven** people were aboard."} />);

    expect(screen.getByRole("heading", { name: "Context Knowledge" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Facts" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("Seven people were aboard.");
    expect(screen.queryByText(/^# Context Knowledge/)).not.toBeInTheDocument();
  });

  it("keeps the exact source available in Raw view", () => {
    const source = "## Sources\n- [Report](https://example.test/report)";
    render(<MarkdownDocument text={source} />);

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(screen.getByText((_, element) => element?.tagName === "PRE" && element.textContent === source)).toBeInTheDocument();
  });

  it("does not turn unsafe links into anchors", () => {
    render(<MarkdownDocument text={"[Open](javascript:alert(1))"} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("parseMarkdownBlocks", () => {
  it("groups adjacent list items and preserves ordered lists", () => {
    expect(parseMarkdownBlocks("1. First\n2. Second")).toEqual([
      { kind: "list", ordered: true, items: ["First", "Second"] },
    ]);
  });
});
