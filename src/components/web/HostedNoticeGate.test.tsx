import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { HostedNoticeGate } from "@/components/web/HostedNoticeGate";
import { requestHostedConsent, useHostedConsentStore } from "@/state/hostedConsent";

describe("HostedNoticeGate (web, cp16)", () => {
  beforeEach(() => {
    useHostedConsentStore.getState().reset();
    useHostedConsentStore.getState().setTerms({ asr: { provider: "deepgram", region: "us", mip_opt_out: true }, ally: { provider: "anthropic", inference_geo: "global" } });
  });

  it("renders nothing until the backend asks; then the notice, and the confirm click is the answer", async () => {
    const { container } = render(<HostedNoticeGate />);
    expect(container).toBeEmptyDOMElement();
    const p = requestHostedConsent(["mic"]);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Before you start listening")).toBeInTheDocument();
    expect(screen.getByText(/Deepgram \(United States\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));
    expect((await p).scope).toEqual(["mic"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancel (and Escape) decline", async () => {
    render(<HostedNoticeGate />);
    const p = requestHostedConsent(["display"], true);
    expect(await screen.findByText("Before you share call audio")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(p).rejects.toMatchObject({ code: "consent_required" });
    const q = requestHostedConsent(["mic"]);
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await expect(q).rejects.toMatchObject({ code: "consent_required" });
  });
});
