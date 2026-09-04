import { create } from "zustand";

import {
  SECTION_ORDER,
  type PanelSectionId,
} from "@/components/transcript/panelSections";

/**
 * Small, local UI preferences for the Ally column — persisted to localStorage
 * (not synced settings). Font size for the research text and whether the
 * collapsible reasoning block starts open.
 */
const FONT_KEY = "conva.ally.fontPx";
const TRANSCRIPT_FONT_KEY = "conva.transcript.fontPx";
const REASONING_KEY = "conva.ally.reasoningOpen";
const COLLAPSE_YOU_KEY = "conva.transcript.collapseYou";
const PARTNER_FONT_KEY = "conva.partner.fontPx";
const PANEL_SPLIT_KEY = "conva.panel.splitRatio";
const PANEL_WIDTH_KEY = "conva.panel.widthPx";
const ANSWERS_PINNED_KEY = "conva.panel.answersPinned";
const PANEL_OPEN_SECTION_KEY = "conva.panel.openSection";
const QUESTIONS_MODE_KEY = "conva.panel.questionsMode";
const AUTO_INSTALL_UPDATES_KEY = "conva.updates.autoInstall";
const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_MAX = 560;
const PANEL_WIDTH_DEFAULT = 340;
// Contexts screen's Contexts-pane width — the resizable centerline
// (Contexts-screen-redesign spec, requirement 7). Same width-px pattern as
// panelWidthPx above (Library flexes to fill the rest), not a 0-1 ratio —
// mirrors TranscriptView's AllyPanel resize handle exactly. Default targets
// roughly a 67/33 Contexts/Library split at the app's actual 700px default
// window width (owner, 2026-08-28 — Library only needs to show a
// name/checkbox/two icons per row now, so it can afford to be the
// narrower pane; still freely drag-resizable, this is just the start).
const CONTEXTS_LEFT_WIDTH_KEY = "conva.contexts.leftWidthPx";
// Smaller-screens-first pass (2026-09-02): Pane A is 220px, resizable
// 190–280. Was 300/260–380 under AppUI V5.0's original wide-first tuning; a
// stored value from that old range now falls outside MAX and self-heals back
// to the 220 default on read.
const CONTEXTS_LEFT_WIDTH_MIN = 190;
const CONTEXTS_LEFT_WIDTH_MAX = 280;
const CONTEXTS_LEFT_WIDTH_DEFAULT = 220;
const LIBRARY_DOCK_WIDTH_KEY = "conva.contexts.libraryDockWidthPx";
// Pane C — the contextual Library dock, resizable 230–320 (mirrors Pane A's
// pattern exactly; same width-px style, not a ratio).
const LIBRARY_DOCK_WIDTH_MIN = 230;
const LIBRARY_DOCK_WIDTH_MAX = 320;
const LIBRARY_DOCK_WIDTH_DEFAULT = 260;
const FONT_MIN = 11;
const FONT_MAX = 20;
const FONT_DEFAULT = 14;
const TRANSCRIPT_FONT_DEFAULT = 12;

function loadFont(key: string, fallback: number): number {
  const v = Number(localStorage.getItem(key));
  return v >= FONT_MIN && v <= FONT_MAX ? v : fallback;
}

interface UiPrefs {
  /** Install and relaunch automatically once an update is downloaded. A live
   *  listening session always postpones the restart until the session ends. */
  autoInstallUpdates: boolean;
  setAutoInstallUpdates: (enabled: boolean) => void;
  /** Ally research text size, in px. */
  allyFontPx: number;
  /** Transcript (conversation bubble) text size, in px. */
  transcriptFontPx: number;
  /** Whether the reasoning ("thinking") block starts expanded. */
  reasoningDefaultOpen: boolean;
  /** Keep the user's own ("you") turns collapsed by default. */
  collapseYou: boolean;
  /** Partner-window content text size, in px — its own setting (spec §4.2):
   *  the detached window often sits farther away than the in-app panel. */
  partnerFontPx: number;
  /** Found/View split ratio (Found's share of the panel height), 0.25–0.75. */
  panelSplitRatio: number;
  setPanelSplitRatio: (r: number) => void;
  /** Whether the Answers dock is pinned at the panel's bottom (spine
   *  accordion, spec 2026-08-26). Default on. */
  answersPinned: boolean;
  setAnswersPinned: (pinned: boolean) => void;
  /** The accordion's open section. While Answers is pinned this names one
   *  of the three content sections (load coerces a stored "answers"). */
  panelOpenSection: PanelSectionId;
  setPanelOpenSection: (id: PanelSectionId) => void;
  /** Questions section's sub-mode (split-source spec 2026-08-27): "live" =
   *  the radar feed, "prep" = the prepared Q&A bank. Persisted. */
  questionsMode: "live" | "prep";
  setQuestionsMode: (m: "live" | "prep") => void;
  /** Right Ally panel width, px — drives BOTH the panel and the control
   *  bar's tab zone so they stay aligned (spec A.2). */
  panelWidthPx: number;
  setPanelWidthPx: (px: number) => void;
  /** Contexts screen's Contexts-pane width, px — Library fills the rest. */
  contextsLeftWidthPx: number;
  setContextsLeftWidthPx: (px: number) => void;
  /** Contexts screen's Library dock width, px (Pane C). */
  libraryDockWidthPx: number;
  setLibraryDockWidthPx: (px: number) => void;
  setAllyFontPx: (px: number) => void;
  bumpAllyFont: (delta: number) => void;
  bumpTranscriptFont: (delta: number) => void;
  bumpPartnerFont: (delta: number) => void;
  setReasoningDefaultOpen: (open: boolean) => void;
  setCollapseYou: (on: boolean) => void;
}

export const useUiPrefs = create<UiPrefs>((set) => ({
  autoInstallUpdates: localStorage.getItem(AUTO_INSTALL_UPDATES_KEY) === "1",
  allyFontPx: loadFont(FONT_KEY, FONT_DEFAULT),
  transcriptFontPx: loadFont(TRANSCRIPT_FONT_KEY, TRANSCRIPT_FONT_DEFAULT),
  reasoningDefaultOpen: localStorage.getItem(REASONING_KEY) === "1",
  // Default on — the user rarely re-reads their own words.
  collapseYou: localStorage.getItem(COLLAPSE_YOU_KEY) !== "0",
  partnerFontPx: loadFont(PARTNER_FONT_KEY, FONT_DEFAULT),
  panelSplitRatio: (() => {
    const v = Number(localStorage.getItem(PANEL_SPLIT_KEY));
    return v >= 0.25 && v <= 0.75 ? v : 0.45;
  })(),
  panelWidthPx: (() => {
    const v = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return v >= PANEL_WIDTH_MIN && v <= PANEL_WIDTH_MAX
      ? v
      : PANEL_WIDTH_DEFAULT;
  })(),
  contextsLeftWidthPx: (() => {
    const v = Number(localStorage.getItem(CONTEXTS_LEFT_WIDTH_KEY));
    return v >= CONTEXTS_LEFT_WIDTH_MIN && v <= CONTEXTS_LEFT_WIDTH_MAX
      ? v
      : CONTEXTS_LEFT_WIDTH_DEFAULT;
  })(),
  libraryDockWidthPx: (() => {
    const v = Number(localStorage.getItem(LIBRARY_DOCK_WIDTH_KEY));
    return v >= LIBRARY_DOCK_WIDTH_MIN && v <= LIBRARY_DOCK_WIDTH_MAX
      ? v
      : LIBRARY_DOCK_WIDTH_DEFAULT;
  })(),
  // Default pinned — the Answers dock stays visible unless turned off.
  answersPinned: localStorage.getItem(ANSWERS_PINNED_KEY) !== "false",
  panelOpenSection: (() => {
    const v = localStorage.getItem(PANEL_OPEN_SECTION_KEY) as PanelSectionId;
    if (!SECTION_ORDER.includes(v)) return "terms";
    // While Answers is pinned, "answers" can't be the open section — the
    // dock is already on screen; fall back to Terms.
    const pinned = localStorage.getItem(ANSWERS_PINNED_KEY) !== "false";
    return pinned && v === "answers" ? "terms" : v;
  })(),
  questionsMode: localStorage.getItem(QUESTIONS_MODE_KEY) === "prep" ? "prep" : "live",

  setAutoInstallUpdates: (enabled) => {
    localStorage.setItem(AUTO_INSTALL_UPDATES_KEY, enabled ? "1" : "0");
    set({ autoInstallUpdates: enabled });
  },

  setPanelSplitRatio: (r) => {
    const clamped = Math.max(0.25, Math.min(0.75, r));
    localStorage.setItem(PANEL_SPLIT_KEY, String(clamped));
    set({ panelSplitRatio: clamped });
  },
  setAnswersPinned: (pinned) => {
    localStorage.setItem(ANSWERS_PINNED_KEY, pinned ? "true" : "false");
    set({ answersPinned: pinned });
  },
  setPanelOpenSection: (id) => {
    if (!SECTION_ORDER.includes(id)) return; // invalid → keep current
    localStorage.setItem(PANEL_OPEN_SECTION_KEY, id);
    set({ panelOpenSection: id });
  },
  setQuestionsMode: (m) => {
    localStorage.setItem(QUESTIONS_MODE_KEY, m);
    set({ questionsMode: m });
  },
  setPanelWidthPx: (px) => {
    const clamped = Math.max(
      PANEL_WIDTH_MIN,
      Math.min(PANEL_WIDTH_MAX, Math.round(px)),
    );
    localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
    set({ panelWidthPx: clamped });
  },
  setContextsLeftWidthPx: (px) => {
    const clamped = Math.max(
      CONTEXTS_LEFT_WIDTH_MIN,
      Math.min(CONTEXTS_LEFT_WIDTH_MAX, Math.round(px)),
    );
    localStorage.setItem(CONTEXTS_LEFT_WIDTH_KEY, String(clamped));
    set({ contextsLeftWidthPx: clamped });
  },
  setLibraryDockWidthPx: (px) => {
    const clamped = Math.max(
      LIBRARY_DOCK_WIDTH_MIN,
      Math.min(LIBRARY_DOCK_WIDTH_MAX, Math.round(px)),
    );
    localStorage.setItem(LIBRARY_DOCK_WIDTH_KEY, String(clamped));
    set({ libraryDockWidthPx: clamped });
  },
  setAllyFontPx: (px) => {
    const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(px)));
    localStorage.setItem(FONT_KEY, String(clamped));
    set({ allyFontPx: clamped });
  },
  bumpAllyFont: (delta) =>
    set((s) => {
      const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, s.allyFontPx + delta));
      localStorage.setItem(FONT_KEY, String(clamped));
      return { allyFontPx: clamped };
    }),
  bumpTranscriptFont: (delta) =>
    set((s) => {
      const clamped = Math.max(
        FONT_MIN,
        Math.min(FONT_MAX, s.transcriptFontPx + delta),
      );
      localStorage.setItem(TRANSCRIPT_FONT_KEY, String(clamped));
      return { transcriptFontPx: clamped };
    }),
  bumpPartnerFont: (delta) =>
    set((s) => {
      const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, s.partnerFontPx + delta));
      localStorage.setItem(PARTNER_FONT_KEY, String(clamped));
      return { partnerFontPx: clamped };
    }),
  setReasoningDefaultOpen: (open) => {
    localStorage.setItem(REASONING_KEY, open ? "1" : "0");
    set({ reasoningDefaultOpen: open });
  },
  setCollapseYou: (on) => {
    localStorage.setItem(COLLAPSE_YOU_KEY, on ? "1" : "0");
    set({ collapseYou: on });
  },
}));

export const ALLY_FONT_MIN = FONT_MIN;
export const ALLY_FONT_MAX = FONT_MAX;
