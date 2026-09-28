import { beforeEach, describe, expect, it } from "vitest";

import type { AllySource } from "@/lib/ipc";
import {
  friendlyAllyError,
  groupSourcesByFile,
  retainPresentationCards,
  uniqueSourceFiles,
  useAllyStore,
  type AllyCard,
} from "@/state/ally";

function src(file: string, location: string): AllySource {
  return { file_name: file, location } as unknown as AllySource;
}

const SOURCES = [
  src("resume.docx", "¶57–68"),
  src("resume.docx", "¶17–36"),
  src("prep.txt", "¶3"),
  src("resume.docx", "¶37–47"),
  src("prep.txt", "¶3"),
];

describe("clean source citations (owner, 2026-08-22)", () => {
  it("uniqueSourceFiles keeps file names only, first-appearance order", () => {
    expect(uniqueSourceFiles(SOURCES)).toEqual(["resume.docx", "prep.txt"]);
  });

  it("groupSourcesByFile groups deduped locations per file", () => {
    expect(groupSourcesByFile(SOURCES)).toEqual([
      { file: "resume.docx", locations: ["¶57–68", "¶17–36", "¶37–47"] },
      { file: "prep.txt", locations: ["¶3"] },
    ]);
  });
});

describe("presentation-specific card retention", () => {
  it("keeps 12 answers even when many term definitions are opened", () => {
    const answers = Array.from({ length: 13 }, (_, index) => ({
      id: `answer-${index}`,
      presentation: "answer" as const,
    })) as AllyCard[];
    const terms = Array.from({ length: 6 }, (_, index) => ({
      id: `term-${index}`,
      presentation: "term" as const,
    })) as AllyCard[];
    const retained = retainPresentationCards([...terms, ...answers]);
    expect(retained.filter((card) => card.presentation === "answer")).toHaveLength(12);
    expect(retained.filter((card) => card.presentation === "term")).toHaveLength(4);
  });
});

describe("card Summary streaming (sum:-prefixed chunks)", () => {
  beforeEach(() => {
    useAllyStore.setState({
      busy: true,
      cards: [
        { id: "a1", text: "long answer", summary: "", sources: [] } as unknown as AllyCard,
        { id: "a2", text: "other", summary: null, sources: [] } as unknown as AllyCard,
      ],
    });
  });

  it("routes sum:<id> tokens into that card's summary, not its text", () => {
    const apply = useAllyStore.getState().applyChunk;
    apply({ request_id: "sum:a1", token: "• point one", done: false, error: null });
    apply({ request_id: "sum:a1", token: "\n• point two", done: true, error: null });
    const [a1, a2] = useAllyStore.getState().cards;
    expect(a1!.summary).toBe("• point one\n• point two");
    expect(a1!.text).toBe("long answer");
    expect(a2!.summary).toBeNull();
    expect(useAllyStore.getState().busy).toBe(false);
  });

  it("a summary-stream error lands as a visible summary message", () => {
    useAllyStore.getState().applyChunk({
      request_id: "sum:a1",
      token: "",
      done: true,
      error: "provider down",
    });
    expect(useAllyStore.getState().cards[0]!.summary).toBe(
      "Summary failed: provider down",
    );
  });
});

describe("friendlyAllyError", () => {
  it("turns a raw Anthropic usage-limit body into an actionable message", () => {
    const raw =
      'LLM provider error: HTTP 400: {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC.","request_id":"req_011CfLesW4sjgwmFwGX4Dxwv"}}';
    expect(friendlyAllyError(raw)).toBe(
      "LLM usage limit reached — access resumes 2026-10-01 at 00:00 UTC. Switch providers in Settings → LLM, or wait for the reset.",
    );
  });

  it("recognizes a usage-limit message with no reset date", () => {
    const raw = "You have reached your specified API usage limits.";
    expect(friendlyAllyError(raw)).toBe(
      "LLM usage limit reached. Switch providers in Settings → LLM, or wait for the limit to reset.",
    );
  });

  it("recognizes rate-limit and overload errors from either provider shape", () => {
    expect(friendlyAllyError('HTTP 429: {"type":"rate_limit_error"}')).toBe(
      "The LLM provider is rate-limiting requests right now. Wait a moment and try again, or switch providers in Settings → LLM.",
    );
    expect(friendlyAllyError('HTTP 529: {"type":"overloaded_error"}')).toBe(
      "The LLM provider is temporarily overloaded. Wait a moment and try again.",
    );
  });

  it("turns the raw api_key_missing string into an actionable message (owner, #340 follow-up)", () => {
    // CoachingSetupView's "Generate resources"/"Regenerate" button threw this
    // literal string (src-tauri/src/llm.rs's resolve_key) straight to the UI
    // before this case existed — the same bug #340 fixed for "Generate
    // personas" but missed here.
    expect(friendlyAllyError("api_key_missing")).toBe(
      "No API key is set for your LLM provider. Add one in Settings → LLM, then try again.",
    );
  });

  it("passes unrecognized errors through unchanged", () => {
    expect(friendlyAllyError("stream read: connection reset")).toBe(
      "stream read: connection reset",
    );
  });

  it("applyChunk stores the friendly message on the card, not the raw body", () => {
    useAllyStore.setState({
      busy: true,
      cards: [{ id: "q1", text: "", done: false, error: null } as unknown as AllyCard],
    });
    useAllyStore.getState().applyChunk({
      request_id: "q1",
      token: "",
      done: true,
      error:
        'LLM provider error: HTTP 400: {"message":"You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC."}',
    });
    expect(useAllyStore.getState().cards[0]!.error).toBe(
      "LLM usage limit reached — access resumes 2026-10-01 at 00:00 UTC. Switch providers in Settings → LLM, or wait for the reset.",
    );
  });
});
