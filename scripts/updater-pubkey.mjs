#!/usr/bin/env node
/* Set plugins.updater.pubkey in src-tauri/tauri.conf.json.
 *
 *   node scripts/updater-pubkey.mjs <base64-public-key>
 *
 * A surgical text patch of the one `"pubkey": "…"` line — NOT a
 * JSON.stringify round-trip, which would reflow unrelated parts of the file
 * (the same reason scripts/version.mjs patches text; see its comments). The
 * result is re-parsed and asserted so a bad edit fails here, not in a
 * 16-minute installer build. Used by .github/workflows/env-reencrypt.yml
 * when it rotates the updater signing keypair.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolved from the repo root (the CLI is run from there, as every other
// scripts/*.mjs is) — not from import.meta.url, which is not a file: URL
// under vitest's transform.
const CONF = resolve(process.cwd(), "src-tauri/tauri.conf.json");
const LINE = /^(\s*"pubkey":\s*")([^"]*)(",?\s*)$/m;

/** Pure: returns the patched source. Throws if the line is missing or the result does not parse. */
export function setPubkey(source, pubkey) {
  if (!/^[A-Za-z0-9+/=]+$/.test(pubkey)) throw new Error("pubkey must be base64 (the content of the .pub file, base64-encoded)");
  const matches = source.match(new RegExp(LINE.source, "gm")) ?? [];
  if (matches.length !== 1) throw new Error(`expected exactly one "pubkey" line in tauri.conf.json, found ${matches.length}`);
  const out = source.replace(LINE, `$1${pubkey}$3`);
  const parsed = JSON.parse(out);
  if (parsed?.plugins?.updater?.pubkey !== pubkey) throw new Error("post-condition failed: plugins.updater.pubkey does not carry the new value");
  return out;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const pubkey = process.argv[2];
  if (!pubkey) {
    console.error("Usage: node scripts/updater-pubkey.mjs <base64-public-key>");
    process.exit(2);
  }
  writeFileSync(CONF, setPubkey(readFileSync(CONF, "utf8"), pubkey));
  console.log(`✓ src-tauri/tauri.conf.json plugins.updater.pubkey set (${pubkey.slice(0, 12)}…)`);
}
