import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StatusBar } from "@/components/studio/StatusBar";
import { BackendProvider } from "@/lib/backend";
import type { ConvaBackend } from "@/lib/backend/ConvaBackend";

function fakeBackend(): ConvaBackend {
  return {
    diagnostics: { saveDebugLog: vi.fn().mockResolvedValue("/tmp/conva-debug.log") },
    screenshot: { save: vi.fn().mockResolvedValue("/tmp/screenshots/x.png") },
  } as unknown as ConvaBackend;
}

describe("StatusBar", () => {
  it("hides the screenshot button off-desktop — jsdom has no __TAURI_INTERNALS__, so isTauri() is false", () => {
    render(
      <BackendProvider backend={fakeBackend()}>
        <StatusBar />
      </BackendProvider>,
    );
    expect(screen.queryByRole("button", { name: /take a screenshot/i })).toBeNull();
  });
});
