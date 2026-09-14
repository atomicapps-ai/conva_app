import { describe, expect, it } from "vitest";

import { inspectLocalArchive, registerLocalArchiveFile, sha256Hex } from "@/lib/live/archiveWasm";

describe("archiveWasm — sha256Hex", () => {
  it("matches a known SHA-256 vector (empty input)", async () => {
    // echo -n "" | sha256sum
    expect(await sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic and content-derived", async () => {
    const a = new TextEncoder().encode("hello");
    const b = new TextEncoder().encode("hello");
    const c = new TextEncoder().encode("hellp");
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(c));
  });
});

describe("archiveWasm — registerLocalArchiveFile / inspectLocalArchive", () => {
  it("keys registered bytes by their real content digest", async () => {
    const bytes = new TextEncoder().encode("not a real .cva, just registry plumbing");
    const digest = await registerLocalArchiveFile(bytes);
    expect(digest).toBe(await sha256Hex(bytes));
  });

  it("rejects a digest nothing was registered under, before ever touching wasm", async () => {
    // No `npm run build:wasm` output exists in this test environment, so if
    // this reached the wasm loader it would fail with a network/module
    // error, not this message — proves the digest check runs first.
    await expect(inspectLocalArchive("not-a-real-digest")).rejects.toThrow(
      /No locally-selected \.cva file matches this digest/,
    );
  });
});
