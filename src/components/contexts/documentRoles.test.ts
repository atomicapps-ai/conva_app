import { describe, expect, it } from "vitest";

import { classifyDocumentRole, findRoleConflict } from "@/components/contexts/documentRoles";
import type { RagDocument } from "@/lib/ipc";

function doc(overrides: Partial<RagDocument> = {}): RagDocument {
  return {
    id: "d1",
    file_name: "file.pdf",
    enabled: true,
    chunk_count: 1,
    ingested_at_unix_ms: 0,
    source: "file",
    context_ids: [],
    size_bytes: 100,
    ...overrides,
  };
}

describe("classifyDocumentRole", () => {
  it.each([
    ["Julius_Resume_2026.pdf", "resume"],
    ["resume.docx", "resume"],
    ["CV - Julius Kelly.pdf", "resume"],
    ["curriculum-vitae.pdf", "resume"],
    ["PGE_Job_Description.pdf", "job_description"],
    ["job-posting.txt", "job_description"],
    ["JD.pdf", "job_description"],
    ["Prepared Q&A.md", "qa"],
    ["interview_questions_and_answers.docx", "qa"],
    ["Cover Letter.pdf", "cover_letter"],
    ["cover-letter-draft.docx", "cover_letter"],
  ])("classifies %s as %s", (fileName, expected) => {
    expect(classifyDocumentRole(fileName)?.role).toBe(expected);
  });

  it("returns null for a filename with no recognizable role", () => {
    expect(classifyDocumentRole("meeting-notes.txt")).toBeNull();
    expect(classifyDocumentRole("random-attachment.pdf")).toBeNull();
  });

  it("is case-insensitive and tolerates separators", () => {
    expect(classifyDocumentRole("JOB_DESCRIPTION.PDF")?.role).toBe("job_description");
    expect(classifyDocumentRole("job description.pdf")?.role).toBe("job_description");
  });
});

describe("findRoleConflict", () => {
  it("finds the existing document already holding a role", () => {
    const existing = doc({ id: "existing", file_name: "resume.pdf" });
    const conflict = findRoleConflict("resume", [existing], "new-doc");
    expect(conflict?.id).toBe("existing");
  });

  it("never conflicts with itself", () => {
    const self = doc({ id: "d1", file_name: "resume.pdf" });
    expect(findRoleConflict("resume", [self], "d1")).toBeNull();
  });

  it("returns null when no attached document holds that role", () => {
    const other = doc({ id: "d2", file_name: "meeting-notes.txt" });
    expect(findRoleConflict("resume", [other], "d1")).toBeNull();
  });
});
