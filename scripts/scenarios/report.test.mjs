import { describe, expect, it } from "vitest";
import { renderReport } from "./report.mjs";

const base = {
  ran_at: "2026-10-05T18:50:00.000Z",
  browser: { requested: "chromium", version: "141.0" },
  os: { platform: "linux", arch: "x64" },
  scenarios: [
    { id: "R1-library", title: "Library <flows>", matrix: ["Lib 4"], outcome: "known-failing", ms: 4000, steps: [{ name: "Add a note", ok: true, ms: 1200 }, { name: "Count updates", ok: false, ms: 3000, known: "#393: stale count", error: "expected 31" }], recording: { dir: "r1-library", video: "session.webm" } },
    { id: "R2-honesty", title: "Honesty", matrix: [], outcome: "pass", ms: 1000, steps: [{ name: "Refused", ok: true, ms: 900 }], recording: null },
  ],
};

describe("renderReport", () => {
  const html = renderReport(base, { videoSrc: (r) => (r.recording ? `${r.recording.dir}/${r.recording.video}` : null), standalone: true });
  it("escapes titles and notes", () => {
    expect(html).toContain("Library &lt;flows&gt;");
    expect(html).not.toContain("Library <flows>");
  });
  it("shows the tally and the known-problem note with the issue", () => {
    expect(html).toContain("1 passed");
    expect(html).toContain("1 known problems");
    expect(html).toContain("Known: #393: stale count");
    expect(html).toContain("Saw: expected 31");
  });
  it("embeds a video only where one was kept, and says why otherwise", () => {
    expect(html).toContain('src="r1-library/session.webm"');
    expect(html.match(/<video/g)).toHaveLength(1);
    expect(html).toContain("a clean pass keeps nothing");
  });
  it("is a full document when standalone and a fragment when not", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(renderReport(base).startsWith("<title>")).toBe(true);
  });
  it("defines every colour as a token with a dark variant", () => {
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain('[data-theme="dark"]');
  });
});
