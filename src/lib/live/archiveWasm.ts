/**
 * `.cva` archive support for the browser (Checkpoint E, part 1: inspect
 * only — see `conva_core/docs/technical/cva-import-export-implementation-
 * handoff.md`). Loads the `conva-core-wasm` module (built by `npm run
 * build:wasm` into `public/wasm/conva-core-wasm/` — see that script's doc
 * comment for why it's a runtime-fetched public asset rather than a
 * bundled `src/` import) and runs the exact same Rust `.cva` validator
 * desktop uses, client-side, on bytes the browser already has in memory.
 * No hosted endpoint involved — see `web.ts`'s `archive.inspectArchive`.
 */
import type { ArchiveInspection } from "@/lib/ipc";

/** Shape of the wasm-bindgen "web" target's generated ESM module — only the
 *  parts this file actually calls. */
interface ArchiveWasmModule {
  default: (module_or_path?: unknown) => Promise<unknown>;
  inspectArchiveBytes: (bytes: Uint8Array) => unknown;
}

let modulePromise: Promise<ArchiveWasmModule> | null = null;

/** Lazily load + initialize the wasm module exactly once; a failed attempt
 *  (missing build, unsupported browser, network) is not cached, so the next
 *  call can retry rather than staying permanently broken for the session. */
function loadArchiveWasm(): Promise<ArchiveWasmModule> {
  if (!modulePromise) {
    // A runtime-computed URL, not a literal import specifier: `tsc` types
    // this as an untyped dynamic import (no file-resolution attempted) and
    // Vite's bundler never tries to statically resolve/bundle it either —
    // both matter because desktop's plain `npm run build` type-checks and
    // bundles this exact file too (`detect.ts` statically imports
    // `WebBackend` alongside `TauriBackend`) without ever having built this
    // wasm module. See scripts/build-wasm.mjs's doc comment.
    const url = `${import.meta.env.BASE_URL}wasm/conva-core-wasm/conva_core_wasm.js`;
    modulePromise = import(/* @vite-ignore */ url)
      .then(async (mod: ArchiveWasmModule) => {
        await mod.default();
        return mod;
      })
      .catch((e: unknown) => {
        modulePromise = null;
        throw new Error(
          `.cva archive support failed to load (run "npm run build:wasm" before the web build?): ${e instanceof Error ? e.message : String(e)}`,
        );
      });
  }
  return modulePromise;
}

/** Real content digest, lowercase hex — matches what the desktop adapter
 *  computes server-side (SHA-256 of the whole archive file). Used as the
 *  {@link registerLocalArchiveFile} cache key, independent of the wasm
 *  module (native browser `crypto.subtle`). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Cast: `crypto.subtle.digest`'s DOM types want a `Uint8Array<ArrayBuffer>`
  // specifically; a plain `Uint8Array` (whose backing store TS can't prove
  // isn't a `SharedArrayBuffer`) doesn't structurally match, though every
  // real caller here passes an ordinary heap-allocated array.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Bytes the user picked for import/inspection, keyed by content digest —
 *  the in-memory stand-in for desktop's "a file path the OS already granted
 *  access to". Small and short-lived: entries exist only for files actually
 *  selected in the current tab session, never persisted. */
const localArchives = new Map<string, Uint8Array>();

/** Register a locally-selected `.cva` file's bytes and return the digest to
 *  pass as `archiveDigest` to {@link inspectLocalArchive}/`ConvaBackend`'s
 *  `archive.inspectArchive` — the web adapter's answer to "desktop picks its
 *  own destination/source" (spec §9's implementation note): getting bytes
 *  out of a browser `File` is adapter-specific, so it lives here rather than
 *  in the shared `ConvaBackend` contract. */
export async function registerLocalArchiveFile(bytes: Uint8Array): Promise<string> {
  const digest = await sha256Hex(bytes);
  localArchives.set(digest, bytes);
  return digest;
}

/** Side-effect-free preview of a previously {@link registerLocalArchiveFile}d
 *  archive — the web half of `web.ts`'s `archive.inspectArchive`. Never
 *  uploads anything: validation runs entirely in the wasm module on bytes
 *  already in this tab's memory. */
export async function inspectLocalArchive(archiveDigest: string): Promise<ArchiveInspection> {
  const bytes = localArchives.get(archiveDigest);
  if (!bytes) {
    throw new Error("No locally-selected .cva file matches this digest — select the file again.");
  }
  const wasm = await loadArchiveWasm();
  try {
    return wasm.inspectArchiveBytes(bytes) as ArchiveInspection;
  } catch (e) {
    // The wasm binding rejects with a plain string (see conva-core-wasm's
    // `JsValue::from_str`), not an `Error` — normalize it.
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
  }
}
