/**
 * Account deletion, UI side: wording, the freshness rule for "confirm it's
 * you", and the small amount of state that survives the web's full-page
 * sign-in redirect. Pure where it can be, so it is unit-tested.
 * Design: conva_core docs/technical/2026-10-account-deletion-scope.md.
 */

/** Days a database backup may keep a deleted account after deletion. `null`
 *  until the real window is read off the Supabase plan (Database → Backups):
 *  the dialog names a number only when this is set, and says nothing specific
 *  about backups' length until then. Counsel confirms the wording. */
export const BACKUP_WINDOW_DAYS: number | null = null;

/** The server accepts a sign-in up to 5 minutes old. The UI stops trusting its
 *  own reading a minute earlier, so a slow click or a small clock difference
 *  does not end in a refusal. The server stays the authority either way. */
export const FRESH_SIGN_IN_WINDOW_MS = 4 * 60_000;

/** Is `lastSignInAt` (ISO 8601 from the session) recent enough to count as "just signed in"? */
export function isFreshSignIn(
  lastSignInAt: string | null,
  nowMs: number,
  windowMs = FRESH_SIGN_IN_WINDOW_MS,
): boolean {
  if (!lastSignInAt) return false;
  const t = Date.parse(lastSignInAt);
  if (!Number.isFinite(t)) return false;
  // A timestamp from the future (a wrong clock) is not evidence of anything.
  return nowMs - t <= windowMs && t <= nowMs + 60_000;
}

/** Typed email matches the account's email (case and surrounding space ignored). */
export function emailMatches(typed: string, email: string | null): boolean {
  return !!email && typed.trim().toLowerCase() === email.trim().toLowerCase();
}

/** The sentence about backups, or `null` when the window is not known yet. */
export function backupSentence(days: number | null = BACKUP_WINDOW_DAYS): string | null {
  if (days === null) return null;
  return `Backups kept by our database host can hold copies for up to ${days} more ${days === 1 ? "day" : "days"}.`;
}

const KNOWN = [
  "recent_sign_in_required",
  "signed_out",
  "quota_exceeded",
  "unprovisioned",
  "storage_cleanup_failed",
  "unconfigured",
  "upstream",
  "network",
  "cross_origin",
] as const;
export type DeleteErrorCode = (typeof KNOWN)[number];

/** Whatever a backend rejected with → one of the stable codes. */
export function deleteErrorCode(e: unknown): DeleteErrorCode {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  return (KNOWN as readonly string[]).includes(raw) ? (raw as DeleteErrorCode) : "upstream";
}

export function friendlyDeleteError(code: DeleteErrorCode): string {
  switch (code) {
    case "recent_sign_in_required":
      return "That sign-in is too old. Sign in again, then delete within a few minutes.";
    case "signed_out":
      return "You were signed out, so nothing was deleted. Sign in and try again.";
    case "quota_exceeded":
      return "Too many attempts today. Try again tomorrow, or email hello@getconva.com.";
    case "unprovisioned":
    case "unconfigured":
      return "Account deletion isn't available on this server yet, so nothing was deleted. Email hello@getconva.com and we'll do it for you.";
    case "storage_cleanup_failed":
      return "Your files couldn't be removed, so nothing was deleted. Try again in a moment.";
    case "network":
      return "Couldn't reach the server, so nothing was deleted. Check your connection and try again.";
    case "cross_origin":
    case "upstream":
    default:
      return "Something went wrong on our side. Your account is intact unless you were told otherwise; try again in a moment.";
  }
}

// ------------------------------------------------- web: surviving the redirect

/** The web's OAuth sign-in navigates the whole page away and back, so the open
 *  dialog is gone on return. A short-lived marker lets the app reopen it at the
 *  confirm step. sessionStorage: this tab only, gone when it closes. */
export const RESUME_KEY = "conva.deleteAccount.resume";
export const RESUME_MAX_AGE_MS = 10 * 60_000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function store(storage?: StorageLike): StorageLike | null {
  try {
    return storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  } catch {
    return null; // blocked storage: the flow still works, it just does not resume
  }
}

export function markResume(nowMs: number, storage?: StorageLike): void {
  try {
    store(storage)?.setItem(RESUME_KEY, String(nowMs));
  } catch {
    /* best-effort */
  }
}

export function hasResume(nowMs: number, storage?: StorageLike, maxAgeMs = RESUME_MAX_AGE_MS): boolean {
  try {
    const raw = store(storage)?.getItem(RESUME_KEY);
    const t = raw ? Number(raw) : NaN;
    return Number.isFinite(t) && nowMs - t >= 0 && nowMs - t <= maxAgeMs;
  } catch {
    return false;
  }
}

export function clearResume(storage?: StorageLike): void {
  try {
    store(storage)?.removeItem(RESUME_KEY);
  } catch {
    /* best-effort */
  }
}
