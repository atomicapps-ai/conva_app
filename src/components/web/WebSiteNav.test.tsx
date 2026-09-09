import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebSiteNav } from "@/components/web/WebSiteNav";
import * as webAuth from "@/lib/backend/webAuth";

function session(email: string) {
  return new Response(
    JSON.stringify({
      signed_in: true,
      configured: true,
      email,
      user_id: "user-1",
      expires_at_unix: 9e9,
      last_sign_in_at: null,
      provider: "google",
      beta_access: true,
      beta_status: "active",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("WebSiteNav", () => {
  beforeEach(() => {
    webAuth._resetForTests();
    vi.unstubAllGlobals();
  });

  it("uses the shared blue-A wordmark and shows Admin to getconva@gmail.com", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(session("getconva@gmail.com")));
    await webAuth.ready();
    render(<WebSiteNav />);

    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", expect.stringContaining("/ops.html"));
    const wordmark = screen.getByRole("img", { name: "conva" });
    expect(wordmark.querySelector('path[stroke="var(--color-primary)"]')).not.toBeNull();
  });

  it("does not expose Admin to another signed-in account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(session("someone@example.com")));
    await webAuth.ready();
    render(<WebSiteNav />);

    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });
});
