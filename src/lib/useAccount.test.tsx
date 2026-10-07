import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { notifyAvatarChanged } from "@/lib/avatarSignal";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { AuthStatus } from "@/lib/ipc";
import { useAccount } from "@/lib/useAccount";
import { useAppStore } from "@/state/app";

afterEach(() => {
  cleanup();
  useAppStore.setState({ config: null });
});

const signedOut: AuthStatus = {
  signed_in: false,
  email: null,
  user_id: null,
  expires_at_unix: null,
  last_sign_in_at: null,
  configured: true,
};
const signedIn: AuthStatus = { ...signedOut, signed_in: true, email: "julius@example.com", user_id: "u1" };

function Probe() {
  const { account } = useAccount();
  return (
    <div>
      <span data-testid="state">{account.signedIn ? "in" : "out"}</span>
      <span data-testid="initials">{account.initials}</span>
      <span data-testid="avatar">{account.avatarUrl ?? "none"}</span>
    </div>
  );
}

/** A backend whose sign-in state and photo the test controls, and whose `authChanged` it can fire. */
function controllable(initial: AuthStatus, avatar: () => string | null = () => null) {
  let status = initial;
  let handler: ((p: unknown) => void) | null = null;
  const backend = {
    auth: {
      status: vi.fn(async () => status),
      avatarUrl: vi.fn(async () => avatar()),
    },
    subscribe: vi.fn(async (_event: string, h: (p: unknown) => void) => {
      handler = h;
      return () => {
        handler = null;
      };
    }),
  } as unknown as ConvaBackend;
  return {
    backend,
    signIn: () => {
      status = signedIn;
      handler?.({ status, error: null });
    },
  };
}

const mount = (backend: ConvaBackend) =>
  render(
    <BackendProvider backend={backend}>
      <Probe />
    </BackendProvider>,
  );

describe("useAccount", () => {
  it("flips to signed in when an out-of-band sign-in completes, with no navigation", async () => {
    const c = controllable(signedOut);
    mount(c.backend);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));
    await act(async () => c.signIn());
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in"));
    expect(screen.getByTestId("initials")).toHaveTextContent("J");
  });

  it("shows the stored profile photo once signed in, and not before", async () => {
    const c = controllable(signedOut, () => "blob:photo-1");
    mount(c.backend);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));
    expect(screen.getByTestId("avatar")).toHaveTextContent("none");
    await act(async () => c.signIn());
    await waitFor(() => expect(screen.getByTestId("avatar")).toHaveTextContent("blob:photo-1"));
  });

  it("reloads the photo when the Profile page changes it", async () => {
    let n = 0;
    const c = controllable(signedIn, () => `blob:photo-${++n}`);
    mount(c.backend);
    await waitFor(() => expect(screen.getByTestId("avatar")).toHaveTextContent("blob:photo-1"));
    await act(async () => notifyAvatarChanged());
    await waitFor(() => expect(screen.getByTestId("avatar")).toHaveTextContent("blob:photo-2"));
  });

  it("falls back to initials, not an error, when the backend has no photo or no event support", async () => {
    const bare = {
      auth: { status: vi.fn(async () => signedIn) },
    } as unknown as ConvaBackend;
    mount(bare);
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in"));
    expect(screen.getByTestId("avatar")).toHaveTextContent("none");
    expect(screen.getByTestId("initials")).toHaveTextContent("J");
  });
});
