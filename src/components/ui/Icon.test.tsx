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

  it("renders the partner-window lock icons", () => {
    const { container, rerender } = render(<Icon name="lock" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    rerender(<Icon name="unlock" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders the panel-spine section icons", () => {
    const { container, rerender } = render(<Icon name="question" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    rerender(<Icon name="target" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
