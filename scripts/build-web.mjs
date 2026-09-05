#!/usr/bin/env node
/* conva — build the WEB artifact: `npm run build:web`.
 *
 *   tsc -b  →  vite build (base /app/) into dist-web/  →  dist-web/app-manifest.json
 *
 * The product is served by conva_web's Worker at same-origin /app/ (no iframe),
 * so the bundle is built with that base. The manifest (scripts/app-manifest.mjs)
 * lets the site build verify the exact bytes it pins. CONVA_WEB_BASE overrides
 * the base for local experiments; CONVA_WEB_OUT the output folder.
 */
import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { MANIFEST_NAME, buildManifest, readTree } from "./app-manifest.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.env.CONVA_WEB_BASE || "/app/";
const outDir = process.env.CONVA_WEB_OUT || "dist-web";

function run(cmd, env) {
  // One command STRING with shell:true so Windows can spawn npx/npm .cmd shims.
  const r = spawnSync(cmd, { cwd: root, stdio: "inherit", shell: true, env });
  if (r.status !== 0) process.exit(r.status || 1);
}

const env = { ...process.env, CONVA_WEB_BASE: base };
run("npx tsc -b", env);
run(`npx vite build --outDir ${outDir} --emptyOutDir`, env);

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const gitSha = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "nogit";
  }
})();
// Mirror of src/lib/capture/contract.ts CONTRACT_SCHEMA_VERSION (read, not
// imported — this script runs in plain Node without the TS toolchain).
const contractSchemaVersion = Number(
  /CONTRACT_SCHEMA_VERSION\s*=\s*(\d+)/.exec(
    readFileSync(join(root, "src/lib/capture/contract.ts"), "utf8"),
  )?.[1] ?? 0,
);

const manifest = buildManifest(await readTree(join(root, outDir)), {
  version,
  gitSha,
  builtAt: new Date().toISOString(),
  base,
  contractSchemaVersion,
});
writeFileSync(join(root, outDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `[build:web] ${outDir}/ → v${manifest.version} · ${manifest.git_sha} · base ${base} · ${manifest.files.length} files · ${MANIFEST_NAME} written`,
);
