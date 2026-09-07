import { create } from "zustand";

import type { CaptureSourceKind } from "@/lib/capture/contract";
import { HOSTED_NOTICE_ID } from "@/lib/live/hostedNotice";
import { LiveSessionError } from "@/lib/live/liveClient";
import type { LiveTerms, SessionConsent } from "@/lib/live/protocol";

/**
 * Hosted-processing consent (web, M2 cp16). The web backend ASKS this store
 * before the first capture of a session and before scope expands to shared
 * call audio; the `HostedNoticeGate` renders the pending request as the
 * notice dialog, and the user's click resolves the backend's promise — so
 * "Start" → notice → "Start listening" is one flow, and the same click that
 * accepts is the user gesture the share chooser needs. One grant per session:
 * `request` for a fresh session always asks; an expansion inside a live
 * session asks once and then remembers. Nothing here is persisted.
 */
interface PendingRequest {
  scope: CaptureSourceKind[];
  expanding: boolean;
  resolve: (grant: SessionConsent) => void;
  reject: (error: Error) => void;
}

export interface HostedConsentState {
  /** The provider facts the gateway reported (`GET /api/live/status` `terms`), for the notice text. */
  terms: LiveTerms | undefined;
  pending: PendingRequest | null;
  /** The current session's grant (scope accumulates on expansion). */
  granted: SessionConsent | null;
  setTerms: (terms: LiveTerms | undefined) => void;
  /** Ask the user. Resolves with the grant to send; rejects `consent_required` when declined. */
  request: (scope: CaptureSourceKind[], expanding?: boolean) => Promise<SessionConsent>;
  accept: () => void;
  decline: () => void;
  /** The session ended: the next Start asks again. */
  reset: () => void;
}

export const useHostedConsentStore = create<HostedConsentState>((set, get) => ({
  terms: undefined,
  pending: null,
  granted: null,
  setTerms: (terms) => set({ terms }),
  request: (scope, expanding = false) => {
    const { pending, granted } = get();
    // Scope already granted in this live session (e.g. "Share again"): no second dialog.
    if (expanding && granted && scope.every((k) => granted.scope.includes(k))) return Promise.resolve(granted);
    pending?.reject(new LiveSessionError("consent_required", "Superseded by a newer request."));
    return new Promise<SessionConsent>((resolve, reject) => {
      set({ pending: { scope, expanding, resolve, reject } });
    });
  },
  accept: () => {
    const { pending, granted } = get();
    if (!pending) return;
    const previous = pending.expanding && granted ? granted.scope : [];
    const grant: SessionConsent = {
      notice: HOSTED_NOTICE_ID,
      scope: [...new Set([...previous, ...pending.scope])],
      acknowledged_at: Date.now(),
    };
    set({ pending: null, granted: grant });
    pending.resolve(grant);
  },
  decline: () => {
    const { pending } = get();
    if (!pending) return;
    set({ pending: null });
    pending.reject(new LiveSessionError("consent_required", "Acknowledge the hosted-processing notice to start."));
  },
  reset: () => {
    const { pending } = get();
    pending?.reject(new LiveSessionError("consent_required", "The session ended."));
    set({ pending: null, granted: null });
  },
}));

/** Convenience for the backend: ask through the store (kept out of React). */
export function requestHostedConsent(scope: CaptureSourceKind[], expanding = false): Promise<SessionConsent> {
  return useHostedConsentStore.getState().request(scope, expanding);
}
