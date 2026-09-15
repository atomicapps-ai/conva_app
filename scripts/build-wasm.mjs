#!/usr/bin/env node
/* conva — build the `.cva` archive WASM module for the web build:
 * `npm run build:wasm`.
 *
 * `crates/conva-core-wasm` (a thin wasm-bindgen wrapper around
 * `conva-core`'s pure `.cva` archive logic — see that crate's Cargo.toml
 * doc comment) is compiled with `wasm-pack --target web` into
 * `public/wasm/conva-core-wasm/` — a plain ESM module + `.wasm` asset.
 * Deliberately under `public/`, NOT `src/`: `src/lib/backend/web.ts` loads
 * it via a runtime-computed URL, vite-ignored, not a literal import
 * specifier, so neither `tsc` nor Vite's bundler ever try to resolve it at
 * compile time. That matters because `npm run build`
 * (desktop) type-checks/bundles the exact same `web.ts` — every adapter is
 * always in the graph, per `src/lib/backend/detect.ts` — and desktop never
 * runs this script, so the file wouldn't exist for a literal import to
 * resolve against. `public/*` is copied verbatim into `dist-web/` by `vite
 * build`, unprocessed — exactly what a prebuilt wasm-bindgen "web" target
 * output wants (it fetches its own `.wasm` sibling via `import.meta.url`).
 *
 * Run before `npm run build:web` (wired into `scripts/build-web.mjs`) or
 * standalone during development. Needs `wasm-pack` (`cargo install
 * wasm-pack`, or let `npx wasm-pack` fetch it on first use) and the
 * `wasm32-unknown-unknown` Rust target (`rustup target add
 * wasm32-unknown-unknown`) — this script checks both and fails with a clear
 * message rather than a cryptic one, matching how the rest of this repo's
 * build scripts report a missing toolchain.
 *
 * Desktop (`npm run tauri:gpu` / `npm run build`) never needs this: it
 * talks to `conva-core` directly through Tauri commands, not WASM.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = "public/wasm/conva-core-wasm";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    process.exit(r.status || 1);
  }
}

function toolAvailable(cmd, args) {
  return spawnSync(cmd, args, { cwd: root, stdio: "ignore", shell: true }).status === 0;
}

if (!toolAvailable("rustup", ["target", "list", "--installed"])) {
  console.error("[build:wasm] `rustup` not found — install Rust (https://rustup.rs) first.");
  process.exit(1);
}
const targets = spawnSync("rustup", ["target", "list", "--installed"], { cwd: root, encoding: "utf8" }).stdout;
if (!targets.includes("wasm32-unknown-unknown")) {
  console.error(
    "[build:wasm] the wasm32-unknown-unknown target is not installed.\n" +
      "  Fix: rustup target add wasm32-unknown-unknown",
  );
  process.exit(1);
}

// `npx wasm-pack` fetches a prebuilt binary on first use if it isn't already
// on PATH/`cargo install`ed — no need to pre-check for it separately.
console.log("[build:wasm] wasm-pack build crates/conva-core-wasm --target web …");
run("npx", ["--yes", "wasm-pack", "build", "crates/conva-core-wasm", "--target", "web", "--out-dir", `../../${outDir}`]);

console.log(`[build:wasm] ${outDir}/ written`);
