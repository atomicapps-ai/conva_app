/**
 * Release notes — the data behind the in-app "What's New" view.
 *
 * REGENERATED per release from the Conventional-Commit log (SDLC §3.2/§4.3):
 * the release pipeline runs git-cliff between the previous tag and `vX.Y.Z` to
 * produce the canonical CHANGELOG.md / GitHub Release body, and seeds a new
 * entry here; the owner edits the `summary` line for human framing on the
 * release branch. This module is the curated in-app slice of those notes — the
 * generated CHANGELOG stays the machine-of-record.
 *
 * Newest first. The entry whose `version` matches the running build
 * (`BUILD.version`, from vite `define`) is highlighted as "You're running this"
 * in {@link WhatsNewView}.
 */

export interface ReleaseSection {
  /** e.g. "Highlights" | "Features" | "Fixes" | "Performance". */
  title: string;
  items: string[];
}

export interface Release {
  /** Semver without a leading `v`, e.g. "0.1.1" — matches `BUILD.version`. */
  version: string;
  /** ISO date the version was tagged, e.g. "2026-07-31". */
  date: string;
  /** One-line human framing (owner-edited on the release branch). */
  summary?: string;
  sections: ReleaseSection[];
}

export const RELEASES: Release[] = [
  {
    version: "0.5.0",
    date: "2026-09-14",
    summary:
      "Take a Context or a saved conversation with you — export it as a portable file and import it back in, on any install.",
    sections: [
      {
        title: "Highlights",
        items: [
          "Export a Context — its setup, attached documents, and generated briefing/research/Q&A — or a saved conversation, with its reviewed claims and corrections, as a single portable .cva file.",
          "Import a .cva file back in on any install to recreate it, including on a fresh machine.",
          "The browser build can now build and download a Context's .cva archive, and bring one back in as a new Context — entirely client-side, no upload required to preview or export what's in an archive before importing it.",
        ],
      },
      {
        title: "Reliability",
        items: [
          "Fixed the draft-release verification step always failing on a fresh release.",
          "Fixed the local web-preview server silently serving the wrong file for every request.",
          "Pinned line endings and now run Core's test suite on Windows CI as well.",
        ],
      },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-09-08",
    summary:
      "Source-aware claim intelligence, faster Context preparation, and a clearer live workspace for every supported conversation type.",
    sections: [
      {
        title: "Highlights",
        items: [
          "Review important claims from a live or saved conversation with attribution, evidence status, confidence, and source-aware next steps.",
          "Choose claim and source policies for interviews, company meetings, sales calls, live streams, and other high-stakes conversations.",
          "Generate separate Research and Q&A resources, then use one compact Context Intelligence Pack for fast live retrieval.",
          "Keep the active question, full Ally answer, and grounding together in Focus while term definitions remain in their own peek.",
        ],
      },
      {
        title: "Experience and reliability",
        items: [
          "Context regeneration now runs in the background so the window stays responsive.",
          "Generated documents are formatted, scrollable, and still offer an exact Raw view.",
          "Updates download in the background and can optionally install automatically after any active live session ends.",
          "Startup progress, compact navigation, narrow Context rows, profile avatars, and the Conva mark were refined.",
        ],
      },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-07-31",
    summary:
      "The current desktop baseline — both-sides capture, on-device transcription, and Ally grounded in your own library.",
    sections: [
      {
        title: "Highlights",
        items: [
          "Live dual-column transcription of both sides of a call, captured from your system audio — no bot joins the meeting.",
          "Ally answers grounded in your document vault, with a citation on every reply.",
          "On-device by default: audio, transcripts, and your library stay on your machine.",
          "Every build now shows its version and commit in the status bar and Settings → About, so you always know exactly what you're running.",
        ],
      },
    ],
  },
];
