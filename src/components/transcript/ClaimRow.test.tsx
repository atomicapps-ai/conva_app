import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaimRow } from "@/components/transcript/ClaimRow";
import type { ClaimDisplayItem } from "@/components/transcript/claims";

afterEach(cleanup);

const claim: ClaimDisplayItem = {
  id: "claim-arizona-crash",
  proposition: "Two people died in the Arizona car crash.",
  state: "attributed",
  attribution: "Speaker → ABC News",
  consequence: "high",
  exactQuote:
    "ABC News is reporting that both people died in that car crash in Arizona.",
  attributionDetail:
    "The speaker attributes the report to ABC News; the outcome is not independently supported yet.",
  referenceDetail: "Both people and that car crash still need event links.",
  nextAction: "Check an official incident record and the cited report.",
  evidenceSummary: "1 report · official source pending",
  processingDisclosure: "Hosted check sends only the normalized claim.",
  safeWording:
    "ABC News is reporting two deaths. We have not independently confirmed the outcome.",
  evidence: [{ label: "ABC News report", location: null }],
  primaryAction: "verify",
  primaryActionLabel: "Check claim",
};

describe("ClaimRow", () => {
  it("shows the compact proposition, attribution, consequence, and state", () => {
    render(<ClaimRow claim={claim} canOpenEvidence onAction={() => {}} />);
    expect(screen.getByText(claim.proposition)).toBeInTheDocument();
    expect(screen.getByText("Speaker → ABC News")).toBeInTheDocument();
    expect(screen.getByText("High consequence")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Attributed");
  });

  it("expands without nesting action buttons inside the disclosure button", () => {
    render(<ClaimRow claim={claim} canOpenEvidence onAction={() => {}} />);
    const disclosure = screen.getByRole("button", { name: /Two people died/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(claim.nextAction)).toBeInTheDocument();
    expect(screen.getByText("Hosted check sends only the normalized claim.")).toBeInTheDocument();
    expect(disclosure.querySelector("button")).toBeNull();
  });

  it("emits typed primary, evidence, correction, and dismissal actions", () => {
    const onAction = vi.fn();
    render(<ClaimRow claim={claim} canOpenEvidence onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /Two people died/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check claim" }));
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "Correct links" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onAction.mock.calls.map((call) => call[1])).toEqual([
      "verify",
      "open_evidence",
      "correct_links",
      "dismiss",
    ]);
  });

  it("honestly disables evidence when the viewer capability is unavailable", () => {
    render(<ClaimRow claim={claim} canOpenEvidence={false} onAction={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Two people died/ }));
    expect(screen.getByRole("button", { name: "Evidence" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Evidence" })).toHaveAttribute(
      "title",
      "Evidence viewer is unavailable on this surface",
    );
  });

  it.each([
    ["checking", "Checking"],
    ["supported", "Supported"],
    ["conflict", "Conflict"],
    ["needs_context", "Needs context"],
  ] as const)("renders %s as %s", (state, label) => {
    render(
      <ClaimRow claim={{ ...claim, state }} canOpenEvidence onAction={() => {}} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(label);
  });
});
