/**
 * Desktop adapter compatibility — the M0 store/envelope additions must leave
 * the Tauri adapter's existing behavior untouched. `@tauri-apps/api/event` and
 * the command wrappers are mocked (never a live invoke — see AGENTS.md).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionStateEvent, TranscriptSegment } from "@/lib/ipc";

type Listener = (e: { payload: unknown }) => void;
const listeners = new Map<string, Set<Listener>>();
const unlistenCalls: string[] = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (channel: string, cb: Listener) => {
    const set = listeners.get(channel) ?? new Set<Listener>();
    set.add(cb);
    listeners.set(channel, set);
    return () => {
      unlistenCalls.push(channel);
      set.delete(cb);
    };
  }),
}));

// Every command wrapper the adapter binds must exist on the mock; the two we
// exercise get real fakes, the rest are inert stubs that would fail loudly.
vi.mock("@/lib/commands", () => {
  const named: Record<string, unknown> = {
    conversationLoad: vi.fn(async (id: string) => ({
      id,
      title: "Legacy record",
      created_at_unix_ms: 1,
      updated_at_unix_ms: 2,
      linked_docs: [],
      segments: [
        {
          side: "outbound",
          seq: 1,
          text: "hi",
          is_final: true,
          start_ms: 0,
          end_ms: 500,
          confidence: null,
          latency_ms: 10,
        },
      ],
    })),
    startSession: vi.fn(async () => "sess-1"),
  };
  // `then` must stay undefined or the module namespace becomes a thenable
  // and `await import()` never resolves; symbols/default likewise.
  const stubs = new Map<string, unknown>();
  return new Proxy(named, {
    get: (target, key) => {
      if (typeof key !== "string" || key === "then" || key === "default") return undefined;
      if (key in target) return target[key];
      if (!stubs.has(key)) {
        stubs.set(
          key,
          vi.fn(async () => {
            throw new Error(`unexpected command ${key}`);
          }),
        );
      }
      return stubs.get(key);
    },
    has: (target, key) => typeof key === "string" && key !== "then" && key !== "default",
  });
});

import { DESKTOP_CAPABILITIES } from "@/lib/backend/capabilities";
import { sourceOfKind, type RuntimeProbe } from "@/lib/backend/capabilitySnapshot";
import { DESKTOP_UNKNOWN_SESSION, TauriBackend } from "@/lib/backend/tauri";
import { conversationToEvents } from "@/lib/capture/legacy";

const windows: RuntimeProbe = {
  os: "windows",
  hasGetUserMedia: true,
  hasGetDisplayMedia: true,
  secureContext: true,
};

function emit(channel: string, payload: unknown) {
  for (const cb of listeners.get(channel) ?? []) cb({ payload });
}

beforeEach(() => {
  listeners.clear();
  unlistenCalls.length = 0;
});

describe("TauriBackend — existing behavior", () => {
  it("capabilities() still resolves the exact static desktop descriptor", async () => {
    const b = new TauriBackend(windows);
    await expect(b.capabilities()).resolves.toBe(DESKTOP_CAPABILITIES);
    expect(b.capabilityStore.snapshot().legacy).toBe(DESKTOP_CAPABILITIES);
    expect(b.capabilityStore.snapshot().adapter).toBe("tauri");
  });

  it("delegates commands unchanged (conversations.load → conversationLoad)", async () => {
    const b = new TauriBackend(windows);
    const c = await b.conversations.load("conv-1");
    expect(c.id).toBe("conv-1");
    // a legacy record read through the adapter projects to envelopes
    expect(conversationToEvents(c).map((e) => e.channel)).toEqual(["self"]);
    await expect(b.session.start()).resolves.toBe("sess-1");
  });

  it("subscribe() binds the same conva://* channel as before", async () => {
    const b = new TauriBackend(windows);
    const handler = vi.fn();
    const off = await b.subscribe("transcriptSegment", handler);
    const seg: TranscriptSegment = {
      side: "inbound",
      seq: 3,
      text: "x",
      is_final: false,
      start_ms: 1,
      end_ms: 2,
      confidence: null,
      latency_ms: 0,
    };
    emit("conva://transcript-segment", seg);
    expect(handler).toHaveBeenCalledWith(seg);
    off();
    expect(unlistenCalls).toEqual(["conva://transcript-segment"]);
  });
});

describe("TauriBackend — M0 additions", () => {
  it("reports WASAPI honestly per OS while the legacy descriptor stays static", () => {
    const win = new TauriBackend(windows).capabilityStore.snapshot();
    const mac = new TauriBackend({ ...windows, os: "macos" }).capabilityStore.snapshot();
    expect(sourceOfKind(win, "wasapi")?.availability.state).toBe("available");
    expect(sourceOfKind(mac, "wasapi")?.availability.state).toBe("unsupported");
    expect(mac.legacy.capture.systemAudio).toBe("loopback"); // unchanged legacy answer
  });

  it("subscribeEnvelopes lifts legacy segments: outbound → self, inbound → remote_mix", async () => {
    const b = new TauriBackend(windows);
    const seen: Array<{ session: string; channel: string; seq: number; text: string }> = [];
    const off = await b.subscribeEnvelopes((e) =>
      seen.push({ session: e.session_id, channel: e.channel, seq: e.seq, text: e.payload.text }),
    );

    const seg = (side: TranscriptSegment["side"], seq: number, text: string): TranscriptSegment => ({
      side,
      seq,
      text,
      is_final: true,
      start_ms: seq * 100,
      end_ms: seq * 100 + 50,
      confidence: null,
      latency_ms: 0,
    });

    // before any session state → the unknown-session bucket
    emit("conva://transcript-segment", seg("outbound", 1, "early"));
    const listening: SessionStateEvent = {
      state: "listening",
      session_id: "sess-42",
      started_at_unix_ms: 1,
    };
    emit("conva://session-state", listening);
    emit("conva://transcript-segment", seg("outbound", 1, "me"));
    emit("conva://transcript-segment", seg("inbound", 1, "them"));
    emit("conva://transcript-segment", seg("outbound", 2, "me again"));

    expect(seen).toEqual([
      { session: DESKTOP_UNKNOWN_SESSION, channel: "self", seq: 0, text: "early" },
      { session: "sess-42", channel: "self", seq: 0, text: "me" },
      { session: "sess-42", channel: "remote_mix", seq: 0, text: "them" },
      { session: "sess-42", channel: "self", seq: 1, text: "me again" },
    ]);

    off();
    expect(unlistenCalls.sort()).toEqual(["conva://session-state", "conva://transcript-segment"]);
  });
});
