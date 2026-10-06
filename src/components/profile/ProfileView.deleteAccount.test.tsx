import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileView } from "@/components/profile/ProfileView";
import { RESUME_KEY } from "@/lib/accountDeletion";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { AuthStatus } from "@/lib/ipc";
import { useNavStore } from "@/state/nav";

const runtime = vi.hoisted(() => ({ tauri: true }));
vi.mock("@/lib/backend/detect", () => ({ isTauriRuntime: () => runtime.tauri }));
vi.mock("@/lib/backend/webAuth", () => ({
  provider: () => "google",
  betaAccess: () => true,
  getProfile: () => Promise.resolve({ display_name: null }),
  updateDisplayName: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  window.sessionStorage.clear();
  runtime.tauri = true;
  useNavStore.setState({ view: "profile", pendingSettingsGroup: null });
});

const signedIn = (agoMs: number): AuthStatus => ({
  signed_in: true,
  email: "alice@example.com",
  user_id: "u1",
  expires_at_unix: null,
  last_sign_in_at: new Date(Date.now() - agoMs).toISOString(),
  configured: true,
});

function backend(status: AuthStatus, over: Partial<{ conv: unknown[]; docs: unknown[]; ctx: unknown[] }> = {}) {
  return {
    auth: {
      status: vi.fn().mockResolvedValue(status),
      avatarUrl: vi.fn().mockResolvedValue(null),
      avatarDelete: vi.fn(),
      signout: vi.fn(),
      deleteAccount: vi.fn(),
    },
    subscribe: vi.fn().mockResolvedValue(() => {}),
    conversations: { list: vi.fn().mockResolvedValue(over.conv ?? [{}, {}, {}]) },
    rag: { list: vi.fn().mockResolvedValue(over.docs ?? [{}, {}]) },
    context: { list: vi.fn().mockRejectedValue(new Error("unprovisioned")) },
  } as unknown as ConvaBackend;
}
const mount = (b: ConvaBackend) =>
  render(
    <BackendProvider backend={b}>
      <ProfileView />
    </BackendProvider>,
  );

describe("Profile → account deletion", () => {
  it("replaces 'coming soon' with a Delete account button that opens step 1", async () => {
    mount(backend(signedIn(3_600_000)));
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Delete account…" }));
    expect(await screen.findByRole("dialog", { name: /Delete your Conva account\?/ })).toBeInTheDocument();
  });

  it("desktop has no 'Your data on Conva' card (its data is local)", async () => {
    mount(backend(signedIn(3_600_000)));
    await screen.findByRole("button", { name: "Delete account…" });
    expect(screen.queryByTestId("your-data-on-conva")).toBeNull();
  });

  it("web shows what Conva holds, a dash for a count it cannot read, and Download my data as later", async () => {
    runtime.tauri = false;
    mount(backend(signedIn(3_600_000)));
    const card = await screen.findByTestId("your-data-on-conva");
    await waitFor(() => expect(card).toHaveTextContent("3 conversations"));
    expect(card).toHaveTextContent("2 documents");
    expect(card).toHaveTextContent("—"); // Contexts could not be read: no invented number
    expect(card).toHaveTextContent("alice@example.com");
    expect(screen.getByRole("button", { name: "Download my data" })).toBeDisabled();
    expect(card).toHaveTextContent("Later");
  });

  it("on the web, coming back from the sign-in redirect reopens the dialog at the confirm step", async () => {
    runtime.tauri = false;
    window.sessionStorage.setItem(RESUME_KEY, String(Date.now()));
    mount(backend(signedIn(4_000)));
    expect(await screen.findByRole("dialog", { name: /Confirm it.s you/ })).toBeInTheDocument();
    expect(screen.getByTestId("reauth-status")).toHaveTextContent("Confirmed");
  });

  it("an expired resume marker does not reopen anything", async () => {
    runtime.tauri = false;
    window.sessionStorage.setItem(RESUME_KEY, String(Date.now() - 30 * 60_000));
    mount(backend(signedIn(4_000)));
    await screen.findByRole("button", { name: "Delete account…" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("after a deletion, Close leaves the profile for Home", async () => {
    const b = backend(signedIn(10_000));
    (b.auth.deleteAccount as ReturnType<typeof vi.fn>).mockResolvedValue({ reference: "DEL-ABCD-2345" });
    mount(b);
    fireEvent.click(await screen.findByRole("button", { name: "Delete account…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText(/Type your email to confirm/), { target: { value: "alice@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(await screen.findByText("Your account is deleted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useNavStore.getState().view).toBe("dashboard");
  });
});
