import { describe, expect, it, vi } from "vitest";

import { WEB_CAPABILITIES } from "@/lib/backend/capabilities";
import { FAKE_IMPLEMENTED, FakeBackend, FakeBackendNotConfiguredError } from "@/lib/backend/fake";
import { ALL_OPERATIONS } from "@/lib/backend/capabilitySnapshot";
import { isUsable } from "@/lib/capture/contract";
import {
  EXPECTED_FINALS,
  TWO_CHANNEL_CLEAN,
  buildTwoChannelFaulty,
} from "@/lib/capture/fixtures/twoChannel";
import { EventLedger } from "@/lib/capture/ledger";
import { conversationToEvents } from "@/lib/capture/legacy";
import { OperationRegistry } from "@/lib/capture/operations";
import { TranscriptState } from "@/lib/capture/transcriptState";
import type { Conversation } from "@/lib/ipc";

const LEGACY: Conversation = {
  id: "conv-legacy",
  title: "Saved before the contract",
  created_at_unix_ms: 1,
  updated_at_unix_ms: 2,
  linked_docs: [],
  segments: [
    { side: "outbound", seq: 1, text: "hello", is_final: true, start_ms: 0, end_ms: 400, confidence: null, latency_ms: 5 },
    { side: "inbound", seq: 1, text: "hi there", is_final: true, start_ms: 500, end_ms: 900, confidence: 0.7, latency_ms: 6 },
  ],
};

/** Run a stream through ledger + reducer, the way a consumer would. */
async function consume(backend: FakeBackend) {
  const ledger = new EventLedger();
  const state = new TranscriptState();
  const decisions: Array<{ id: string; acceptance: string; outcome: string | null }> = [];
  const off = await backend.subscribeEnvelopes((e) => {
    const d = ledger.offer(e);
    const outcome = d.apply ? state.apply(e).outcome : null;
    decisions.push({ id: e.event_id, acceptance: d.acceptance, outcome });
  });
  return { ledger, state, decisions, off };
}

describe("FakeBackend — honesty", () => {
  it("reports implemented operations available and everything else unimplemented", () => {
    const b = new FakeBackend();
    const ops = b.capabilityStore.snapshot().operations;
    for (const op of ALL_OPERATIONS) {
      expect(isUsable(ops[op])).toBe(FAKE_IMPLEMENTED.includes(op));
    }
    expect(b.capabilityStore.snapshot().adapter).toBe("fake");
  });

  it("rejects unconfigured operations instead of resolving a no-op", async () => {
    const b = new FakeBackend();
    await expect(b.ally.run("r", "question", "q", [])).rejects.toBeInstanceOf(
      FakeBackendNotConfiguredError,
    );
    await expect(b.rag.analyzeTerms("x")).rejects.toThrow(/rag.analyzeTerms/);
    await expect(b.hud.isOpen()).rejects.toThrow(/not configured/);
  });
});

describe("FakeBackend — capability revisions", () => {
  it("publishes revisions deterministically to subscribers and via capabilities()", async () => {
    const b = new FakeBackend();
    const seen: number[] = [];
    const off = b.capabilityStore.subscribe((s) => seen.push(s.revision));
    b.publishCapabilities({ legacy: WEB_CAPABILITIES });
    expect(await b.capabilities()).toBe(WEB_CAPABILITIES);
    const stale = b.publishSnapshot({ ...b.capabilityStore.snapshot(), revision: 1 });
    expect(stale.accepted).toBe(false);
    b.publishCapabilities({ sources: [] });
    off();
    b.publishCapabilities({ sources: [] });
    expect(seen).toEqual([2, 3]);
  });
});

describe("FakeBackend — deterministic replay", () => {
  it("replays the clean two-channel fixture into the expected finals, twice identically", async () => {
    const run = async () => {
      const b = new FakeBackend();
      const c = await consume(b);
      expect(b.replay(TWO_CHANNEL_CLEAN)).toBe(TWO_CHANNEL_CLEAN.length);
      c.off();
      return c;
    };
    const a = await run();
    const b = await run();
    expect(a.decisions).toEqual(b.decisions);
    expect(a.decisions.every((d) => d.acceptance === "accepted")).toBe(true);
    expect(a.state.finals().map((e) => ({ channel: e.channel, text: e.payload.text }))).toEqual(
      EXPECTED_FINALS,
    );
    // self and remote phrases differ and land on their own channels
    const self = a.state.finals().filter((e) => e.channel === "self").map((e) => e.payload.text);
    const remote = a.state.finals().filter((e) => e.channel === "remote_mix").map((e) => e.payload.text);
    expect(self).toHaveLength(2);
    expect(remote).toHaveLength(2);
    expect(self.some((t) => remote.includes(t))).toBe(false);
    // legacy projection keeps the two-side model readable
    expect(a.state.toLegacySegments().map((s) => s.side)).toEqual([
      "outbound",
      "inbound",
      "outbound",
      "inbound",
    ]);
  });

  it("the faulty stream: duplicate + stale epoch rejected, reordered accepted, correction applied", async () => {
    const b = new FakeBackend();
    const c = await consume(b);
    const faulty = buildTwoChannelFaulty();
    b.replay(faulty.events);
    c.off();

    const byId = (id: string) => c.decisions.filter((d) => d.id === id);
    const dup = byId(faulty.expectRejected.duplicate);
    expect(dup.map((d) => d.acceptance)).toEqual(["accepted", "duplicate"]);
    expect(byId(faulty.expectRejected.staleEpoch)[0]?.acceptance).toBe("stale_epoch");
    const reordered = byId(faulty.expectReordered)[0]!;
    expect(reordered.acceptance).toBe("reordered");
    // the late partial arrived after its own final → the reducer ignores it
    expect(reordered.outcome).toBe("late_partial_ignored");
    expect(byId(faulty.correction.event_id)[0]?.outcome).toBe("corrected");

    const finals = c.state.finals().map((e) => e.payload.text);
    expect(finals).toEqual([
      EXPECTED_FINALS[0]!.text,
      "They did, it's fourteen thousand five hundred now, down from forty.",
      EXPECTED_FINALS[2]!.text,
      EXPECTED_FINALS[3]!.text,
    ]);
    // the superseded final is still in the record's history
    expect(c.state.get("inbound-1")?.history.map((h) => h.payload.revision)).toEqual([2, 3]);
    expect(c.state.finals()).toHaveLength(4);
  });

  it("delivers nothing after unsubscribe and tracks the delivered log", async () => {
    const b = new FakeBackend();
    const handler = vi.fn();
    const off = await b.subscribeEnvelopes(handler);
    b.emitEnvelope(TWO_CHANNEL_CLEAN[0]!);
    off();
    b.emitEnvelope(TWO_CHANNEL_CLEAN[1]!);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(b.delivered).toHaveLength(2);
    expect(b.envelopeSubscriberCount()).toBe(0);
  });
});

describe("FakeBackend — cancellation ignores late results", () => {
  it("results arriving for a cancelled operation are counted and never applied", async () => {
    const b = new FakeBackend();
    const ops = new OperationRegistry();
    const state = new TranscriptState();
    const OP = "op-live-1";
    ops.begin(OP, "session.start");
    const off = await b.subscribeEnvelopes((e) => {
      if (ops.accept(OP)) state.apply(e);
    });
    const [first, second, ...rest] = TWO_CHANNEL_CLEAN;
    b.emitEnvelope(first!);
    b.emitEnvelope(second!);
    expect(state.size()).toBeGreaterThan(0);
    const before = state.events().map((e) => e.event_id);

    ops.cancel(OP);
    b.replay(rest);
    off();

    expect(state.events().map((e) => e.event_id)).toEqual(before);
    expect(ops.get(OP)?.ignoredResults).toBe(rest.length);
    expect(ops.status(OP)).toBe("cancelled");
  });
});

describe("FakeBackend — sessions and legacy conversations", () => {
  it("start/stop emit sessionState with deterministic ids", async () => {
    const b = new FakeBackend();
    const states: string[] = [];
    await b.subscribe("sessionState", (s) => states.push(s.state));
    expect(await b.session.start()).toBe("fake-session-1");
    expect(b.currentSessionId()).toBe("fake-session-1");
    await b.session.stop();
    expect(await b.session.start()).toBe("fake-session-2");
    expect(states).toEqual(["listening", "idle", "listening"]);
  });

  it("loads a pre-contract conversation untouched and projects it to envelopes", async () => {
    const b = new FakeBackend({ conversations: [LEGACY] });
    const loaded = await b.conversations.load("conv-legacy");
    expect(loaded).toBe(LEGACY);
    expect(loaded).not.toHaveProperty("schema_version");
    const events = conversationToEvents(loaded);
    expect(events.map((e) => e.channel)).toEqual(["self", "remote_mix"]);
    const list = await b.conversations.list();
    expect(list[0]).toMatchObject({ id: "conv-legacy", segment_count: 2, preview: "hello" });
    await expect(b.conversations.load("missing")).rejects.toThrow(/not found/);
  });

  it("save mints deterministic ids and appends on re-save", async () => {
    const b = new FakeBackend();
    const a = await b.conversations.save(null, "First", LEGACY.segments.slice(0, 1), []);
    expect(a.id).toBe("fake-conv-1");
    const again = await b.conversations.save(a.id, null, LEGACY.segments, ["doc-1"]);
    expect(again.id).toBe("fake-conv-1");
    expect(again.title).toBe("First");
    expect(again.segments).toHaveLength(2);
    expect(again.created_at_unix_ms).toBe(a.created_at_unix_ms);
    expect(again.updated_at_unix_ms).toBeGreaterThan(a.updated_at_unix_ms);
    await b.conversations.delete(a.id);
    expect(await b.conversations.list()).toEqual([]);
  });
});
