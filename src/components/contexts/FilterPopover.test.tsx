import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilterPopover, type FilterGroup } from "@/components/contexts/FilterPopover";

afterEach(cleanup);

function group(overrides: Partial<FilterGroup> = {}): FilterGroup {
  return {
    key: "source",
    label: "Source",
    options: [
      { value: "all", label: "All" },
      { value: "pasted", label: "Pasted" },
    ],
    selected: "all",
    onChange: vi.fn(),
    ...overrides,
  };
}

describe("FilterPopover", () => {
  it("is closed by default; opens on click, showing every group's options", () => {
    render(<FilterPopover groups={[group()]} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pasted" })).toBeInTheDocument();
  });

  it("clicking an option calls that group's onChange with the option's value", () => {
    const onChange = vi.fn();
    render(<FilterPopover groups={[group({ onChange })]} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("button", { name: "Pasted" }));
    expect(onChange).toHaveBeenCalledWith("pasted");
  });

  it("the trigger reads as active once any group's selection isn't the 'all' sentinel", () => {
    const { rerender } = render(<FilterPopover groups={[group()]} />);
    expect(screen.getByRole("button", { name: /filter/i })).toHaveClass("text-fg-faint");

    rerender(<FilterPopover groups={[group({ selected: "pasted" })]} />);
    expect(screen.getByRole("button", { name: /filter/i })).toHaveClass("text-ai");
  });

  it("closes when clicking outside", () => {
    render(<FilterPopover groups={[group()]} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
