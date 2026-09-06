import { describe, expect, it, vi } from "vitest";

import type { TranscriptSegment } from "@/lib/ipc";
import { downloadName, downloadTextFile, renderTranscriptMarkdown, transcriptMarkdown } from "@/lib/live/exportTranscript";

const seg = (side: "inbound" | "outbound", text: string, start_ms: number, is_final = true): TranscriptSegment => ({
  side,
  seq: 0,
  text,
  is_final,
  start_ms,
  end_ms: start_ms + 900,
  confidence: null,
  latency_ms: 0,
});

describe("browser transcript export — mirror of the desktop Markdown", () => {
  it("renders finals only as **Them**/**You** with HH:MM:SS from start_ms, under the desktop header", () => {
    const md = transcriptMarkdown([
      seg("inbound", "  How much is the premium?  ", 1_000),
      seg("outbound", "Let me check", 65_000),
      seg("inbound", "still talki", 70_000, false),
      seg("outbound", "It's $120", 3_725_000),
    ]);
    expect(md).toBe(
      "# conva transcript\n\n" +
        "**Them** (00:00:01): How much is the premium?\n\n" +
        "**You** (00:01:05): Let me check\n\n" +
        "**You** (01:02:05): It's $120\n\n",
    );
    expect(renderTranscriptMarkdown([])).toBe("");
  });

  it("downloadName keeps only a safe basename and falls back when empty", () => {
    expect(downloadName("C:\\Users\\jk\\Documents\\call notes.md")).toBe("call-notes.md");
    expect(downloadName("/tmp/x/../conva-transcript.md")).toBe("conva-transcript.md");
    expect(downloadName("   ")).toBe("conva-transcript.md");
    expect(downloadName("///", "conva-export.md")).toBe("conva-export.md");
  });

  it("downloadTextFile hands a Blob URL to a hidden anchor, clicks it, removes it, and revokes the URL", () => {
    vi.useFakeTimers();
    const clicked: Array<{ href: string; download: string }> = [];
    const revoked: string[] = [];
    const created: HTMLAnchorElement[] = [];
    const fakeDoc = {
      body: { appendChild: vi.fn() },
      createElement: () => {
        const a = { href: "", download: "", rel: "", style: { display: "" }, click() { clicked.push({ href: this.href, download: this.download }); }, remove: vi.fn() } as unknown as HTMLAnchorElement;
        created.push(a);
        return a;
      },
    } as unknown as Pick<Document, "createElement" | "body">;
    downloadTextFile("conva-transcript.md", "# conva transcript\n", { document: fakeDoc, createObjectURL: () => "blob:fake-1", revokeObjectURL: (u) => revoked.push(u) });
    expect(clicked).toEqual([{ href: "blob:fake-1", download: "conva-transcript.md" }]);
    expect((created[0] as unknown as { remove: ReturnType<typeof vi.fn> }).remove).toHaveBeenCalled();
    expect(revoked).toEqual([]);
    vi.runAllTimers();
    expect(revoked).toEqual(["blob:fake-1"]);
    vi.useRealTimers();
  });
});
