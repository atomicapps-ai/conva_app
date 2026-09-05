/**
 * Web auth for the browser build — the client of the same-origin session BFF
 * (`conva_web/src/bff/app-session.js`, routes under `/api/app/*`).
 *
 * Design (browser architecture §9, platform 01-auth "Web sign-in flow"): the
 * page holds NO Supabase token. Sign-in runs through the Worker, which does the
 * PKCE exchange server-side and keeps refresh material in a server-held session
 * behind an opaque HttpOnly cookie. This module only ever sees the
 * server-validated {@link WebSessionInfo} (identity + entitlement, no secrets):
 *
 *   ready()            first resolve of GET /api/app/session (memoized)
 *   status()           the cached info as an AuthStatus — synchronous, for the
 *                      existing consumers; signed-out until the first resolve
 *   loginRedirect()    top-level navigation to GET /api/app/login (OAuth)
 *   signinPassword()   POST /api/app/login/password → cookie → reload info
 *   signout()          POST /api/app/logout
 *
 * This replaces the `conva.session` localStorage record and the
 * `#conva_session=` fragment hand-off (both retired — migration step 4 of §17).
 * `configured === false` means the BFF itself is not set up (503); the adapter
 * reports auth as `unavailable` with that reason rather than a dead button.
 */

import type { AuthStatus } from "@/lib/ipc";

/** The BFF's session answer. Mirrors `signedOut()`/`infoFrom()` in app-session.js. */
export interface WebSessionInfo {
  signed_in: boolean;
  /** False when the Worker reports the session backend is not configured. */
  configured: boolean;
  email: string | null;
  user_id: string | null;
  expires_at_unix: number | null;
  last_sign_in_at: string | null;
  /** Identity provider of the session ("google", "email", …). */
  provider: string | null;
  /** Server-verified `app_metadata.beta_access`; null when signed out. */
  beta_access: boolean | null;
  /** Set when the Worker could not re-verify upstream and served its last-known record. */
  stale?: boolean;
  /** Machine code from the Worker when something is wrong (e.g. session_backend_unconfigured). */
  error?: string;
  /** Human reason accompanying `error`. */
  reason?: string;
}

/** Same-origin BFF base. Overridable for local dev where vite (1430) proxies to wrangler. */
export const BFF_BASE: string =
  (import.meta.env?.CONVA_WEB_BFF_BASE as string | undefined) || "/api/app";

const SIGNED_OUT: WebSessionInfo = {
  signed_in: false,
  configured: true,
  email: null,
  user_id: null,
  expires_at_unix: null,
  last_sign_in_at: null,
  provider: null,
  beta_access: null,
};

// ------------------------------------------------------------------ state

let current: WebSessionInfo | null = null;
let firstLoad: Promise<WebSessionInfo> | null = null;

type Listener = (status: AuthStatus) => void;
const listeners = new Set<Listener>();

function setCurrent(info: WebSessionInfo): WebSessionInfo {
  current = info;
  const status = toStatus(info);
  for (const l of listeners) l(status);
  return info;
}

/** Test seam: forget everything (module state is process-wide). */
export function _resetForTests(): void {
  current = null;
  firstLoad = null;
  listeners.clear();
}

export function toStatus(s: WebSessionInfo | null): AuthStatus {
  const signed_in = !!s?.signed_in;
  return {
    signed_in,
    email: signed_in ? (s?.email ?? null) : null,
    user_id: signed_in ? (s?.user_id ?? null) : null,
    expires_at_unix: signed_in ? (s?.expires_at_unix ?? null) : null,
    last_sign_in_at: signed_in ? (s?.last_sign_in_at ?? null) : null,
    // "configured" in AuthStatus means sign-in is possible on this surface.
    configured: s?.configured !== false,
  };
}

// ------------------------------------------------------------------ fetch

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BFF_BASE}${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

/** Fetch the current server-validated session. Never throws for auth reasons:
 *  a network failure resolves to the last-known info (or signed-out) marked
 *  `stale`, so a blip never fakes a sign-out or a sign-in. */
export async function load(): Promise<WebSessionInfo> {
  try {
    const { status, body } = await call<Partial<WebSessionInfo>>("/session");
    if (status === 503) {
      return setCurrent({
        ...SIGNED_OUT,
        configured: false,
        error: body.error ?? "session_backend_unconfigured",
        reason: body.reason,
      });
    }
    if (status !== 200) {
      return setCurrent({ ...(current ?? SIGNED_OUT), stale: true, error: `http_${status}` });
    }
    return setCurrent({ ...SIGNED_OUT, ...body, configured: body.configured !== false });
  } catch (e) {
    return setCurrent({
      ...(current ?? SIGNED_OUT),
      stale: true,
      error: "network",
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}

/** The first resolve, memoized — App waits on this before deciding signed-in vs
 *  sign-in screen so no redirect fires on a not-yet-known state. */
export function ready(): Promise<WebSessionInfo> {
  if (!firstLoad) firstLoad = load();
  return firstLoad;
}

/** True once the first session answer has arrived. */
export function isResolved(): boolean {
  return current !== null;
}

/** Cached info (null before the first resolve). */
export function info(): WebSessionInfo | null {
  return current;
}

export function status(): AuthStatus {
  return toStatus(current);
}

/** Subscribe to session changes (sign-in/out through this module, or a reload). */
export function onAuthChanged(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// ------------------------------------------------------------- entitlement

/** The identity provider of the current session, or null. */
export function provider(): string | null {
  return current?.signed_in ? (current.provider ?? null) : null;
}

/**
 * The beta-allowlist entitlement (roadmap 1.2 / owner decision D1) — as
 * VERIFIED BY THE SERVER on `/api/app/session` (app_metadata.beta_access read
 * from Supabase's /auth/v1/user, never a JWT decoded in the page). null when
 * signed out or not yet resolved.
 */
export function betaAccess(): boolean | null {
  if (!current?.signed_in) return null;
  return current.beta_access === true;
}

// -------------------------------------------------------------------- actions

/** Where the BFF should send the user back to after OAuth: the current in-app
 *  path (same-origin only — the Worker re-validates with safeReturnPath). */
export function returnPath(): string {
  if (typeof window === "undefined") return "/app/";
  const { pathname, search } = window.location;
  return `${pathname}${search}`;
}

/** Build the OAuth start URL (pure; tested). */
export function loginUrl(provider = "google", ret = returnPath()): string {
  return `${BFF_BASE}/login?provider=${encodeURIComponent(provider)}&return=${encodeURIComponent(ret)}`;
}

/** OAuth sign-in: a TOP-LEVEL navigation to the Worker (it redirects on to the
 *  IdP and comes back with the cookie set). */
export function loginRedirect(provider = "google"): void {
  window.location.assign(loginUrl(provider));
}

class WebAuthError extends Error {}

async function passwordCall(path: string, email: string, password: string): Promise<AuthStatus> {
  const { status: code, body } = await call<{
    ok?: boolean;
    signed_in?: boolean;
    confirmation_required?: boolean;
    error?: string;
    message?: string;
    reason?: string;
  }>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (code === 503) {
    setCurrent({ ...SIGNED_OUT, configured: false, error: body.error, reason: body.reason });
    throw new WebAuthError(body.reason ?? "Sign-in is not available on this surface yet.");
  }
  if (!body.ok) throw new WebAuthError(body.message ?? body.error ?? `Sign-in failed (${code}).`);
  if (body.signed_in === false && body.confirmation_required) {
    // Account created; the caller's UI says "check your email".
    return toStatus(setCurrent({ ...SIGNED_OUT }));
  }
  return toStatus(await load());
}

export function signinPassword(email: string, password: string): Promise<AuthStatus> {
  return passwordCall("/login/password", email, password);
}

export function signupPassword(email: string, password: string): Promise<AuthStatus> {
  return passwordCall("/signup/password", email, password);
}

export async function signout(): Promise<void> {
  try {
    await call("/logout", { method: "POST" });
  } catch {
    // Best-effort upstream revoke — the local state flips regardless so the
    // UI never shows a session the user asked to end.
  } finally {
    setCurrent({ ...SIGNED_OUT });
  }
}

/** `?signin=failed&reason=…` left by the Worker's callback on a failed OAuth
 *  round-trip. Reads + scrubs it from the URL; null when absent. */
export function consumeSigninFailure(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("signin") !== "failed") return null;
  const reason = params.get("reason") ?? "unknown";
  params.delete("signin");
  params.delete("reason");
  const qs = params.toString();
  history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  return reason;
}
