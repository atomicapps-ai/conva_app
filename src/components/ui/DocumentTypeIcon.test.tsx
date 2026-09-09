import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocumentTypeIcon } from "@/components/ui/DocumentTypeIcon";
import type { RagDocument } from "@/lib/ipc";

const doc = (file_name: string, source: RagDocument["source"] = "file") =>
  ({ id: file_name, file_name, source, enabled: true, chunk_count: 1, ingested_at_unix_ms: 0, context_ids: [], size_bytes: 0 }) as RagDocument;

describe("DocumentTypeIcon", () => {
  it("fills the folded-page body with a distinct color per type, never currentColor", () => {
    const { container: pdf } = render(<DocumentTypeIcon doc={doc("report.pdf")} />);
    const { container: sheet } = render(<DocumentTypeIcon doc={doc("budget.xlsx")} />);
    const pdfFill = pdf.querySelector("svg > path")?.getAttribute("fill");
    const sheetFill = sheet.querySelector("svg > path")?.getAttribute("fill");
    expect(pdfFill).toMatch(/^#[0-9a-f]{6}$/);
    expect(sheetFill).toMatch(/^#[0-9a-f]{6}$/);
    expect(pdfFill).not.toBe(sheetFill);
    expect(pdfFill).not.toBe("currentColor");
  });

  it("colors a generated document gold, distinct from a plain document of the same extension", () => {
    const { container: generated } = render(<DocumentTypeIcon doc={doc("answer.txt", "generated")} />);
    const { container: plain } = render(<DocumentTypeIcon doc={doc("notes.txt")} />);
    const generatedFill = generated.querySelector("svg > path")?.getAttribute("fill");
    const plainFill = plain.querySelector("svg > path")?.getAttribute("fill");
    expect(generatedFill).toBe("#ffc24b");
    expect(generatedFill).not.toBe(plainFill);
  });

  it("respects the size prop and always renders an svg", () => {
    const { container } = render(<DocumentTypeIcon doc={doc("photo.png")} size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
  });
});
