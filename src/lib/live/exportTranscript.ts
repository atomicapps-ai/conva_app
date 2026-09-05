/**
 * Browser-side transcript export (M2 checkpoint 6) — the web counterpart of
 * the desktop's `export_transcript` / `write_text_file` commands. Desktop
 * writes to a caller-chosen path; a browser tab has no file system, so the
 * same Markdown is handed to the browser as a download. The rendering is a
 * hand-mirror of `render_transcript_markdown` in `src-tauri/src/lib.rs`
 * (finals only, `**Them**`/`**You**`, `HH:MM:SS` from `start_ms`) so an export
 * from either surface reads the same. Pure apart from {@link downloadTextFile}.
 */
import type { TranscriptSegment } from "@/lib/ipc";

/** Mirror of `render_transcript_markdown` (src-tauri/src/lib.rs). */
export function renderTranscriptMarkdown(segments: readonly TranscriptSegment[]): string {
  let out = "";
  for (const s of segments) {
    if (!s.is_final) continue;
    const speaker = s.side === "inbound" ? "Them" : "You";
    const total = Math.floor(Math.max(0, s.start_ms) / 1000);
    const hh = String(Math.floor(total / 3600)).padStart(2, "0");
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    out += `**${speaker}** (${hh}:${mm}:${ss}): ${s.text.trim()}\n\n`;
  }
  return out;
}

/** The full export document, header included (mirror of `export_transcript`). */
export function transcriptMarkdown(segments: readonly TranscriptSegment[]): string {
  return `# conva transcript\n\n${renderTranscriptMarkdown(segments)}`;
}

/** A path from the desktop-style API → a safe download file name. */
export function downloadName(path: string, fallback = "conva-transcript.md"): string {
  const base = path.split(/[\\/]/).pop()?.trim() ?? "";
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || fallback;
}

export interface DownloadDeps {
  /** `document` (injected for tests). */
  document: Pick<Document, "createElement" | "body">;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

/** Hand text to the browser as a file download. Content never leaves the tab. */
export function downloadTextFile(name: string, content: string, deps?: DownloadDeps, mime = "text/markdown;charset=utf-8"): void {
  const d: DownloadDeps = deps ?? { document, createObjectURL: (b) => URL.createObjectURL(b), revokeObjectURL: (u) => URL.revokeObjectURL(u) };
  const blob = new Blob([content], { type: mime });
  const url = d.createObjectURL(blob);
  const a = d.document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  d.document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => d.revokeObjectURL(url), 1000);
  }
}
