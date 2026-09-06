import { describe, expect, it } from "vitest";

import { MANIFEST_NAME, buildManifest, sha256 } from "./app-manifest.mjs";

const meta = { version: "0.3.3", gitSha: "abc1234", builtAt: "2026-09-05T00:00:00.000Z", base: "/app/", contractSchemaVersion: 1 };

describe("buildManifest", () => {
  it("lists every file sorted with byte size and sha256, excluding a stale manifest", () => {
    const m = buildManifest(
      {
        "index.html": Buffer.from("<!doctype html>"),
        "assets/b.js": Buffer.from("b"),
        "assets/a.css": Buffer.from("a"),
        [MANIFEST_NAME]: Buffer.from("{}"),
      },
      meta,
    );
    expect(m.schema).toBe(1);
    expect(m.base).toBe("/app/");
    expect(m.contract_schema_version).toBe(1);
    expect(m.files.map((f) => f.path)).toEqual(["assets/a.css", "assets/b.js", "index.html"]);
    expect(m.files[2]).toEqual({ path: "index.html", bytes: 15, sha256: sha256(Buffer.from("<!doctype html>")) });
  });

  it("is deterministic for the same inputs", () => {
    const entries = { "index.html": Buffer.from("x"), "y.js": Buffer.from("y") };
    expect(JSON.stringify(buildManifest(entries, meta))).toBe(JSON.stringify(buildManifest({ ...entries }, meta)));
  });

  it("refuses an artifact without index.html", () => {
    expect(() => buildManifest({ "main.js": Buffer.from("x") }, meta)).toThrow(/no index.html/);
  });
});
