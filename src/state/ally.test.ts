import { beforeEach, describe, expect, it } from "vitest";

import type { AllySource } from "@/lib/ipc";
import {
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
