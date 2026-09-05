/* conva — artifact manifest for the web build (dist-web/app-manifest.json).
 *
 * Lists every file in the built product with its byte size and sha256 so the
 * site build (conva_web/scripts/import-app.mjs) can PIN and VERIFY exactly this
 * artifact before serving it at /app/ — the cross-repo delivery rule in the
 * browser architecture (§14): the Worker serves a verified artifact and never
 * reads a sibling working tree. Pure functions here; `scripts/build-web.mjs`
 * drives them. Unit-tested in scripts/app-manifest.test.mjs (vitest).
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const MANIFEST_NAME = "app-manifest.json";
export const MANIFEST_SCHEMA = 1;

/** Relative, "/"-separated, sorted list of every file under `dir`. */
export async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(relative(base, p).split(sep).join("/"));
  }
  return out.sort();
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Build the manifest object from `{ path → bytes }` entries plus build
 * identity. Deterministic: same inputs → same output (files sorted by path),
 * so two builds of one commit can be compared byte-for-byte apart from
 * `built_at`.
 */
export function buildManifest(entries, meta) {
  const files = Object.keys(entries)
    .filter((p) => p !== MANIFEST_NAME)
    .sort()
    .map((path) => ({ path, bytes: entries[path].byteLength, sha256: sha256(entries[path]) }));
  if (!files.some((f) => f.path === "index.html")) {
    throw new Error("web artifact has no index.html — refusing to write a manifest for it");
  }
  return {
    schema: MANIFEST_SCHEMA,
    name: "conva-app-web",
    version: meta.version,
    git_sha: meta.gitSha,
    built_at: meta.builtAt,
    base: meta.base,
    contract_schema_version: meta.contractSchemaVersion,
    files,
  };
}

/** Read every file under `dir` into `{ path → Buffer }`. */
export async function readTree(dir) {
  const entries = {};
  for (const p of await walk(dir)) entries[p] = await readFile(join(dir, p));
  return entries;
}
