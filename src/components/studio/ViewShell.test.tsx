import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Section, ViewActionFooter, ViewShell } from "@/components/studio/ViewShell";

describe("ViewShell workflow actions", () => {
  it("keeps the header and workflow footer outside the scrolling body", () => {
    render(
      <ViewShell
        icon="simicon"
        title="Edit Context"
        actions={<button type="button">Next</button>}
        footer={
          <ViewActionFooter
            previous={{ label: "Previous", onClick: vi.fn() }}
            status="Step 2 of 3"
          >
            <button type="button">Next: Review</button>
          </ViewActionFooter>
        }
      >
        <div>Scrollable workflow content</div>
      </ViewShell>,
    );

    const header = screen.getByRole("banner");
    const footer = screen.getByRole("navigation", { name: "Workflow actions" });
    const body = screen.getByText("Scrollable workflow content").parentElement?.parentElement;

    expect(header.parentElement).toBe(footer.parentElement);
    expect(body?.previousElementSibling).toBe(header);
    expect(body?.nextElementSibling).toBe(footer);
  });

  it("places compact document actions in the section heading", () => {
    render(
      <Section
        title="People and witnesses"
        actions={<button type="button">Upload</button>}
      >
        Drop resources here
      </Section>,
    );

    const heading = screen.getByRole("heading", { name: "People and witnesses" });
    const upload = screen.getByRole("button", { name: "Upload" });
    expect(heading.parentElement).toContainElement(upload);
  });
});
