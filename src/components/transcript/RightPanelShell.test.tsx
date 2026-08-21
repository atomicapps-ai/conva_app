import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RightPanelShell } from "@/components/transcript/RightPanelShell";

afterEach(cleanup);

describe("RightPanelShell", () => {
  it("renders children when expanded, hides them when collapsed", () => {
    const { rerender } = render(
      <RightPanelShell
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        mode="starred"
        onSetMode={vi.fn()}
        starredCount={0}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    expect(screen.getByText("panel content")).toBeInTheDocument();

    rerender(
      <RightPanelShell
        collapsed
        onToggleCollapsed={vi.fn()}
        mode="starred"
        onSetMode={vi.fn()}
        starredCount={0}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    expect(screen.queryByText("panel content")).toBeNull();
  });

  it("always shows the expand/collapse arrow, even collapsed", () => {
    render(
      <RightPanelShell
        collapsed
        onToggleCollapsed={vi.fn()}
        mode="starred"
        onSetMode={vi.fn()}
        starredCount={0}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    expect(screen.getByRole("button", { name: "Expand the right panel" })).toBeInTheDocument();
  });

  it("calls onToggleCollapsed when the arrow is clicked", () => {
    const onToggleCollapsed = vi.fn();
    render(
      <RightPanelShell
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
        mode="starred"
        onSetMode={vi.fn()}
        starredCount={0}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse the right panel" }));
    expect(onToggleCollapsed).toHaveBeenCalled();
  });

  it("switches mode via the star/dock buttons", () => {
    const onSetMode = vi.fn();
    render(
      <RightPanelShell
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        mode="starred"
        onSetMode={onSetMode}
        starredCount={2}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show summary, threads, and grounding" }));
    expect(onSetMode).toHaveBeenCalledWith("dock");
  });

  it("the detach button is present but disabled", () => {
    render(
      <RightPanelShell
        collapsed={false}
        onToggleCollapsed={vi.fn()}
        mode="starred"
        onSetMode={vi.fn()}
        starredCount={0}
      >
        <div>panel content</div>
      </RightPanelShell>,
    );
    expect(screen.getByRole("button", { name: /coming soon/i })).toBeDisabled();
  });
});
