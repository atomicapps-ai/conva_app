import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebShell } from "@/components/web/WebShell";
import { RESUME_KEY } from "@/lib/accountDeletion";
import { useNavStore } from "@/state/nav";

// The shell's children are exercised elsewhere; only the resume effect matters here.
vi.mock("@/components/HealthStrip", () => ({ HealthStrip: () => null }));
vi.mock("@/components/SaveConversationDialog", () => ({ SaveConversationDialog: () => null }));
vi.mock("@/components/studio/ViewRouter", () => ({ ViewRouter: () => null }));
vi.mock("@/components/web/GateView", () => ({ GateView: () => null, useAccessGate: () => false }));
vi.mock("@/components/web/HostedNoticeGate", () => ({ HostedNoticeGate: () => null }));
vi.mock("@/components/web/WebSiteNav", () => ({ WebSiteNav: () => null }));
vi.mock("@/components/web/WebTopNav", () => ({ WebTopNav: () => null }));

afterEach(cleanup);
beforeEach(() => {
  window.sessionStorage.clear();
  useNavStore.setState({ view: "dashboard" });
});

describe("WebShell: back from the sign-in that Delete account asked for", () => {
  it("lands on Profile when a deletion was in progress", () => {
    window.sessionStorage.setItem(RESUME_KEY, String(Date.now()));
    render(<WebShell />);
    expect(useNavStore.getState().view).toBe("profile");
  });

  it("leaves navigation alone otherwise, or when the marker is old", () => {
    render(<WebShell />);
    expect(useNavStore.getState().view).toBe("dashboard");
    cleanup();
    window.sessionStorage.setItem(RESUME_KEY, String(Date.now() - 30 * 60_000));
    render(<WebShell />);
    expect(useNavStore.getState().view).toBe("dashboard");
  });
});
