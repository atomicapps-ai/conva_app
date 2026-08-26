import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SimConSetup } from "@/components/simcon/SimConSetup";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";

afterEach(cleanup);

// Minimal fake — the wizard only calls rag.list() on mount; the rest is local
// React state until Finish (which these tests don't reach).
function fakeBackend(): ConvaBackend {
  return {
    rag: { list: vi.fn().mockResolvedValue([]) },
  } as unknown as ConvaBackend;
}

function renderSetup() {
  render(
    <BackendProvider backend={fakeBackend()}>
      <SimConSetup onDone={() => undefined} onCancel={() => undefined} />
    </BackendProvider>,
  );
}

describe("SimConSetup wizard", () => {
  it("offers the four conversation types", async () => {
    renderSetup();
    // findBy flushes the mount effect (rag.list) so no act() warnings.
    expect(await screen.findByRole("button", { name: "Interview" })).toBeInTheDocument();
    for (const type of ["Company meeting", "Sales call", "Other"]) {
      expect(screen.getByRole("button", { name: type })).toBeInTheDocument();
    }
  });

  it("shows the job-description field only for Interview", async () => {
    renderSetup();
    // Interview is the default type → JD field present.
    expect(await screen.findByPlaceholderText(/job description/i)).toBeInTheDocument();
    // Switching to an internal type hides it.
    fireEvent.click(screen.getByRole("button", { name: "Company meeting" }));
    expect(screen.queryByPlaceholderText(/job description/i)).toBeNull();
  });

  it("defaults web research on for the Interview type", async () => {
    renderSetup();
    // Name is required to advance to step 2.
    const name = await screen.findByPlaceholderText(/Senior Accountant interview/i);
    fireEvent.change(name, { target: { value: "My interview" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // The research toggle (now joined on step 2 by the interview-only deep
    // Q&A checkbox) is on by default for Interview.
    expect(
      screen.getByRole("checkbox", { name: /research the web for context/i }),
    ).toBeChecked();
  });
});
