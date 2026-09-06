import { describe, expect, it } from "vitest";

import { newSession, newSource, sessionFailed, sessionFinalized, sessionLive, sessionStopping, sessionSummary, transition } from "./sourceMachine";

describe("source state machine (§12)", () => {
  it("idle → prompting → capturing; denied returns to idle with a reason", () => {
    const s = newSource("mic", "mic", "self");
    expect(transition(s, { type: "granted" }).ok).toBe(false);
    expect(transition(s, { type: "prompt" }).to).toBe("prompting");
    expect(transition(s, { type: "denied", reason: "Permission denied" })).toMatchObject({ ok: true, to: "idle" });
    expect(s.reason).toBe("Permission denied");
    transition(s, { type: "prompt" });
    expect(transition(s, { type: "granted", sourceIndex: 0 }).to).toBe("capturing");
    expect(s.sourceIndex).toBe(0);
  });
  it("capturing ⇄ degraded, disconnect → reconnecting → reconnected bumps the epoch", () => {
    const s = newSource("mic", "mic", "self");
    transition(s, { type: "prompt" });
    transition(s, { type: "granted" });
    expect(transition(s, { type: "degrade", reason: "track ended" }).to).toBe("degraded");
    expect(transition(s, { type: "recover" }).to).toBe("capturing");
    expect(transition(s, { type: "disconnect", reason: "socket" }).to).toBe("reconnecting");
    const t = transition(s, { type: "reconnected", sourceIndex: 2 });
    expect(t).toMatchObject({ to: "capturing", epochBumped: true });
    expect(s.epoch).toBe(1);
    expect(s.sourceIndex).toBe(2);
  });
  it("ended is terminal and every path can end", () => {
    const s = newSource("mic", "mic", "self");
    expect(transition(s, { type: "end", reason: "user" }).to).toBe("ended");
    expect(transition(s, { type: "prompt" }).ok).toBe(false);
  });
});

describe("session record", () => {
  it("creating → live → stopping → finalized ends every source; stop is idempotent; one source failing never overwrites another", () => {
    const sess = newSession();
    expect(sessionLive(sess, "live_1")).toBe(true);
    const mic = newSource("mic", "mic", "self");
    const share = newSource("share", "display", "remote_mix");
    sess.sources.set("mic", mic);
    sess.sources.set("share", share);
    transition(mic, { type: "prompt" }); transition(mic, { type: "granted" });
    transition(share, { type: "prompt" }); transition(share, { type: "granted" });
    transition(share, { type: "degrade", reason: "share ended" });
    expect(sessionSummary(sess)).toEqual({ self: "capturing", remote: "degraded", anyCapturing: true });
    expect(sessionStopping(sess)).toBe(true);
    expect(sessionStopping(sess)).toBe(true);
    sessionFinalized(sess);
    expect(sess.phase).toBe("finalized");
    expect(mic.phase).toBe("ended");
    expect(share.phase).toBe("ended");
  });
  it("failed keeps its reason and ends sources", () => {
    const sess = newSession();
    sessionLive(sess, "x");
    sess.sources.set("mic", newSource("mic", "mic", "self"));
    sessionFailed(sess, "gateway gone");
    expect(sess.phase).toBe("failed");
    expect(sess.reason).toBe("gateway gone");
    expect(sess.sources.get("mic")!.phase).toBe("ended");
  });
});
