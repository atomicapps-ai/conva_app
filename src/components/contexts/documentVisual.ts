import type { IconName } from "@/components/ui/Icon";
import type { RagDocument } from "@/lib/ipc";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
]);

export function documentExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

export function isImageDocument(doc: RagDocument): boolean {
  return IMAGE_EXTENSIONS.has(documentExtension(doc.file_name));
}

/** Type-aware library glyph, while preserving provenance for pasted/generated content. */
export function documentIcon(doc: RagDocument): IconName {
  if (doc.source === "generated") return "sparkle";
  if (doc.source === "pasted") return "clipboard";
  const ext = documentExtension(doc.file_name);
  if (IMAGE_EXTENSIONS.has(ext)) return "fileImage";
  if (ext === "pdf") return "filePdf";
  if (ext === "doc" || ext === "docx") return "fileWord";
  if (ext === "html" || ext === "htm") return "fileHtml";
  if (["xls", "xlsx", "csv"].includes(ext)) return "fileSheet";
  if (["txt", "md", "markdown"].includes(ext)) return "fileText";
  return "file";
}

/**
 * Fixed badge color per document type — used only by `DocumentTypeIcon`
 * (never by the shared `Icon` component, which stays strictly `currentColor`
 * per its own doc comment). Owner feedback, 2026-09-09: the plain
 * `currentColor`-tinted glyphs "essentially look all the same" in a dense
 * document list — distinct hues per type is the actual fix, same convention
 * as OS/Office file icons (a colored PDF, a colored Word doc, …) so it reads
 * at a glance without inspecting the extension text. Mirrors `documentIcon`'s
 * branches exactly — same precedence, same groupings.
 */
export function documentTypeColor(doc: RagDocument): string {
  if (doc.source === "generated") return "#ffc24b"; // conva's own Ally gold (--color-ai)
  if (doc.source === "pasted") return "#6b7a99";
  const ext = documentExtension(doc.file_name);
  if (IMAGE_EXTENSIONS.has(ext)) return "#b15cde";
  if (ext === "pdf") return "#e5484d";
  if (ext === "doc" || ext === "docx") return "#3d6fd1";
  if (ext === "html" || ext === "htm") return "#e8763a";
  if (["xls", "xlsx", "csv"].includes(ext)) return "#2fa36b";
  if (["txt", "md", "markdown"].includes(ext)) return "#7c8aa8";
  return "#8792ad";
}
