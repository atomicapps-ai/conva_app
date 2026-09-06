/**
 * Product content — the single source for the market-facing surfaces
 * (Dashboard, Features, What's Coming). Kept as typed data so the view
 * components stay pure layout and copy is editable in one place. Mirrors the
 * feature set + roadmap in `conva_core/docs/product/` (CONVA_PRODUCT_SPEC.md +
 * roadmap.md). Update here when those change.
 */

import type { IconName } from "@/components/ui/Icon";

/** Where a capability is available today. Drives the honest "Desktop app" /
 *  "Web + app" tags — a browser tab can't do OS-loopback capture, local ASR,
 *  or the private overlay, so we say so rather than imply parity. */
export type Availability = "both" | "desktop" | "coming";

export interface Feature {
  id: string;
  title: string;
  blurb: string;
  icon: IconName;
  availability: Availability;
}

/** The shipped product, market-facing. Order = the story we tell. */
export const FEATURES: Feature[] = [
  {
    id: "capture",
    title: "Hears both sides of the call",
    blurb:
      "Transcribes you and the other party live, side by side — captured from your system audio with no bot joining the meeting. On the web, your side is transcribed from the mic.",
    icon: "live",
    availability: "desktop",
  },
  {
    id: "private",
    title: "Your calls never leave your computer",
    blurb:
      "Transcription runs on-device by default — audio, transcripts, and your document library stay local. The default pipeline works with the network unplugged.",
    icon: "system",
    availability: "desktop",
  },
  {
    id: "ally",
    title: "Ally, grounded in your documents",
    blurb:
      "Ask, summarize, or get a suggested reply mid-conversation. Ally retrieves from your own library and cites the exact source on every answer — never invented.",
    icon: "lightbulb",
    availability: "both",
  },
  {
    id: "library",
    title: "Document vault + Question Radar",
    blurb:
      "Drop in PDFs, DOCX, Markdown, or notes. The instant the other party asks something your vault can answer, the matching passage flashes up — zero wait.",
    icon: "library",
    availability: "both",
  },
  {
    id: "providers",
    title: "Your key, your models",
    blurb:
      "Bring your own provider key (Claude, OpenAI, Gemini, Grok, DeepSeek) — it goes straight to the provider, never through our servers — or run fully offline on local Ollama.",
    icon: "command",
    availability: "desktop",
  },
  {
    id: "recording",
    title: "Recordings, conversations & export",
    blurb:
      "Save any call as a named conversation, re-open to append, and export a clean Markdown transcript. Optional stereo recording keeps you and them on separate channels.",
    icon: "record",
    availability: "both",
  },
];

export interface UpcomingItem {
  id: string;
  title: string;
  blurb: string;
  /** Roadmap phase from conva_core/docs/product/roadmap.md. */
  phase: "Phase 1" | "Phase 2" | "Phase 3";
  status: "In progress" | "Planned";
}

/** Private preview of what's coming — shown to signed-in beta members only.
 *  Mirrors conva_core/docs/product/roadmap.md; keep in sync. */
export const UPCOMING: UpcomingItem[] = [
  {
    id: "web",
    title: "conva in your browser",
    blurb:
      "Sign in on the web — no install — for your library, mic-side transcription, and Ally. The desktop app stays the home of both-sides capture and private mode.",
    phase: "Phase 1",
    status: "In progress",
  },
  {
    id: "beta",
    title: "Free invite-only beta",
    blurb:
      "An application-gated early-access program. Approved members get the full desktop experience and a direct line for feedback.",
    phase: "Phase 1",
    status: "In progress",
  },
  {
    // AppUI V5.0 §7 lists this on What's Coming, and decision 7 is why it
    // isn't on the Coaching page yet: analytics stay OFF until there is real
    // session data to compute them from — no placeholder scores, ever.
    id: "coaching-analytics",
    title: "Coaching analytics",
    blurb:
      "Progress and trends across coaching sessions. Stays off until you have real session data — conva will never show you a placeholder score.",
    phase: "Phase 3",
    status: "Planned",
  },
  {
    id: "mock",
    title: "Mock Session practice mode",
    blurb:
      "conva role-plays the other side of an interview or pitch, grounded in your docs, then scores your answers (STAR structure, filler words, and gaps in your vault).",
    phase: "Phase 3",
    status: "Planned",
  },
  {
    id: "turbo",
    title: "Turbo Mode — answers before you finish hearing the question",
    blurb:
      "Pre-computes likely questions and grounded answers from your library before the call, so the right card appears in well under a second — often mid-sentence.",
    phase: "Phase 3",
    status: "Planned",
  },
  {
    id: "incog",
    title: "Incog — a private assistant only you can see",
    blurb:
      "A visibility dial for the overlay, plus a mode that hides it from screen-share, screenshots, and recordings — so it's yours alone on a call. Desktop only.",
    phase: "Phase 3",
    status: "Planned",
  },
  {
    id: "billing",
    title: "Plans & billing",
    blurb:
      "Simple hosted and bring-your-own-key plans when the beta graduates. Beta members keep their early-access standing.",
    phase: "Phase 3",
    status: "Planned",
  },
];

/** Small human label + tone for an availability tag. */
export const AVAILABILITY_META: Record<
  Availability,
  { label: string; tone: "both" | "desktop" | "coming" }
> = {
  both: { label: "Web + app", tone: "both" },
  desktop: { label: "Desktop app", tone: "desktop" },
  coming: { label: "Coming soon", tone: "coming" },
};
