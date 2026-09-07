import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebShell } from "@/components/web/WebShell";
import { BackendProvider } from "@/lib/backend";
import { FakeBackend } from "@/lib/backend/fake";
import * as webAuth from "@/lib/backend/webAuth";
import { useConversationStore } from "@/state/conversation";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const session = { signed_in: true, configured: true, email: "a@b.co", user_id: "u-1", expires_at_unix: 9e9, last_sign_in_at: null, provider: "google", beta_access: true, beta_status: "active" };

/**
 * End on web sets the shared `savePromptOpen` flag (app store `stop`); the
 * dialog that renders it was mounted only in the desktop StudioShell, so the
 * first-run rehearsal found step 11 ("Save conversation") silently impossible
 * on web (#238). The web shell must mount it too.
 */
describe("WebShell — the save-conversation prompt renders on web", () => {
  beforeEach(() => webAuth._resetForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => useConversationStore.getState().setSavePromptOpen(false));
  });

  it("shows the dialog when the store asks for it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(session)));
    await webAuth.ready();
    render(
      <BackendProvider backend={new FakeBackend()}>
        <WebShell />
      </BackendProvider>,
    );
    expect(screen.queryByRole("heading", { name: "Save this conversation?" })).toBeNull();
    act(() => useConversationStore.getState().setSavePromptOpen(true));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Save this conversation?" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
