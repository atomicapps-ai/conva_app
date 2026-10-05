import { describe, expect, it } from "vitest";
import { check, keepRecording, keepTrace, outcomeOf, runIsGreen, waitUntil } from "./lib.mjs";

const ok = (name, extra = {}) => ({ name, ok: true, ms: 1, ...extra });
const bad = (name, extra = {}) => ({ name, ok: false, ms: 1, ...extra });

describe("outcomeOf", () => {
  it("is pass when every step passes", () => expect(outcomeOf([ok("a"), ok("b")])).toBe("pass"));
  it("is fail on any unexpected failure", () => expect(outcomeOf([ok("a"), bad("b")])).toBe("fail"));
  it("is fail on a page error even if every step passed", () => expect(outcomeOf([ok("a")], ["TypeError: x"])).toBe("fail"));
  it("is known-failing when only known steps fail", () => expect(outcomeOf([ok("a"), bad("b", { known: "PR 249" })])).toBe("known-failing"));
  it("is unexpected-pass when a known step now passes", () => expect(outcomeOf([ok("a"), ok("b", { known: "PR 249" })])).toBe("unexpected-pass"));
  it("is still known-failing while one of several known steps fails", () => expect(outcomeOf([ok("a", { known: "x" }), bad("b", { known: "y" })])).toBe("known-failing"));
  it("an unexpected failure outranks a known one", () => expect(outcomeOf([bad("a"), bad("b", { known: "x" })])).toBe("fail"));
});

describe("keep policy", () => {
  it("drops the recording of a clean pass", () => expect(keepRecording("pass")).toBe(false));
  it("keeps it for every other outcome", () => {
    for (const o of ["fail", "known-failing", "unexpected-pass"]) expect(keepRecording(o)).toBe(true);
  });
  it("keeps everything with --keep", () => expect(keepRecording("pass", true)).toBe(true));
});

describe("trace policy", () => {
  it("keeps the large trace only for what needs debugging", () => {
    expect(keepTrace("pass")).toBe(false);
    expect(keepTrace("known-failing")).toBe(false);
    expect(keepTrace("fail")).toBe(true);
    expect(keepTrace("unexpected-pass")).toBe(true);
    expect(keepTrace("pass", true)).toBe(true);
  });
});

describe("runIsGreen", () => {
  it("passes and known failures are green", () => expect(runIsGreen(["pass", "known-failing"])).toBe(true));
  it("a failure or a stale known marker is red", () => {
    expect(runIsGreen(["pass", "fail"])).toBe(false);
    expect(runIsGreen(["unexpected-pass"])).toBe(false);
  });
});

describe("helpers", () => {
  it("check throws only on a false condition", () => {
    expect(() => check(true, "no")).not.toThrow();
    expect(() => check(false, "boom")).toThrow("boom");
  });
  it("waitUntil resolves a value that turns truthy, and gives up after the timeout", async () => {
    let n = 0;
    expect(await waitUntil(() => ++n >= 3 && "yes", 1000, 5)).toBe("yes");
    expect(await waitUntil(() => false, 60, 5)).toBe(false);
  });
});
