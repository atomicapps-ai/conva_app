import { useState } from "react";

import { Section } from "@/components/studio/ViewShell";

/** Where the build serves the notices file (copied from conva_core `legal/licenses/`). Follows the
 *  build's base path: the web build lives under `/app/`, the desktop build at `/`. */
export const NOTICES_URL = `${import.meta.env.BASE_URL}third-party-notices.md`;

/**
 * Settings → About & extras → Open-source licences. The notices ship inside
 * the app (public/ is embedded in both the installer and the web build), so
 * this works offline. The text is fetched only when the section is opened; it
 * is a quarter of a megabyte and nobody needs it on every visit.
 */
export function LicencesSection() {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    if (text !== null || failed) return;
    fetch(NOTICES_URL)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setText)
      .catch(() => setFailed(true));
  };

  return (
    <Section
      title="Open-source licences"
      description="conva is built with open-source software and uses fonts and speech models under their own licences. This is the list, with each licence's text."
    >
      <details
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open) load();
        }}
      >
        <summary className="cursor-pointer text-[13px] font-medium text-primary">
          Show the licences
        </summary>
        {failed ? (
          <p className="mt-2 text-[11px] text-rec" data-testid="licences-error">
            The licence list could not be loaded.
          </p>
        ) : text === null ? (
          <p className="mt-2 text-[11px] text-fg-faint">Loading…</p>
        ) : (
          <pre
            className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-bg/40 p-3 font-mono text-[11px] leading-relaxed text-fg-muted"
            data-testid="licences-text"
          >
            {text}
          </pre>
        )}
      </details>
    </Section>
  );
}
