/**
 * Account identity for the V5.0 rail / Home / Settings account block.
 *
 * Owner decision (AppUI V5.0, decision 6): **production uses the real
 * signed-in user's name, role, and avatar.** "Maya Chen · Senior Product
 * Manager" is demo/marketing fixture content that lives only in the design
 * package and in `src/lib/fixtures/` — never in a production code path. When
 * no approved photo exists, the runtime fallback is the **account initials
 * monogram**, never a stock face and never an invented name.
 *
 * Where each field comes from:
 * - `email` — Supabase, via `AuthStatus` (the one identity string every
 *   account has).
 * - `displayName` / `role` — the user's own profile settings
 *   (`AppConfig.profile_display_name` / `profile_role`, editable in
 *   Settings → Account). Absent until they fill them in; we then fall back to
 *   the email's local part for a name and show no role line at all rather
 *   than inventing a title.
 * - `avatarUrl` — not wired to any store yet. The type carries it so the
 *   consuming components are already shaped for a real photo; today it is
 *   always `null`, which is exactly why `initials` exists.
 *
 * Pure — no React, no IPC. Unit-tested in `account.test.ts`.
 */

import type { AuthStatus } from "@/lib/ipc";

/** The profile fields the user owns (mirrors the two AppConfig fields). */
export interface AccountProfile {
  displayName: string | null;
  role: string | null;
  /** Reserved for an approved photo; `null` today → monogram fallback. */
  avatarUrl?: string | null;
}

export interface Account {
  signedIn: boolean;
  /** Best available human name. Never null — falls back to a generic label. */
  displayName: string;
  /** The user's own job title. `null` when unset — render nothing, not a guess. */
  role: string | null;
  email: string | null;
  /** 1–2 uppercase letters for the monogram avatar. */
  initials: string;
  /** Approved photo, when one exists. `null` → render `initials`. */
  avatarUrl: string | null;
}

/** Label used when we know someone is signed in but have no name at all. */
export const SIGNED_IN_FALLBACK_NAME = "Your account";
/** Label used when signed out. */
export const SIGNED_OUT_NAME = "Sign in";

/** The part of an email before the "@" — "maya.chen@x.com" → "maya.chen". */
function localPart(email: string): string {
  const at = email.indexOf("@");
  return (at > 0 ? email.slice(0, at) : email).trim();
}

/**
 * Split a human name / email local part into words, treating ".", "_", "-",
 * "+" and whitespace as separators so "maya.chen" and "Maya Chen" agree.
 */
function words(value: string): string[] {
  return value
    .split(/[\s._\-+]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * Monogram initials: first letter of the first word plus first letter of the
 * last word (max two), from the display name when there is one, else from the
 * email's local part. `"?"` when there is nothing at all to work from —
 * deliberately not a fabricated "MC".
 */
export function accountInitials(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const source = displayName?.trim() ? displayName : (email ?? "").trim() ? localPart(email as string) : "";
  const parts = words(source).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (parts.length === 0) return "?";
  /** First letter/digit of a word, by code point (so "Ćirić" → "Ć"). */
  const letterOf = (word: string | undefined): string =>
    [...(word ?? "")].find((c) => /[\p{L}\p{N}]/u.test(c)) ?? "";
  const first = letterOf(parts[0]);
  if (parts.length === 1) return first.toUpperCase() || "?";
  const last = letterOf(parts[parts.length - 1]);
  return (first + last).toUpperCase() || "?";
}

/**
 * Resolve everything the account block needs from the two real sources.
 * Never fabricates a name, a role, or a face.
 */
export function resolveAccount(
  auth: AuthStatus | null | undefined,
  profile?: Partial<AccountProfile> | null,
): Account {
  const signedIn = auth?.signed_in ?? false;
  const email = auth?.email?.trim() || null;
  const name = profile?.displayName?.trim() || null;
  const role = profile?.role?.trim() || null;
  const avatarUrl = profile?.avatarUrl?.trim() || null;

  const displayName = name ?? (email ? localPart(email) : null) ?? (signedIn ? SIGNED_IN_FALLBACK_NAME : SIGNED_OUT_NAME);

  return {
    signedIn,
    displayName,
    role: signedIn ? role : null,
    email,
    initials: signedIn ? accountInitials(name ?? email, email) : "?",
    avatarUrl: signedIn ? avatarUrl : null,
  };
}

/**
 * "today 09:14" / "yesterday 09:14" / "Aug 12" — the terse last-sign-in label
 * for the account popover. Full detail (`toLocaleString`) stays in Settings.
 */
export function formatLastSignIn(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) return `today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `yesterday ${time}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * "Good morning" / "Good afternoon" / "Good evening" — Home's greeting, from
 * the local clock. Exported so the greeting is testable without a render.
 */
export function greetingFor(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
