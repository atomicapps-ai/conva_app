import { beforeEach, describe, expect, it } from "vitest";

import { requestHostedConsent, useHostedConsentStore } from "./hostedConsent";

describe("hostedConsent store (cp16)", () => {
  beforeEach(() => useHostedConsentStore.getState().reset());

  it("a fresh request is pending until accepted; accept resolves a content-free grant with the notice id", async () => {
    const p = requestHostedConsent(["mic"]);
    const s = useHostedConsentStore.getState();
    expect(s.pending?.scope).toEqual(["mic"]);
    expect(s.pending?.expanding).toBe(false);
    s.accept();
    const grant = await p;
    expect(grant.notice).toBe("hosted-v1");
    expect(grant.scope).toEqual(["mic"]);
    expect(typeof grant.acknowledged_at).toBe("number");
    expect(Object.keys(grant).sort()).toEqual(["acknowledged_at", "notice", "scope"]);
    expect(useHostedConsentStore.getState().granted).toEqual(grant);
    expect(useHostedConsentStore.getState().pending).toBeNull();
  });

  it("decline rejects with consent_required and leaves no grant", async () => {
    const p = requestHostedConsent(["mic"]);
    useHostedConsentStore.getState().decline();
    await expect(p).rejects.toMatchObject({ code: "consent_required" });
    expect(useHostedConsentStore.getState().granted).toBeNull();
  });

  it("expansion accumulates scope on the session's grant and is asked only once", async () => {
    const start = requestHostedConsent(["mic"]);
    useHostedConsentStore.getState().accept();
    await start;
    const share = requestHostedConsent(["display"], true);
    expect(useHostedConsentStore.getState().pending?.expanding).toBe(true);
    useHostedConsentStore.getState().accept();
    expect((await share).scope).toEqual(["mic", "display"]);
    // "Share again" in the same session: already covered, no dialog.
    const again = await requestHostedConsent(["display"], true);
    expect(again.scope).toEqual(["mic", "display"]);
    expect(useHostedConsentStore.getState().pending).toBeNull();
    // A new session asks afresh even though a grant exists.
    const next = requestHostedConsent(["mic"]);
    expect(useHostedConsentStore.getState().pending?.scope).toEqual(["mic"]);
    useHostedConsentStore.getState().decline();
    await expect(next).rejects.toMatchObject({ code: "consent_required" });
  });

  it("a newer request supersedes a pending one; reset rejects a pending request and clears the grant", async () => {
    const first = requestHostedConsent(["mic"]);
    const second = requestHostedConsent(["mic"]);
    await expect(first).rejects.toMatchObject({ code: "consent_required" });
    useHostedConsentStore.getState().reset();
    await expect(second).rejects.toMatchObject({ code: "consent_required" });
    expect(useHostedConsentStore.getState().granted).toBeNull();
  });
});
