import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeBackend } from "@/lib/backend/fake";
import { BackendProvider } from "@/lib/backend/context";
import { useIpcBridge } from "@/lib/useIpcBridge";
import type { RadarEvent } from "@/lib/ipc";
import { useAllyStore } from "@/state/ally";
import { useLiveAssistStore } from "@/state/liveAssist";
import { assistResult, completedResult } from "@/test/liveAssistFixtures";

function setup() {
  const backend = new FakeBackend();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BackendProvider backend={backend}>{children}</BackendProvider>
  );
  renderHook(() => useIpcBridge(), { wrapper });
  return backend;
}

const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

beforeEach(() => {
  useLiveAssistStore.getState().clear();
  useAllyStore.getState().clear();
});

describe("useIpcBridge — live assist", () => {
  it("folds a holding response and then the grid into one result, in order", async () => {
    const backend = setup();
    await tick();
    act(() => backend.emit("liveAssist", assistResult()));
    expect(useLiveAssistStore.getState().results).toHaveLength(1);
    expect(useLiveAssistStore.getState().results[0]!.lifecycle).toBe("provisional");

    act(() => backend.emit("liveAssist", completedResult()));
    const results = useLiveAssistStore.getState().results;
    expect(results).toHaveLength(1);
    expect(results[0]!.lifecycle).toBe("complete");
    expect(results[0]!.timing.compute_ms).toBe(24);

    // A delayed duplicate of the holding response cannot undo it.
    act(() => backend.emit("liveAssist", assistResult()));
    expect(useLiveAssistStore.getState().results[0]!.lifecycle).toBe("complete");
  });

  it("does not ask a model to answer a question that is being computed", async () => {
    const backend = setup();
    await tick();
    const request = vi.fn().mockResolvedValue("ok");
    useAllyStore.setState({ request });
    const miss: RadarEvent = {
      turn_id: "s1:them:4",
      source_key: "inbound-4",
      question: "What's the total amount per district?",
      outcome: "miss",
      confidence: 0,
      bridge: { kind: "boundary", text: "I don't want to guess at the exact detail." },
      sources: [],
      computed: true,
    };
    act(() => backend.emit("radar", miss));
    await tick();
    expect(request).not.toHaveBeenCalled();

    // The same miss without the flag still gets its quality answer.
    act(() => backend.emit("radar", { ...miss, turn_id: "s1:them:5", computed: false }));
    await tick();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
