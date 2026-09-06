import { describe, expect, it } from "vitest";

import { HOSTED_NOTICE_ID, hostedNotice } from "./hostedNotice";
import type { LiveTerms } from "./protocol";

const TERMS: LiveTerms = { asr: { provider: "deepgram", region: "us", mip_opt_out: true }, ally: { provider: "anthropic", inference_geo: "global" } };

describe("hostedNotice — the hosted-processing notice text (cp16)", () => {
  it("states sources, processing, storage and the participant duty from the gateway's reported terms", () => {
    const c = hostedNotice(TERMS, ["mic"]);
    expect(HOSTED_NOTICE_ID).toBe("hosted-v1");
    expect(c.title).toBe("Before you start listening");
    expect(c.confirm).toBe("Start listening");
    expect(c.paragraphs).toHaveLength(4);
    expect(c.paragraphs[0]).toMatch(/microphone will be transcribed live/);
    expect(c.paragraphs[1]).toContain("Deepgram (United States)");
    expect(c.paragraphs[1]).toContain("Conva tells Deepgram not to use your audio for training");
    expect(c.paragraphs[1]).toContain("Anthropic (inference may run outside the United States)");
    expect(c.paragraphs[1]).toContain("deletes it within 30 days");
    expect(c.paragraphs[2]).toMatch(/stores nothing from this call unless you save/);
    expect(c.paragraphs[3]).toMatch(/recording rules/);
  });
  it("follows the configuration: EU host, opt-out off, US-pinned inference", () => {
    const c = hostedNotice({ asr: { provider: "deepgram", region: "eu", mip_opt_out: false }, ally: { provider: "anthropic", inference_geo: "us" } }, ["mic"]);
    expect(c.paragraphs[1]).toContain("Deepgram (European Union)");
    expect(c.paragraphs[1]).toContain("Deepgram may use your audio to improve its models");
    expect(c.paragraphs[1]).toContain("Anthropic (United States)");
  });
  it("claims nothing provider-specific when the gateway reported no terms or an unknown provider", () => {
    const none = hostedNotice(undefined, ["mic"]);
    expect(none.paragraphs[1]).toContain("Conva's hosted transcription provider");
    expect(none.paragraphs[1]).toContain("Conva's hosted model provider");
    expect(none.paragraphs[1]).not.toMatch(/30 days|training/);
    const other = hostedNotice({ asr: { provider: "acme", region: "us", mip_opt_out: true }, ally: { provider: "acme", inference_geo: "global" } }, ["mic"]);
    expect(other.paragraphs[1]).toContain("Conva's hosted provider (United States)");
    expect(other.paragraphs[1]).not.toContain("30 days");
  });
  it("expansion to shared call audio is its own notice", () => {
    const c = hostedNotice(TERMS, ["display"], true);
    expect(c.title).toBe("Before you share call audio");
    expect(c.confirm).toBe("Share call audio");
    expect(c.paragraphs[0]).toMatch(/add the call audio you share/);
    expect(c.paragraphs[0]).toMatch(/video never is/);
  });
});
