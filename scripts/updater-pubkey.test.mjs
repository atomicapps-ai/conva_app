import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { setPubkey } from "./updater-pubkey.mjs";

const REAL = readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8");
const NEW = "dW50cnVzdGVkIGNvbW1lbnQ6IHRlc3QKUldRdGVzdAo=";

describe("updater-pubkey", () => {
  it("replaces only the pubkey line of the real tauri.conf.json and keeps the file byte-identical otherwise", () => {
    const out = setPubkey(REAL, NEW);
    expect(JSON.parse(out).plugins.updater.pubkey).toBe(NEW);
    const diff = out.split("\n").filter((l, i) => l !== REAL.split("\n")[i]);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toContain('"pubkey"');
  });

  it("survives CRLF line endings (Windows checkouts)", () => {
    const crlf = REAL.replace(/\n/g, "\r\n");
    const out = setPubkey(crlf, NEW);
    expect(JSON.parse(out).plugins.updater.pubkey).toBe(NEW);
    expect(out.includes("\r\n")).toBe(true);
  });

  it("refuses a non-base64 value and a file without exactly one pubkey line", () => {
    expect(() => setPubkey(REAL, "not base64!")).toThrow(/base64/);
    expect(() => setPubkey('{"plugins":{"updater":{}}}', NEW)).toThrow(/exactly one/);
  });
});
