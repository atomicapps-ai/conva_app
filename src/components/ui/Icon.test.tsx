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
});
