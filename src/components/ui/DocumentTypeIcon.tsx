/**
 * Colored file-type badge for document list rows (Library, Context document
 * pickers). Deliberately separate from `Icon.tsx`'s glyph set: that system's
 * whole contract is one monochrome stroke language tinted by the caller via
 * `currentColor` (see its own doc comment) — several unrelated call sites
 * (the "Generate resources" sparkle spin, the source-count "file" badge, the
 * "Paste" clipboard button) depend on that staying true. This component owns
 * its own fixed color per type instead, because that's the actual fix for
 * "these all look the same" (owner, 2026-09-09): a flat `text-fg-faint` tint
 * was flattening every document row — pasted notes, PDFs, spreadsheets,
 * Ally's own generated briefs — into one indistinguishable grey glyph,
 * discarding the one signal (type/provenance) a document list row most needs
 * to convey at a glance. Same shape language as before (the folded-page
 * silhouette, the existing per-type inner marks) — now filled with a fixed
 * color instead of stroked in `currentColor`, so it also carries information
 * when nothing tints it.
 */
import type { ReactNode } from "react";

import { documentIcon, documentTypeColor } from "@/components/contexts/documentVisual";
import type { RagDocument } from "@/lib/ipc";

const BODY = "M6.5 3.5h7l4 4v13a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z";
const FOLD = "M13.5 3.5L17.5 7.5H13.5Z";

/** The inner mark for each glyph, in white, over the colored folded-page
 *  body — the exact same line data `Icon.tsx` strokes in `currentColor` for
 *  its monochrome fileXxx glyphs, just recolored. `sparkle`/`clipboard`
 *  (provenance) get their own small marks so a generated brief or a pasted
 *  note still reads as "a document", not a completely different pictogram. */
const MARKS: Record<string, ReactNode> = {
  filePdf: <path d="M8 13h8M8 16h5" />,
  fileWord: <path d="M8 12l1.4 5 2.6-4 2.6 4L16 12" />,
  fileSheet: <path d="M8 12h8M8 15h8M11 10v8" />,
  fileHtml: <path d="M10 12l-2 2 2 2M14 12l2 2-2 2" />,
  fileText: <path d="M8 12h8M8 15h8M8 18h5" />,
  fileImage: (
    <>
      <path d="M8 18l2.8-3 2 2 1.5-1.6L16 18" />
      <circle cx="10" cy="11.5" r="1" fill="white" stroke="none" />
    </>
  ),
  sparkle: <path d="M12 8.2l1.1 3 3 1.1-3 1.1-1.1 3-1.1-3-3-1.1 3-1.1z" fill="white" stroke="none" />,
  clipboard: <path d="M9 11h6M9 14.5h4M9.5 8h5" />,
  file: null,
};

export function DocumentTypeIcon({
  doc,
  size = 20,
}: {
  doc: RagDocument;
  size?: number;
}) {
  const name = documentIcon(doc);
  const color = documentTypeColor(doc);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={BODY} fill={color} />
      <path d={FOLD} fill="white" fillOpacity={0.3} />
      <g fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {MARKS[name]}
      </g>
    </svg>
  );
}
