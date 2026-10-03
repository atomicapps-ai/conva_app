import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelsView } from "@/components/modelCompare/ModelsView";
import type { AppConfig } from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useNavStore } from "@/state/nav";

const desktopConfig = {
  llm_quality: { provider: "anthropic", model: "claude-sonnet-5-5" },
  llm_fast: null,
} as unknown as AppConfig;

afterEach(cleanup);

describe("ModelsView on the hosted web app (no settings store)", () => {
  beforeEach(() => {
    useAppStore.setState({ config: null, keyStatus: {} });
  });

  it("is read-only: it explains who picks the model and offers no switch buttons", () => {
    render(<ModelsView />);
    expect(screen.getByRole("heading", { name: "Compare models" })).toBeInTheDocument();
    expect(screen.getByText(/Conva chooses the model for you/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use for the/ })).not.toBeInTheDocument();
  });

  it("selecting a dot shows that model's details", () => {
    render(<ModelsView />);
    fireEvent.click(screen.getByRole("button", { name: /Claude Opus 5\.5: first token 3\.06 seconds/ }));
    expect(screen.getByRole("heading", { name: "Claude Opus 5.5" })).toBeInTheDocument();
    expect(screen.getByText("Too slow to start")).toBeInTheDocument();
  });

  it("the keyboard selects a dot too", () => {
    render(<ModelsView />);
    fireEvent.keyDown(screen.getByRole("button", { name: /gpt-6-luna: first token/ }), { key: "Enter" });
    expect(screen.getByRole("heading", { name: "gpt-6-luna" })).toBeInTheDocument();
  });

  it("the Conva call types measure names the models it has not covered", () => {
    render(<ModelsView />);
    fireEvent.click(screen.getByRole("radio", { name: "Conva call types" }));
    const note = screen.getByTestId("not-measured");
    expect(note).toHaveTextContent("Claude Sonnet 5.5");
    expect(note).toHaveTextContent("Claude Opus 5.5");
    expect(note).not.toHaveTextContent("Claude Haiku 4.5");
    // Only the two measured models remain as dots.
    expect(screen.getAllByRole("button", { name: /first token/ })).toHaveLength(2);
  });

  it("the speed filter hides models that miss the live budget and says so", () => {
    render(<ModelsView />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Only models that start inside 0\.6 s/ }));
    expect(screen.getAllByRole("button", { name: /first token/ })).toHaveLength(2);
    expect(screen.getByTestId("filtered-out")).toHaveTextContent("Claude Opus 5.5");
  });

  it("draws the line chart with a legend naming each model it plots", () => {
    render(<ModelsView />);
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("Claude Haiku 4.5")).toBeInTheDocument();
    expect(within(legend).getByText("gpt-5.4-mini")).toBeInTheDocument();
    expect(within(legend).queryByText("Claude Opus 5.5")).not.toBeInTheDocument();
  });

  it("the table carries every model's numbers", () => {
    render(<ModelsView />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 7);
    expect(within(table).getByText("$0.0221")).toBeInTheDocument();
  });

  it("back returns to Settings", () => {
    useNavStore.setState({ view: "models" });
    render(<ModelsView />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(useNavStore.getState().view).toBe("settings");
  });
});

describe("ModelsView on desktop (settings store present)", () => {
  const updateConfig = vi.fn(async () => {});
  beforeEach(() => {
    updateConfig.mockClear();
    useAppStore.setState({
      config: desktopConfig,
      keyStatus: { anthropic: true, openai: false },
      updateConfig,
    });
  });

  it("opens on the model already in the quality slot", () => {
    render(<ModelsView />);
    expect(screen.getByRole("heading", { name: "Claude Sonnet 5.5" })).toBeInTheDocument();
  });

  it("Use for the fast slot sets only the fast slot", async () => {
    render(<ModelsView />);
    fireEvent.click(screen.getByRole("button", { name: /Claude Haiku 4\.5: first token/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use for the fast slot" }));
    expect(updateConfig).toHaveBeenCalledWith({
      llm_fast: { provider: "anthropic", model: "claude-haiku-4-5" },
    });
    expect(await screen.findByText("Claude Haiku 4.5 is now the fast slot.")).toBeInTheDocument();
  });

  it("Use for the quality slot sets only the quality slot", async () => {
    render(<ModelsView />);
    fireEvent.click(screen.getByRole("button", { name: "Use for the quality slot" }));
    expect(updateConfig).toHaveBeenCalledWith({
      llm_quality: { provider: "anthropic", model: "claude-sonnet-5-5" },
    });
    expect(await screen.findByText("Claude Sonnet 5.5 is now the quality slot.")).toBeInTheDocument();
  });

  it("warns when the model's provider has no saved key, and when it is too slow for the fast slot", () => {
    render(<ModelsView />);
    fireEvent.click(screen.getByRole("button", { name: /gpt-5\.5: first token/ }));
    expect(screen.getByText(/No OpenAI API key is saved yet/)).toBeInTheDocument();
    expect(screen.getByText(/should start inside 0\.6 s; this model's median is 1\.39 s/)).toBeInTheDocument();
  });
});
