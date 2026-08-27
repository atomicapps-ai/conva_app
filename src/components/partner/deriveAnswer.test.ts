import { describe, expect, it } from "vitest";

import { derivePartnerAnswer } from "@/components/partner/deriveAnswer";
import type { PartnerPayload } from "@/lib/ipc";
import type { AllyCard } from "@/state/ally";

function payload(answer: string | null, sourceLines: string[] = []): PartnerPayload {
  return {
    term: "schema migration",
    kind: "concept",
    preview: "a preview",
    answer,
    source_lines: sourceLines,
    doc_id: null,
  };
}

function card(over: Partial<AllyCard> = {}): AllyCard {
  return {
    id: "a1",
    text: "the fetched answer",
    error: null,
    sources: [{ file_name: "resume.docx", location: "¶1" }] as never,
    ...over,
  } as AllyCard;
}

describe("derivePartnerAnswer (owner, 2026-08-22 — viewer IS the partner window)", () => {
  it("shows the already-answered payload content when no follow-up was asked", () => {
    const r = derivePartnerAnswer(payload("the original answer", ["resume.docx — ¶1"]), null);
    expect(r).toEqual({
      heading: "ANSWER",
      text: "the original answer",
      error: null,
      sources: ["resume.docx — ¶1"],
    });
  });

  it("a live follow-up card takes over — even over an already-answered payload", () => {
    const r = derivePartnerAnswer(
      payload("the original answer", ["resume.docx — ¶1"]),
      card({ text: "the follow-up answer" }),
    );
    expect(r.heading).toBe("FETCHED INFO");
    expect(r.text).toBe("the follow-up answer");
    expect(r.sources).toEqual(["resume.docx — ¶1"]);
  });

  it("a fresh term (no answer yet) shows nothing until a live card arrives", () => {
    expect(derivePartnerAnswer(payload(null), null)).toEqual({
      heading: "ANSWER",
      text: null,
      error: null,
      sources: [],
    });
  });

  it("a live card's error surfaces instead of its (empty) text", () => {
    const r = derivePartnerAnswer(payload("original"), card({ text: "", error: "provider down" }));
    expect(r.error).toBe("provider down");
    expect(r.text).toBeNull();
  });

  it("no payload at all yields the empty ANSWER state", () => {
    expect(derivePartnerAnswer(null, null)).toEqual({
      heading: "ANSWER",
      text: null,
      error: null,
      sources: [],
    });
  });
});
