import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListRow } from "@/components/ui/ListRow";

afterEach(cleanup);

describe("ListRow", () => {
  it("renders title, badge, and date", () => {
    render(
      <ListRow
        accent="primary"
        title="Amazon interview prep"
        badge={{ text: "Context", tone: "ai" }}
        date="8/21/2026, 4:40:25 PM · 5 segments"
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Amazon interview prep")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText("8/21/2026, 4:40:25 PM · 5 segments")).toBeInTheDocument();
  });

  it("clicking the row calls onClick", () => {
    const onClick = vi.fn();
    render(<ListRow accent="muted" title="Row" date="—" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Row" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("checking the checkbox fires onSelectChange, not onClick", () => {
    const onClick = vi.fn();
    const onSelectChange = vi.fn();
    render(
      <ListRow
        accent="primary"
        title="Row"
        date="—"
        onClick={onClick}
        onSelectChange={onSelectChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Row" }));
    expect(onSelectChange).toHaveBeenCalledWith(true);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("clicking the trash can fires onDelete, not onClick", () => {
    const onClick = vi.fn();
    const onDelete = vi.fn();
    render(
      <ListRow accent="primary" title="Row" date="—" onClick={onClick} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Row" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("omitting onSelectChange/onOpenViewer/onOpenLive/onDelete renders no checkbox or action buttons", () => {
    render(<ListRow accent="muted" title="Row" date="—" onClick={vi.fn()} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /transcript viewer/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /open row in live/i })).toBeNull();
  });

  it("clicking the transcript-viewer icon fires onOpenViewer, not onClick", () => {
    const onClick = vi.fn();
    const onOpenViewer = vi.fn();
    render(
      <ListRow
        accent="primary"
        title="Row"
        date="—"
        onClick={onClick}
        onOpenViewer={onOpenViewer}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Row in the transcript viewer" }));
    expect(onOpenViewer).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("clicking the Live icon fires onOpenLive, not onClick", () => {
    const onClick = vi.fn();
    const onOpenLive = vi.fn();
    render(
      <ListRow accent="primary" title="Row" date="—" onClick={onClick} onOpenLive={onOpenLive} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Row in Live" }));
    expect(onOpenLive).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders the icon column only when an icon is provided", () => {
    const { container, rerender } = render(
      <ListRow accent="muted" title="Row" date="—" onClick={vi.fn()} />,
    );
    expect(container.querySelector("svg")).toBeNull();
    rerender(
      <ListRow
        accent="ai"
        title="Row"
        date="—"
        icon={{ icon: "live", color: "#4FB8FF" }}
        onClick={vi.fn()}
      />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
