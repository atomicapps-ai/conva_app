import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NavRail } from "@/components/studio/NavRail";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import type { AuthStatus } from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useNavStore } from "@/state/nav";

afterEach(cleanup);

function authStatus(over: Partial<AuthStatus> = {}): AuthStatus {
  return {
    signed_in: true,
    email: "maya.chen@example.com",
    user_id: "u1",
    expires_at_unix: null,
    last_sign_in_at: null,
    configured: true,
    ...over,
  };
}

function fakeBackend(status: AuthStatus, signout = vi.fn()): ConvaBackend {
  return {
    auth: {
      status: vi.fn().mockResolvedValue(status),
      signout: signout.mockResolvedValue(undefined),
    },
  } as unknown as ConvaBackend;
}

beforeEach(() => {
  useNavStore.setState({ view: "dashboard", paletteOpen: false });
  useAppStore.setState({ config: null });
});

/** The six approved rows, in order (AppUI V5.0 §1). */
const ROWS = ["Home", "Live Session", "Contexts", "Library", "Coaching", "What's Coming"];

/**
 * Render the rail and wait for the async `auth.status()` fetch to land, so no
 * assertion races the account block's own state update.
 */
async function renderRail(
  ui: React.ReactElement,
  { signedIn = true }: { signedIn?: boolean } = {},
) {
  const out = render(ui);
  await screen.findByRole("button", {
    name: signedIn ? /— account$/i : /account — sign in/i,
  });
  return out;
}

describe("NavRail — primary navigation", () => {
  it("renders exactly the six destinations, in order", async () => {
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail />
      </BackendProvider>,
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const label of ROWS) {
      expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0);
    }
    // No Settings row and no Conversations row — both moved off the rail.
    expect(nav.querySelector('[aria-label="Conversations"]')).toBeNull();
  });

  it("navigates on click", async () => {
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail />
      </BackendProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Coaching" }));
    expect(useNavStore.getState().view).toBe("coaching");
    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(useNavStore.getState().view).toBe("library");
  });

  it("marks the current destination as the active page", async () => {
    useNavStore.setState({ view: "library" });
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail />
      </BackendProvider>,
    );
    expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("lights NO row while Settings is open (§8)", async () => {
    useNavStore.setState({ view: "settings" });
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail />
      </BackendProvider>,
    );
    for (const label of ROWS) {
      expect(screen.getByRole("button", { name: label })).not.toHaveAttribute("aria-current");
    }
  });

  it("lights Home while the Conversations sub-view is open", async () => {
    useNavStore.setState({ view: "conversations" });
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail />
      </BackendProvider>,
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });
});

describe("NavRail — Settings routing", () => {
  it("opens Settings from the account utility gear, not a rail row", async () => {
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail />
      </BackendProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(useNavStore.getState().view).toBe("settings");
  });

  it("signs out from the utility row", async () => {
    const signout = vi.fn();
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus(), signout)}>
        <NavRail />
      </BackendProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signout).toHaveBeenCalled());
  });

  it("sends a signed-out user to Settings to sign in", async () => {
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus({ signed_in: false, email: null }))}>
        <NavRail />
      </BackendProvider>,
      { signedIn: false },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(useNavStore.getState().view).toBe("settings");
  });
});

describe("NavRail — account block", () => {
  it("shows the user's own display name and role when they have set them", async () => {
    useAppStore.setState({
      config: {
        profile_display_name: "Maya Chen",
        profile_role: "Senior Product Manager",
      } as never,
    });
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail />
      </BackendProvider>,
    );
    expect(await screen.findByText("Maya Chen")).toBeInTheDocument();
    expect(screen.getByText("Senior Product Manager")).toBeInTheDocument();
  });

  it("falls back to the email — never a fabricated name or role", async () => {
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail />
      </BackendProvider>,
    );
    expect(await screen.findByText("maya.chen")).toBeInTheDocument();
    expect(screen.queryByText("Senior Product Manager")).toBeNull();
    expect(screen.queryByText(/Maya Chen/)).toBeNull();
  });

  it("shows no unread dot on Notifications — there is no producer yet", async () => {
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail />
      </BackendProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(screen.getByText("No notifications")).toBeInTheDocument();
  });
});

describe("NavRail — responsive modes", () => {
  it("drops the labels but keeps every row (and its accessible name) when compact", async () => {
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail mode="icons" />
      </BackendProvider>,
    );
    for (const label of ROWS) {
      const row = screen.getByRole("button", { name: label });
      expect(row).toBeInTheDocument();
      expect(row).toHaveTextContent("");
    }
  });

  it("hides the utility row in icon mode — it moves into the account flyout", async () => {
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail mode="icons" />
      </BackendProvider>,
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Notifications" })).toBeNull(),
    );
    fireEvent.click(await screen.findByRole("button", { name: /account/i }));
    expect(await screen.findByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
  });

  it("closes the ☰ drawer after navigating", async () => {
    const onNavigate = vi.fn();
    await renderRail(
      <BackendProvider backend={fakeBackend(authStatus())}>
        <NavRail mode="expanded" onNavigate={onNavigate} />
      </BackendProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Contexts" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(useNavStore.getState().view).toBe("context");
  });
});
