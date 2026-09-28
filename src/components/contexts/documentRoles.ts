import type { RagDocument } from "@/lib/ipc";

/**
 * Singleton document roles (owner request 2026-09-22 — "limit one Q&A
 * document, one resume, one job description"). Pure filename heuristic,
 * enforced only at the Library dock's attach-to-context action
 * (`LibraryPane.tsx`) — a lighter alternative to promoting these into real
 * `FileSlot`s on `ConversationContext` (job description is currently free
 * text, Q&A a generated artifact, so neither has a slot to reuse). Never
 * silently swaps a document — the caller blocks the second attach and names
 * the one already holding the role, so nothing disappears without the
 * owner choosing it.
 */
export type DocumentRole = "resume" | "job_description" | "qa" | "cover_letter";

interface RoleRule {
  role: DocumentRole;
  /** Shown in the "only one of these per context" message. */
  label: string;
  patterns: RegExp[];
}

// Matched against a NORMALIZED filename (`normalize` below turns `_`/`-`
// into spaces first) — `\b` alone misclassifies "Julius_Resume_2026.pdf",
// since `_` counts as a word character and blocks the boundary before
// "Resume". Patterns stay plain `\b...\b` English because of that
// normalization; order matters only for a filename that happens to match
// more than one role's pattern (rare) — first match wins.
const ROLE_RULES: RoleRule[] = [
  {
    role: "job_description",
    label: "job description",
    patterns: [/\bjob\s?description\b/, /\bjob\s?posting\b/, /\bjd\b/],
  },
  {
    role: "resume",
    label: "résumé/CV",
    patterns: [/\bresume\b/, /\br[eé]sum[eé]\b/, /\bcv\b/, /\bcurriculum\s?vitae\b/],
  },
  {
    role: "qa",
    label: "prepared Q&A",
    patterns: [/\bq\s?(?:and|&)\s?a\b/, /\bquestions?\s?(?:and|&)?\s?answers?\b/],
  },
  {
    role: "cover_letter",
    label: "cover letter",
    patterns: [/\bcover\s?letter\b/],
  },
];

export interface DocumentRoleMatch {
  role: DocumentRole;
  label: string;
}

/** Lowercase with `_`/`-` folded to spaces, so a boundary before/after a
 *  word survives underscore- or hyphen-separated filenames. */
function normalize(fileName: string): string {
  return fileName.toLowerCase().replace(/[_-]/g, " ");
}

/** Classifies a document by filename only — content sniffing is future work. */
export function classifyDocumentRole(fileName: string): DocumentRoleMatch | null {
  const normalized = normalize(fileName);
  for (const rule of ROLE_RULES) {
    if (rule.patterns.some((p) => p.test(normalized))) {
      return { role: rule.role, label: rule.label };
    }
  }
  return null;
}

/**
 * The document already holding `role` among `attachedDocs` (documents
 * already attached to the context being checked), if any — excluding
 * `excludeDocId` (the document about to be attached, so it never conflicts
 * with itself on a re-check).
 */
export function findRoleConflict(
  role: DocumentRole,
  attachedDocs: RagDocument[],
  excludeDocId: string,
): RagDocument | null {
  return (
    attachedDocs.find(
      (d) => d.id !== excludeDocId && classifyDocumentRole(d.file_name)?.role === role,
    ) ?? null
  );
}
