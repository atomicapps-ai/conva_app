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

  describe("profile + avatar (roadmap 1.2)", () => {
    it("getProfile reads display_name from the BFF; a non-200 (e.g. signed out) reads back null rather than throwing", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ display_name: "Julius Kelly" }));
      expect(await webAuth.getProfile()).toEqual({ display_name: "Julius Kelly" });
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/app/profile");

      fetchMock.mockResolvedValueOnce(jsonResponse({ error: "signed_out" }, 401));
      expect(await webAuth.getProfile()).toEqual({ display_name: null });
    });

    it("updateDisplayName PATCHes JSON to the BFF and returns its answer verbatim", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, display_name: "New Name" }));
      const res = await webAuth.updateDisplayName("New Name");
      expect(res).toEqual({ ok: true, display_name: "New Name" });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/app/profile");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(String(init.body))).toEqual({ display_name: "New Name" });
    });

    it("avatarUrl points at the same-origin BFF proxy, never a Supabase/Google URL", () => {
      expect(webAuth.avatarUrl()).toBe("/api/app/profile/avatar");
    });

    it("uploadAvatar rejects an unsupported type, an empty file, and an oversized file WITHOUT a network call", async () => {
      const bad = new File(["x"], "a.pdf", { type: "application/pdf" });
      expect(await webAuth.uploadAvatar(bad)).toEqual({ ok: false, error: "unsupported_type" });

      const empty = new File([], "a.png", { type: "image/png" });
      expect(await webAuth.uploadAvatar(empty)).toEqual({ ok: false, error: "empty_file" });

      const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.png", { type: "image/png" });
      expect(await webAuth.uploadAvatar(big)).toEqual({ ok: false, error: "too_large" });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uploadAvatar POSTs a valid image with its real Content-Type", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
      expect(await webAuth.uploadAvatar(file)).toEqual({ ok: true });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/app/profile/avatar");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("image/png");
      expect(init.body).toBe(file);
    });

    it("uploadAvatar surfaces the server's coded rejection and a network failure alike", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "too_large" }, 413));
      const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
      expect(await webAuth.uploadAvatar(file)).toEqual({ ok: false, error: "too_large" });

      fetchMock.mockRejectedValueOnce(new TypeError("offline"));
      expect(await webAuth.uploadAvatar(file)).toEqual({ ok: false, error: "network" });
    });

    it("deleteAvatar DELETEs the BFF route and reports success/failure by status", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect(await webAuth.deleteAvatar()).toBe(true);
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });

      fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
      expect(await webAuth.deleteAvatar()).toBe(false);

      fetchMock.mockRejectedValueOnce(new TypeError("offline"));
      expect(await webAuth.deleteAvatar()).toBe(false);
    });
  });
});
