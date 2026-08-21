import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FanerMark } from "@/components/transcript/TranscriptView";
import type { Capture } from "@/lib/ipc";
import type { FanerHit } from "@/lib/faner";

afterEach(cleanup);

function hit(overrides: Partial<Capture> = {}): FanerHit {
  const capture: Capture = {
    trigger: "task_frame",
    action: "EXPLAIN",
    arguments: ["Terraform state locking"],
    tier: "specialized",
    kind: "concept",
    preview: "Terraform locks remote state during an apply to avoid races.",
    ...overrides,
  };
  return { phrase: "Terraform state locking", capture };
}

describe("FanerMark", () => {
  it("does not show the popover on mount — clicking is required, not hovering", () => {
    render(<FanerMark hit={hit()} onAsk={vi.fn()} onSendToAsk={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The marked phrase itself carries no click/hover handler of its own —
    // only the trailing icon button does.
    expect(screen.getByText("Terraform state locking").tagName).toBe("SPAN");
  });

  it("opens the popover — with the capture's preview — only when the trailing icon is clicked", () => {
    render(<FanerMark hit={hit()} onAsk={vi.fn()} onSendToAsk={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show why/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Terraform locks remote state during an apply to avoid races.",
    );
  });

  it("closes on outside click", () => {
    render(<FanerMark hit={hit()} onAsk={vi.fn()} onSendToAsk={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show why/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape", () => {
    render(<FanerMark hit={hit()} onAsk={vi.fn()} onSendToAsk={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show why/i }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking the star action asks Ally, stars, and closes the popover", () => {
    const onAsk = vi.fn();
    const h = hit();
    render(<FanerMark hit={h} onAsk={onAsk} onSendToAsk={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Show why/i }));
    fireEvent.click(screen.getByRole("button", { name: /Ask Ally about ".*" and star it/i }));
    expect(onAsk).toHaveBeenCalledWith(h.capture, "Terraform state locking");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toggling the trigger a second time closes it without a body click", () => {
    render(<FanerMark hit={hit()} onAsk={vi.fn()} onSendToAsk={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /Show why/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
