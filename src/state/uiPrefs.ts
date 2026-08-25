import { create } from "zustand";

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
const FONT_MIN = 11;
const FONT_MAX = 20;
const FONT_DEFAULT = 14;
const TRANSCRIPT_FONT_DEFAULT = 12;

function loadFont(key: string, fallback: number): number {
  const v = Number(localStorage.getItem(key));
  return v >= FONT_MIN && v <= FONT_MAX ? v : fallback;
}

interface UiPrefs {
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
  setAllyFontPx: (px: number) => void;
  bumpAllyFont: (delta: number) => void;
  bumpTranscriptFont: (delta: number) => void;
  bumpPartnerFont: (delta: number) => void;
  setReasoningDefaultOpen: (open: boolean) => void;
  setCollapseYou: (on: boolean) => void;
}

export const useUiPrefs = create<UiPrefs>((set) => ({
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

  setPanelSplitRatio: (r) => {
    const clamped = Math.max(0.25, Math.min(0.75, r));
    localStorage.setItem(PANEL_SPLIT_KEY, String(clamped));
    set({ panelSplitRatio: clamped });
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
