import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GateView } from "@/components/web/GateView";
import { BackendProvider } from "@/lib/backend";
import { FakeBackend } from "@/lib/backend/fake";
import * as webAuth from "@/lib/backend/webAuth";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const session = (beta_access: boolean, beta_status: string | null) => ({
  signed_in: true,
  configured: true,
  email: "a@b.co",
  user_id: "u-1",
  expires_at_unix: 9e9,
  last_sign_in_at: null,
  provider: "google",
  beta_access,
  beta_status,
});

describe("GateView — held state copy follows the spec-10 status", () => {
  beforeEach(() => webAuth._resetForTests());
  afterEach(() => vi.unstubAllGlobals());

  async function mount(status: string | null) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(session(false, status))));
    await webAuth.ready();
    render(
      <BackendProvider backend={new FakeBackend()}>
        <GateView />
      </BackendProvider>,
    );
  }

  it("no row / legacy false → 'in line' with the request-access action", async () => {
    await mount("none");
    expect(screen.getByText("You're in line")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request beta access" })).toBeInTheDocument();
    expect(webAuth.betaStatus()).toBe("none");
  });

  it("revoked reads as withdrawn, never as waiting, and offers no request action", async () => {
    await mount("revoked");
    expect(screen.getByText("Beta access has ended")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request beta access" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("applied and invited get their own copy", async () => {
    await mount("applied");
    expect(screen.getByText(/We'll email you when your seat opens/)).toBeInTheDocument();
  });
});
