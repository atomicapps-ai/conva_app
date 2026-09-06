import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SubscriptionSettings } from "@/components/SubscriptionSettings";

afterEach(cleanup);

describe("SubscriptionSettings", () => {
  it("shows Free as the current plan by default", () => {
    render(<SubscriptionSettings />);
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Current plan")).toBeInTheDocument();
    expect(screen.getByText("Conva Membership")).toBeInTheDocument();
    expect(screen.getByText("$7.99/mo")).toBeInTheDocument();
  });

  it("clicking Upgrade reveals the card form", () => {
    render(<SubscriptionSettings />);
    expect(screen.queryByText("Card number")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    expect(screen.getByText("Card number")).toBeInTheDocument();
  });

  it("saving a card flips to Conva Membership active with a masked number", () => {
    render(<SubscriptionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    fireEvent.change(screen.getByPlaceholderText("4242 4242 4242 4242"), {
      target: { value: "5555 4444 3333 2222" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save payment method" }));
    expect(screen.getByText("•••• 2222")).toBeInTheDocument();
    // Only one "Conva Membership" now — the standalone upgrade card is gone.
    expect(screen.getAllByText("Conva Membership")).toHaveLength(1);
  });

  it("downgrading returns to Free", () => {
    render(<SubscriptionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    fireEvent.click(screen.getByRole("button", { name: "Save payment method" }));
    fireEvent.click(screen.getByRole("button", { name: "Downgrade to Free" }));
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Conva Membership")).toBeInTheDocument();
    expect(screen.getByText("$7.99/mo")).toBeInTheDocument();
  });
});
