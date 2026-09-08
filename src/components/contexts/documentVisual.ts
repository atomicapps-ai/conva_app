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
