import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    ally: { run: vi.fn().mockResolvedValue(undefined) },
  }),
}));

import { useAllyStore } from "@/state/ally";

function resetStore() {
  useAllyStore.setState({
    cards: [],
    busy: false,
    radar: null,
    tracker: null,
    capture: null,
    starred: new Set(),
    panelMode: "dock",
    panelCollapsed: false,
  });
}

/** Ask a question and immediately mark it done, like a real chunk stream
 *  eventually would via `applyChunk` — needed so `busy` resets between
 *  back-to-back asks in a single test. */
async function ask(question: string): Promise<string> {
  const id = await useAllyStore.getState().request("question", question);
  useAllyStore.getState().applyChunk({ request_id: id, token: "answer", done: true, error: null });
  return id;
}

describe("useAllyStore", () => {
  beforeEach(resetStore);

  it("request() resolves with the new card's id immediately, before the answer streams in", async () => {
    const id = await useAllyStore.getState().request("question", "hi");
    expect(id).toMatch(/^ally-/);
    expect(useAllyStore.getState().cards[0]?.id).toBe(id);
    // Not yet done — the fake backend's `run()` resolving doesn't itself
    // mark the card done; that only happens via a later `applyChunk`.
    expect(useAllyStore.getState().cards[0]?.done).toBe(false);
  });

  it("star/unstar/toggleStar update the starred set", async () => {
    const id = await ask("hi");
    useAllyStore.getState().star(id);
    expect(useAllyStore.getState().starred.has(id)).toBe(true);
    useAllyStore.getState().unstar(id);
    expect(useAllyStore.getState().starred.has(id)).toBe(false);
    useAllyStore.getState().toggleStar(id);
    expect(useAllyStore.getState().starred.has(id)).toBe(true);
    useAllyStore.getState().toggleStar(id);
    expect(useAllyStore.getState().starred.has(id)).toBe(false);
  });

  it("keeps every starred card even past the 5-unstarred rolling cap", async () => {
    const firstId = await ask("q0");
    useAllyStore.getState().star(firstId);
    for (let i = 1; i <= 6; i++) {
      await ask(`q${i}`);
    }
    const ids = useAllyStore.getState().cards.map((c) => c.id);
    expect(ids).toContain(firstId);
  });

  it("still caps unstarred cards at 6 total (newest + 5)", async () => {
    for (let i = 0; i < 8; i++) {
      await ask(`q${i}`);
    }
    expect(useAllyStore.getState().cards).toHaveLength(6);
  });

  it("setPanelMode/setPanelCollapsed update the panel state", () => {
    useAllyStore.getState().setPanelMode("starred");
    expect(useAllyStore.getState().panelMode).toBe("starred");
    useAllyStore.getState().setPanelCollapsed(true);
    expect(useAllyStore.getState().panelCollapsed).toBe(true);
  });

  it("clear() also clears starred", async () => {
    const id = await ask("hi");
    useAllyStore.getState().star(id);
    useAllyStore.getState().clear();
    expect(useAllyStore.getState().starred.size).toBe(0);
    expect(useAllyStore.getState().cards).toEqual([]);
  });
});
