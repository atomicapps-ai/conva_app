import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as webAuth from "@/lib/backend/webAuth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SIGNED_IN = {
  signed_in: true,
  configured: true,
  email: "a@b.co",
  user_id: "u-1",
  expires_at_unix: 4_600,
  last_sign_in_at: "2026-09-05T00:00:00Z",
  provider: "google",
  beta_access: true,
};

describe("webAuth — BFF session client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    webAuth._resetForTests();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is signed out and unresolved before the first answer; ready() resolves it once", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SIGNED_IN));
    expect(webAuth.isResolved()).toBe(false);
    expect(webAuth.status().signed_in).toBe(false);

    const [a, b] = await Promise.all([webAuth.ready(), webAuth.ready()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/app/session");
    expect(init.credentials).toBe("same-origin");

    expect(webAuth.isResolved()).toBe(true);
    expect(webAuth.status()).toEqual({
      signed_in: true,
      email: "a@b.co",
      user_id: "u-1",
      expires_at_unix: 4_600,
      last_sign_in_at: "2026-09-05T00:00:00Z",
      configured: true,
    });
    expect(webAuth.betaAccess()).toBe(true);
    expect(webAuth.provider()).toBe("google");
  });

  it("reports an unconfigured backend (503) honestly: configured=false, signed out, reason kept", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ signed_in: false, configured: false, error: "session_backend_unconfigured", reason: "SESSION_SECRET is not set" }, 503),
    );
    const info = await webAuth.ready();
    expect(info.configured).toBe(false);
    expect(info.reason).toMatch(/SESSION_SECRET/);
    expect(webAuth.status().configured).toBe(false);
    expect(webAuth.status().signed_in).toBe(false);
    expect(webAuth.betaAccess()).toBeNull();
  });

  it("a network failure never fakes a sign-out: last-known info is kept and marked stale", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SIGNED_IN));
    await webAuth.ready();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const info = await webAuth.load();
    expect(info.signed_in).toBe(true);
    expect(info.stale).toBe(true);
    expect(info.error).toBe("network");
  });

  it("notifies listeners on every change and stops after unsubscribe", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SIGNED_IN));
    const seen: boolean[] = [];
    const off = webAuth.onAuthChanged((s) => seen.push(s.signed_in));
    await webAuth.ready();
    expect(seen).toEqual([true]);
    off();
    fetchMock.mockResolvedValue(jsonResponse({ ...SIGNED_IN, signed_in: false }));
    await webAuth.load();
    expect(seen).toEqual([true]);
  });

  it("loginUrl targets the BFF with a same-origin return path, URL-encoded", () => {
    expect(webAuth.loginUrl("google", "/app/live?x=1")).toBe(
      "/api/app/login?provider=google&return=%2Fapp%2Flive%3Fx%3D1",
    );
  });

  it("signinPassword POSTs JSON to the BFF and then reloads the session", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, signed_in: true }))
      .mockResolvedValueOnce(jsonResponse(SIGNED_IN));
    const status = await webAuth.signinPassword(" a@b.co ", "pw");
    expect(status.signed_in).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/app/login/password");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ email: "a@b.co", password: "pw" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/app/session");
  });

  it("signinPassword surfaces the Worker's rejection message and stays signed out", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: "auth_rejected", message: "Invalid login credentials" }, 401),
    );
    await expect(webAuth.signinPassword("a@b.co", "no")).rejects.toThrow(/Invalid login credentials/);
    expect(webAuth.status().signed_in).toBe(false);
  });

  it("signupPassword with confirmation required resolves signed out without a session call", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, signed_in: false, confirmation_required: true }));
    const status = await webAuth.signupPassword("a@b.co", "pw");
    expect(status.signed_in).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("signout POSTs to the BFF and clears the cached session even if the call fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SIGNED_IN));
    await webAuth.ready();
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await webAuth.signout();
    expect(webAuth.status().signed_in).toBe(false);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/app/logout");
  });

  it("consumeSigninFailure reads and scrubs ?signin=failed&reason= from the URL", () => {
    history.replaceState(null, "", "/app/?signin=failed&reason=access_denied&keep=1");
    expect(webAuth.consumeSigninFailure()).toBe("access_denied");
    expect(window.location.search).toBe("?keep=1");
    expect(webAuth.consumeSigninFailure()).toBeNull();
    history.replaceState(null, "", "/");
  });

  it("never persists anything in localStorage (the old conva.session record is retired)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SIGNED_IN));
    await webAuth.ready();
    expect(localStorage.getItem("conva.session")).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
