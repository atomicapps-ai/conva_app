import { describe, expect, it, vi } from "vitest";

import { createCapabilityStore } from "@/lib/capture/capabilityStore";

interface Snap {
  revision: number;
  label: string;
  nested: { n: number };
}

const snap = (revision: number, label = `r${revision}`, n = revision): Snap => ({
  revision,
  label,
  nested: { n },
});

describe("createCapabilityStore — revision ordering", () => {
  it("accepts strictly increasing revisions and rejects stale ones without notifying", () => {
    const store = createCapabilityStore(snap(1));
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.publish(snap(2)).accepted).toBe(true);
    expect(store.snapshot().revision).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);

    const stale = store.publish(snap(2, "dup"));
    expect(stale).toEqual({ accepted: false, reason: "stale_revision", current: snap(2) });
    const older = store.publish(snap(1, "older"));
    expect(older.accepted).toBe(false);
    expect(store.snapshot().label).toBe("r2");
    expect(listener).toHaveBeenCalledTimes(1);

    expect(store.publish(snap(10)).accepted).toBe(true);
    expect(store.snapshot().revision).toBe(10);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("update() bumps the revision by one and keeps untouched slices referentially stable", () => {
    const store = createCapabilityStore(snap(1));
    const before = store.snapshot();
    const after = store.update({ label: "patched" });
    expect(after.revision).toBe(2);
    expect(after.label).toBe("patched");
    expect(after.nested).toBe(before.nested);
    expect(store.snapshot()).toBe(after);
  });

  it("delivers snapshots to listeners in publish order", () => {
    const store = createCapabilityStore(snap(0));
    const seen: number[] = [];
    store.subscribe((s) => seen.push(s.revision));
    store.publish(snap(1));
    store.publish(snap(3));
    store.publish(snap(2)); // stale
    store.update({ label: "x" }); // → 4
    expect(seen).toEqual([1, 3, 4]);
  });
});

describe("createCapabilityStore — subscription cleanup", () => {
  it("stops delivering after unsubscribe; unsubscribing twice is harmless", () => {
    const store = createCapabilityStore(snap(1));
    const a = vi.fn();
    const b = vi.fn();
    const offA = store.subscribe(a);
    store.subscribe(b);
    expect(store.listenerCount()).toBe(2);

    store.publish(snap(2));
    offA();
    offA();
    expect(store.listenerCount()).toBe(1);
    store.publish(snap(3));

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("tolerates a listener unsubscribing itself during notification", () => {
    const store = createCapabilityStore(snap(1));
    const other = vi.fn();
    const off = store.subscribe(() => off());
    store.subscribe(other);
    store.publish(snap(2));
    expect(store.listenerCount()).toBe(1);
    expect(other).toHaveBeenCalledTimes(1);
  });
});
