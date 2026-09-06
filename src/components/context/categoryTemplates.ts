import type { ContextCategory } from "@/lib/ipc";

export interface ContextFileSlot {
  key: string;
  label: string;
  multiple: boolean;
}

export interface CategoryTemplate {
  value: ContextCategory;
  label: string;
  hint: string;
  research: boolean;
  fileSlots: ContextFileSlot[];
  digestSections: string[];
}

// Mirrors crates/conva-core/src/context.rs's ContextCategory::template()
// field-for-field. Change one, change the other in the same commit (same
// hand-mirror discipline as the Rust<->TS IPC contract generally).
export const CATEGORIES: CategoryTemplate[] = [
  {
    value: "interview",
    label: "Interview",
    hint: "Job or panel interview",
    research: true,
    fileSlots: [
      { key: "resume", label: "Résumé / CV", multiple: false },
      { key: "job_description", label: "Job description", multiple: false },
      { key: "interview_test", label: "Take-home / test", multiple: true },
    ],
    digestSections: [
      "Role profile",
      "Core vocabulary",
      "Likely questions & strong answers",
      "Facts & figures",
    ],
  },
  {
    value: "company_meeting",
    label: "Company meeting",
    hint: "Internal — financials, reviews, planning",
    research: false,
    fileSlots: [
      { key: "financials", label: "Financials / reports", multiple: true },
      { key: "decks", label: "Decks", multiple: true },
      { key: "minutes", label: "Prior minutes", multiple: true },
    ],
    digestSections: ["Key figures", "Core vocabulary", "Likely discussion points"],
  },
  {
    value: "sales_call",
    label: "Sales call",
    hint: "Demo, objection handling",
    research: true,
    fileSlots: [{ key: "account", label: "Prospect / account docs", multiple: true }],
    digestSections: ["Company background", "Core vocabulary", "Objections", "Talking points"],
  },
  {
    value: "live_stream",
    label: "Live stream",
    hint: "Podcast, stream, live-commerce broadcast",
    research: true,
    fileSlots: [
      { key: "rundown", label: "Show rundown / outline", multiple: false },
      { key: "guest_bio", label: "Guest bio", multiple: true },
      { key: "talking_points", label: "Talking points / script", multiple: true },
    ],
    digestSections: [
      "Episode outline",
      "Core vocabulary",
      "Guest background",
      "Likely audience questions",
    ],
  },
  {
    value: "other",
    label: "Other",
    hint: "Anything high-stakes",
    research: false,
    fileSlots: [{ key: "files", label: "Files", multiple: true }],
    digestSections: ["Core vocabulary", "Summary", "Likely questions"],
  },
];

export const categoryTemplate = (c: ContextCategory): CategoryTemplate =>
  CATEGORIES.find((x) => x.value === c) ?? CATEGORIES[0]!;

export const researchDefault = (c: ContextCategory): boolean => categoryTemplate(c).research;
