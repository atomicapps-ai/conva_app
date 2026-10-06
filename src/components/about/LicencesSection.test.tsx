import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LicencesSection, NOTICES_URL } from "@/components/about/LicencesSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LicencesSection", () => {
  it("fetches nothing until opened, then shows the notices text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Third-party notices\nMIT"));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<LicencesSection />);
    expect(fetchMock).not.toHaveBeenCalled();
    const details = container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await waitFor(() =>
      expect(screen.getByTestId("licences-text")).toHaveTextContent("Third-party notices"),
    );
    expect(fetchMock).toHaveBeenCalledWith(NOTICES_URL);
  });

  it("says so, and does not crash, when the list cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    const { container } = render(<LicencesSection />);
    const details = container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await waitFor(() => expect(screen.getByTestId("licences-error")).toBeInTheDocument());
  });

  it("is backed by a real file in public/ that carries the notices", () => {
    const text = readFileSync("public/third-party-notices.md", "utf8");
    expect(text).toMatch(/^# Third-party notices/);
    expect(text.length).toBeGreaterThan(100_000);
  });
});
