/**
 * Web auth for the browser build (roadmap 1.2) — the real implementation behind
 * `WebBackend.auth`.
 *
 * Design: the session IS conva_web's session. `conva_web/scripts/auth.js`
 * (the getconva.com login page) writes a `conva.session` record to
 * localStorage; served same-origin (getconva.com/app), this module reads the
 * exact same record — login on the site is login in the app, with no second
 * auth stack. Email/password calls Supabase GoTrue directly with the same raw
 * REST shape auth.js uses; OAuth redirects to the shared login page (Layer 2)
 * rather than reimplementing PKCE here.
 *
 * Backend selection mirrors src-tauri/src/auth.rs: CONVA_SUPABASE_* from the
 * build env (vite `envPrefix` exposes them, so the same .env.dev/.env.prod
 * files drive desktop AND web builds) → live-prod defaults.
 */

import type { AuthStatus } from "@/lib/ipc";

// Same record `conva_web/scripts/auth.js` reads/writes — do not change shape
// without changing it there in the same commit.
const SESSION_KEY = "conva.session";

// Prod (conva-core) — same defaults baked into src-tauri/src/auth.rs.
const DEFAULT_SUPABASE_URL = "https://hbxftjyooblxiiapaeei.supabase.co";
const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhieGZ0anlvb2JseGlpYXBhZWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTQ3MzksImV4cCI6MjEwMDgzMDczOX0.KkvrtUOubjv8DUym7Qj_W_YyYezkVtueKdg9LyQGqQU";

const SUPABASE_URL: string =
  (import.meta.env?.CONVA_SUPABASE_URL as string | undefined) || DEFAULT_SUPABASE_URL;
const ANON_KEY: string =
  (import.meta.env?.CONVA_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_ANON_KEY;

/** The shared login page (Layer 2). Same-origin in production; override for
 *  local dev where the site runs on another port. */
const LOGIN_URL: string =
  (import.meta.env?.CONVA_WEB_LOGIN_URL as string | undefined) || "/login.html";

interface WebSession {
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null; // unix seconds
  email: string | null;
  user_id: string | null;
}

// ------------------------------------------------------------- session store

export function loadSession(): WebSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as WebSession) : null;
  } catch {
    return null;
  }
}

/** Persist a GoTrue token response the same way auth.js does. */
function saveSession(t: {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: { email?: string; id?: string };
}): WebSession {
  const expires_at =
    t.expires_at ?? (t.expires_in ? Math.floor(Date.now() / 1000) + t.expires_in : null);
  const session: WebSession = {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? null,
    expires_at,
    email: t.user?.email ?? null,
    user_id: t.user?.id ?? null,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  notify();
  return session;
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  notify();
}

export function toStatus(s: WebSession | null): AuthStatus {
  const expired = s?.expires_at != null && s.expires_at <= Math.floor(Date.now() / 1000);
  const signed_in = !!s?.access_token && !expired;
  return {
    signed_in,
    email: signed_in ? (s?.email ?? null) : null,
    user_id: signed_in ? (s?.user_id ?? null) : null,
    expires_at_unix: signed_in ? (s?.expires_at ?? null) : null,
    configured: !!ANON_KEY,
  };
}

// ------------------------------------------------- change notification (authChanged)

type Listener = (status: AuthStatus) => void;
const listeners = new Set<Listener>();

function notify(): void {
  const status = toStatus(loadSession());
  for (const l of listeners) l(status);
}

/** Subscribe to session changes (sign-in/out here, or in another tab — the
 *  `storage` event covers the login page completing in a separate tab). */
export function onAuthChanged(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === SESSION_KEY) notify();
  });
}

// ----------------------------------------------------------------- GoTrue REST

class AuthError extends Error {}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    apikey: ANON_KEY,
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (data.error_description as string) ||
      (data.msg as string) ||
      (data.message as string) ||
      `Auth request failed (${res.status})`;
    throw new AuthError(msg);
  }
  return data as T;
}

// -------------------------------------------------------------------- actions

export async function signinPassword(email: string, password: string): Promise<AuthStatus> {
  const data = await post<Parameters<typeof saveSession>[0]>(
    "token?grant_type=password",
    { email: email.trim(), password },
  );
  return toStatus(saveSession(data));
}

export async function signupPassword(email: string, password: string): Promise<AuthStatus> {
  const data = await post<Parameters<typeof saveSession>[0] & { access_token?: string }>(
    "signup",
    { email: email.trim(), password },
  );
  // A session comes back only when email confirmation is off; otherwise the
  // caller sees a signed-out status and the UI says "check your email".
  if (data.access_token) return toStatus(saveSession(data as Parameters<typeof saveSession>[0]));
  return toStatus(null);
}

export async function signout(): Promise<void> {
  const s = loadSession();
  if (s?.access_token) {
    // Best-effort server-side revoke; local clear is what matters.
    await post("logout", {}, s.access_token).catch(() => {});
  }
  clearSession();
}

export function status(): AuthStatus {
  return toStatus(loadSession());
}

/** OAuth / full login: hand off to the shared login page, returning here after. */
export function loginRedirect(_provider?: string): void {
  const back = encodeURIComponent(window.location.href);
  window.location.href = `${LOGIN_URL}?return=${back}`;
}
