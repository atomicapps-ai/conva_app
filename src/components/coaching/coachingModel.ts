import type {
  ContextCategory,
  ContextSummary,
  ConversationContext,
  SessionSummary,
} from "@/lib/ipc";
import { DEFAULT_CONTEXT_ID } from "@/lib/ipc";

/**
 * The Coaching object model — AppUI V5.0 §5, owner decision 4 (Coaching is a
 * first-class destination) and the rename of Rehearsals → Coaching everywhere.
 *
 * > **Practice template** — generic starter (Product Interview, Podcast,
 * > Debate…).
 * > **Coaching setup** — reusable, user-owned config connected to a Context
 * > (docs, goals, persona, mode, prepared Q&A).
 * > **Coaching session** — one started/paused/completed run from a setup;
 * > lives in history.
 *
 * Mapped onto what the app already stores, with **no new backend concepts and
 * no invented data**:
 *
 * - a **coaching setup** IS a `ConversationContext` — that is already
 *   "documents + persona + prepared Q&A, reusable, user-owned". A setup is
 *   *prepared* once it has generated resources AND a chosen counterparty
 *   persona; anything short of that is a *draft*, and the draft row says
 *   exactly which piece is missing rather than a vague "incomplete".
 * - a **coaching session** IS a `SessionSummary` with `is_rehearsal` — the
 *   run log the shell already writes for every rehearsal.
 * - a **practice template** is static product content (below), not user data.
 *
 * Everything here is pure so the grouping and the "what's missing" wording are
 * unit-tested rather than eyeballed. §5 is explicit that **no analytics or
 * scores exist yet** (decision 7) — there is deliberately nothing in this file
 * that computes a score, a streak, or a trend.
 */

/** A generic starter. `category` is the real `ContextCategory` it creates. */
export interface PracticeTemplate {
  id: string;
  name: string;
  category: ContextCategory;
  /** Seeds the new context's purpose field so the setup starts non-empty. */
  purpose: string;
}

/**
 * The starter set. Deliberately mapped onto the four categories the backend
 * actually has — a template that promised a "mode" the pipeline can't honour
 * would be a fabricated feature.
 */
export const PRACTICE_TEMPLATES: PracticeTemplate[] = [
  {
    id: "product-interview",
    name: "Product Interview",
    category: "interview",
    purpose: "Practise a product-role interview and sharpen the answers.",
  },
  {
    id: "technical-hiring",
    name: "Technical Hiring",
    category: "interview",
    purpose: "Practise a technical interview, from fundamentals to system design.",
  },
  {
    id: "sales-discovery",
    name: "Sales Discovery",
    category: "sales_call",
    purpose: "Practise a discovery call: qualify, uncover pain, agree next steps.",
  },
  {
    id: "board-exec-prep",
    name: "Board / Executive Prep",
    category: "company_meeting",
    purpose: "Rehearse a board or executive update and the questions it invites.",
  },
  {
    id: "presentation",
    name: "Presentation / Pitch",
    category: "company_meeting",
    purpose: "Rehearse a pitch and the pushback that follows it.",
  },
  {
    id: "difficult-conversation",
    name: "Difficult Conversation",
    category: "other",
    purpose: "Practise a hard conversation and stay on the outcome you want.",
  },
];

/** Human label for the mode a setup runs in — derived from the context's REAL
 *  category, never a mode we don't store. */
export const CATEGORY_LABEL: Record<ContextCategory, string> = {
  interview: "Interview candidate",
  company_meeting: "Meeting / executive prep",
  sales_call: "Sales discovery",
  other: "General / custom",
};

export type SetupState = "prepared" | "draft";

export interface CoachingSetup {
  id: string;
  title: string;
  category: ContextCategory;
  modeLabel: string;
  state: SetupState;
  sourceDocCount: number;
  /** Chosen counterparty persona title, when one has been picked. */
  personaTitle: string | null;
  /** For drafts: the single next thing to do, in the user's words. */
  missing: string | null;
  /** True when generated resources no longer match the inputs. */
  stale: boolean;
}

/** What a draft still needs — one clear next step, most blocking first. */
export function missingForSetup(
  summary: ContextSummary,
  full: ConversationContext | null,
): string | null {
  if (summary.source_doc_count === 0 && !summary.has_key_terms && !summary.research_enabled) {
    return "Add a document, key terms, or research to finish";
  }
  if (!summary.has_generated_resources) return "Generate its resources to finish";
  if (full && full.personas.length === 0) return "Generate a counterparty persona to finish";
  if (full && !full.chosen_persona_id) return "Choose a counterparty persona to finish";
  return null;
}

/**
 * Turn the contexts (plus whatever full records loaded) into coaching setups.
 * The always-present "General conversation" default is not a setup — it's the
 * ungrounded fallback, and listing it would imply a rehearsal is prepared.
 */
export function toSetups(
  summaries: ContextSummary[],
  fullById: Record<string, ConversationContext | undefined> = {},
): CoachingSetup[] {
  return summaries
    .filter((s) => s.id !== DEFAULT_CONTEXT_ID)
    .map((s) => {
      const full = fullById[s.id] ?? null;
      const missing = missingForSetup(s, full);
      const personaTitle =
        full?.personas.find((p) => p.id === full.chosen_persona_id)?.title ?? null;
      return {
        id: s.id,
        title: s.title,
        category: s.category,
        modeLabel: CATEGORY_LABEL[s.category],
        state: missing === null ? "prepared" : "draft",
        sourceDocCount: s.source_doc_count,
        personaTitle,
        missing,
        stale: s.resources_stale === true,
      } satisfies CoachingSetup;
    });
}

export function preparedSetups(setups: CoachingSetup[]): CoachingSetup[] {
  return setups.filter((s) => s.state === "prepared");
}

export function draftSetups(setups: CoachingSetup[]): CoachingSetup[] {
  return setups.filter((s) => s.state === "draft");
}

export interface CoachingSession {
  id: string;
  title: string;
  /** The setup (context) it ran from, when the shell recorded one. */
  setupTitle: string | null;
  startedAtUnixMs: number;
  segmentCount: number;
}

/**
 * Coaching sessions = rehearsal runs. A non-rehearsal session is an ordinary
 * live call and belongs to Conversations, not here.
 */
export function toCoachingSessions(sessions: SessionSummary[]): CoachingSession[] {
  return sessions
    .filter((s) => s.is_rehearsal)
    .map((s) => ({
      id: s.id,
      title: s.simcon_title ?? s.preview.trim() ?? "Coaching session",
      setupTitle: s.simcon_title,
      startedAtUnixMs: s.started_at_unix_ms,
      segmentCount: s.segment_count,
    }))
    .sort((a, b) => b.startedAtUnixMs - a.startedAtUnixMs);
}
