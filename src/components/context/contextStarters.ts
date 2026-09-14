import type { ContextCategory } from "@/lib/ipc";

/**
 * Pre-installed, lightweight starter skeletons for the Context setup
 * wizard's Step 1 fields (Name/Goal/Key terms) — one per {@link
 * ContextCategory}, shipped with the app so a brand-new install has a
 * concrete example for every conversation type, not just Interview.
 *
 * Deliberately PLACEHOLDER text, never a pre-filled value: switching
 * category in the wizard changes the greyed-out example instantly and can
 * never clobber anything the user already typed, and there is nothing to
 * persist — the skeleton exists purely to show what a good answer looks
 * like for this Context type. Picking a category already seeds real
 * config (research default, file slots, participation lens, source
 * policy — see `categoryTemplates.ts` and its "Start with a template"
 * picker); this file only supplies the copy examples next to it, so it
 * does NOT mirror `ContextCategory::template()` the way `categoryTemplates.ts`
 * does — there is no Rust-side equivalent to keep in lockstep with.
 */
export interface ContextStarter {
  namePlaceholder: string;
  purposePlaceholder: string;
  keyTermsPlaceholder: string;
}

const EMPTY_KEY_TERMS_PLACEHOLDER = "term one\nterm two";

export const CONTEXT_STARTERS: Record<ContextCategory, ContextStarter> = {
  interview: {
    namePlaceholder: "Senior Accountant interview with the CFO",
    purposePlaceholder: "Prep for technical GAAP questions and leadership scenarios",
    keyTermsPlaceholder: "pensive theory\ndeferred revenue\nSOC 2",
  },
  company_meeting: {
    namePlaceholder: "Q3 board review with Finance and Ops",
    purposePlaceholder: "Track the numbers being cited, and catch decisions and follow-ups",
    keyTermsPlaceholder: "runway\nheadcount plan\nburn rate",
  },
  sales_call: {
    namePlaceholder: "Discovery call with Acme Corp",
    purposePlaceholder: "Understand their pain points, handle objections, move to a next step",
    keyTermsPlaceholder: "budget\ndecision maker\ncompetitor",
  },
  live_stream: {
    namePlaceholder: "Weekly dev update stream",
    purposePlaceholder: "Keep the segments on track and catch chat questions worth answering live",
    keyTermsPlaceholder: "sponsor mention\nrelease date\ngiveaway rules",
  },
  other: {
    namePlaceholder: "High-stakes conversation",
    purposePlaceholder: "Describe what you want conva to help you prepare for",
    keyTermsPlaceholder: EMPTY_KEY_TERMS_PLACEHOLDER,
  },
};

export const contextStarter = (c: ContextCategory): ContextStarter => CONTEXT_STARTERS[c];
