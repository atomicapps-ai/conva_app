import { describe, expect, it } from "vitest";

import { OperationRegistry } from "@/lib/capture/operations";

describe("OperationRegistry — cancellation contract", () => {
  it("accepts results only while an operation is running", () => {
    const r = new OperationRegistry();
    r.begin("op-1", "ally.run");
    expect(r.accept("op-1")).toBe(true);
    expect(r.complete("op-1")).toBe(true);
    expect(r.accept("op-1")).toBe(false);
    expect(r.get("op-1")?.ignoredResults).toBe(1);
  });

  it("ignores late results after cancel and counts them", () => {
    const r = new OperationRegistry();
    r.begin("op-2", "session.start");
    expect(r.cancel("op-2")).toBe(true);
    expect(r.status("op-2")).toBe("cancelled");
    expect(r.accept("op-2")).toBe(false);
    expect(r.accept("op-2")).toBe(false);
    expect(r.get("op-2")?.ignoredResults).toBe(2);
    // settling twice is a no-op
    expect(r.cancel("op-2")).toBe(false);
    expect(r.complete("op-2")).toBe(false);
  });

  it("rejects results for unknown operation ids", () => {
    const r = new OperationRegistry();
    expect(r.accept("nope")).toBe(false);
    expect(r.status("nope")).toBeNull();
    expect(r.cancel("nope")).toBe(false);
  });

  it("refuses to re-use a live id but allows re-use after it settled", () => {
    const r = new OperationRegistry();
    r.begin("op-3", "x");
    expect(() => r.begin("op-3", "x")).toThrow(/already running/);
    r.complete("op-3");
    expect(() => r.begin("op-3", "x")).not.toThrow();
  });

  it("cancelAll settles every running op; prune drops settled ones", () => {
    const r = new OperationRegistry();
    r.begin("a", "x");
    r.begin("b", "x");
    r.begin("c", "x");
    r.complete("c");
    expect(r.cancelAll().sort()).toEqual(["a", "b"]);
    expect(r.prune()).toBe(3);
    expect(r.get("a")).toBeUndefined();
  });
});
