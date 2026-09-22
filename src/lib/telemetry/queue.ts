/**
 * The local durable event queue's shared TS interface (docs/platform/
 * 15-events-implementation.md §6) — `appendEvent`/`readBatch`/
 * `advanceCursor`, reached the same way regardless of what eventually calls
 * them (a future UI-driven event like `ally_answer_action`, or a future
 * flush loop draining the queue to `/api/events`/`/api/live/events`).
 *
 * Desktop-only for now: the adapter below calls the Tauri commands backed by
 * `src-tauri/src/telemetry_events.rs`'s file-backed queue. The web build's
 * IndexedDB adapter (15 §6: no filesystem access in a browser) is a real gap
 * flagged there, not built here — this module degrades to a harmless no-op
 * off desktop rather than throwing, the same "adapter, not fork" shape used
 * elsewhere for Tauri-vs-web command availability.
 *
 * The metering-derived events (`ally_asked`, `research_search`,
 * `tts_synthesized`) do NOT go through this module today — they're appended
 * directly by `src-tauri/src/metering.rs`'s Rust call sites, which is cheaper
 * than an IPC round trip for signals that already originate in Rust. This
 * module exists for everything else: future UI-driven events, and the read
 * side any future flush loop needs.
 */
import { telemetryAdvanceCursor, telemetryAppendEvent, telemetryDeviceId, telemetryReadBatch } from "@/lib/commands";
import type { TelemetryEvent } from "@/lib/ipc";
import { isDesktop } from "@/lib/platform";

import { EVENTS_SCHEMA_VERSION, PLATFORM_VALUES, validateEvent } from "./events";

/** Append one taxonomy event. Validates client-side first (the same
 *  discipline the shell/server re-apply) so a caller finds out immediately
 *  rather than silently losing an event the queue would have refused anyway.
 *  A no-op on the web build until its IndexedDB adapter exists. */
export async function appendEvent(ev: string, fields: Record<string, unknown>, sessionId?: string | null): Promise<void> {
  if (!isDesktop) return;
  const envelope = {
    ev,
    seq: 0, // the shell assigns the real sequence number under its lock
    t: Date.now(),
    schema_v: EVENTS_SCHEMA_VERSION,
    session_id: sessionId ?? null,
    app_version: "0.0.0", // the shell stamps its own CARGO_PKG_VERSION; unused on this path
    platform: PLATFORM_VALUES[0],
    fields,
  };
  const violations = validateEvent(envelope);
  if (violations.length > 0) {
    console.warn("[telemetry] refusing to enqueue malformed event", ev, violations);
    return;
  }
  await telemetryAppendEvent(ev, fields, sessionId ?? null);
}

/** The next up-to-`limit` unflushed events, oldest first. `[]` on the web
 *  build until its adapter exists. */
export async function readBatch(limit: number): Promise<TelemetryEvent[]> {
  if (!isDesktop) return [];
  return telemetryReadBatch(limit);
}

/** Mark everything through `throughSeq` as durably flushed — call only after
 *  the server has confirmed the batch. A no-op on the web build. */
export async function advanceCursor(throughSeq: number): Promise<void> {
  if (!isDesktop) return;
  await telemetryAdvanceCursor(throughSeq);
}

/** This device's persisted telemetry id. `null` on the web build until its
 *  adapter exists. */
export async function deviceId(): Promise<string | null> {
  if (!isDesktop) return null;
  return telemetryDeviceId();
}
