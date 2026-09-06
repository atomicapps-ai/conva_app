import { useEffect, useRef } from "react";

import { hostedNotice } from "@/lib/live/hostedNotice";
import { useHostedConsentStore } from "@/state/hostedConsent";

/*
 * src/components/web/ — WEB-ONLY. The hosted-processing notice (M2 cp16): the
 * desktop has `ConsentGate` (a one-time recording-law acknowledgement gated in
 * the shell); the browser product sends audio and text to hosted providers, so
 * it states — per session, from the gateway's reported `terms` — what is
 * captured, where it is processed, what is stored, and the user's duty to
 * participants (architecture §10). Renders only while the backend is waiting
 * for an answer; the confirm button is the click that starts (or shares).
 */
export function HostedNoticeGate() {
  const pending = useHostedConsentStore((s) => s.pending);
  const terms = useHostedConsentStore((s) => s.terms);
  const accept = useHostedConsentStore((s) => s.accept);
  const decline = useHostedConsentStore((s) => s.decline);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);

  if (!pending) return null;
  const copy = hostedNotice(terms, pending.scope, pending.expanding);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hosted-notice-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") decline();
      }}
    >
      <div className="mx-4 max-w-md rounded-lg border border-border bg-panel p-6">
        <h2 id="hosted-notice-title" className="text-sm font-semibold">
          {copy.title}
        </h2>
        {copy.paragraphs.map((text, i) => (
          <p key={i} className={`${i === 0 ? "mt-3" : "mt-2"} text-sm leading-relaxed text-fg-muted`}>
            {text}
          </p>
        ))}
        <div className="mt-5 flex gap-2">
          <button
            ref={confirmRef}
            type="button"
            onClick={accept}
            className="flex-1 rounded-md bg-ai/90 px-4 py-2 text-sm font-semibold text-bg hover:bg-ai"
          >
            {copy.confirm}
          </button>
          <button
            type="button"
            onClick={decline}
            className="rounded-md border border-border-strong px-4 py-2 text-sm font-semibold text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
