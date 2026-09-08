/* Merge KEY=VALUE lines from one env file into another, in place.
 *
 *   node scripts/env-merge.mjs <target> <source>
 *
 * Every KEY in <source> replaces the first `KEY=` line in <target> at that
 * position; keys <target> does not have yet are appended. Comments, blank
 * lines, other keys and the target's newline style are left alone, so the
 * result is a minimal, reviewable diff of the decrypted file — used by
 * .github/workflows/env-reencrypt.yml to set the public dev-project values
 * (from .env.dev.example) and a freshly generated updater signing key
 * without ever printing the file.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** @returns {Record<string,string>} KEY → VALUE for the KEY=VALUE lines of an env file. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Pure: returns the merged text. */
export function mergeEnv(targetText, sourceText) {
  const updates = parseEnv(sourceText);
  const nl = targetText.includes("\r\n") ? "\r\n" : "\n";
  const lines = targetText.split(/\r?\n/);
  const seen = new Set();
  const merged = lines.map((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return raw;
    const eq = line.indexOf("=");
    if (eq === -1) return raw;
    const key = line.slice(0, eq).trim();
    if (!(key in updates) || seen.has(key)) return raw;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });
  // Drop a single trailing empty element (a file ending in a newline) so the
  // appended keys land before the final newline, not after a blank line.
  const endsWithNewline = merged.length > 1 && merged[merged.length - 1] === "";
  if (endsWithNewline) merged.pop();
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) merged.push(`${key}=${value}`);
  }
  return merged.join(nl) + nl;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const [target, source] = process.argv.slice(2);
  if (!target || !source) {
    console.error("Usage: node scripts/env-merge.mjs <target-env-file> <source-env-file>");
    process.exit(2);
  }
  const before = readFileSync(target, "utf8");
  const after = mergeEnv(before, readFileSync(source, "utf8"));
  writeFileSync(target, after);
  const keys = Object.keys(parseEnv(readFileSync(source, "utf8")));
  // Key NAMES only — never the values.
  console.log(`✓ ${target}: set ${keys.length} key(s) from ${source}: ${keys.join(", ")}`);
}
