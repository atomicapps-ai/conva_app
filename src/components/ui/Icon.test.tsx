import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Icon } from "@/components/ui/Icon";

describe("Icon", () => {
  it("renders the feedback thumb icons (Phase 4)", () => {
    const { container, rerender } = render(<Icon name="thumbUp" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    rerender(<Icon name="thumbDown" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders the star icon outlined by default and filled when asked (F12)", () => {
    const { container, rerender } = render(<Icon name="star" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("fill", "none");
    rerender(<Icon name="star" filled />);
    expect(container.querySelector("svg")).toHaveAttribute("fill", "currentColor");
  });
});
