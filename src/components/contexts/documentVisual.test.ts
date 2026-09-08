import { describe, expect, it } from "vitest";

import { documentIcon, isImageDocument } from "@/components/contexts/documentVisual";
import type { RagDocument } from "@/lib/ipc";

const doc = (file_name: string, source: RagDocument["source"] = "file") =>
  ({ id: file_name, file_name, source, enabled: true, chunk_count: 1, ingested_at_unix_ms: 0, context_ids: [], size_bytes: 0 }) as RagDocument;

describe("documentVisual", () => {
  it("uses distinct file-type icons, including visual assets", () => {
    expect(documentIcon(doc("report.pdf"))).toBe("filePdf");
    expect(documentIcon(doc("brief.docx"))).toBe("fileWord");
    expect(documentIcon(doc("evidence.png"))).toBe("fileImage");
    expect(isImageDocument(doc("photo.WEBP"))).toBe(true);
  });

  it("keeps provenance stronger than the extension", () => {
    expect(documentIcon(doc("answer.txt", "generated"))).toBe("sparkle");
    expect(documentIcon(doc("note.txt", "pasted"))).toBe("clipboard");
  });
});
