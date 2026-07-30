/**
 * The ONE place platform identity is inspected. Everything downstream branches
 * on {@link Capabilities}, never on this. (Mirrors the existing `isTauri()`
 * check in `@/lib/ipc`, kept isolated here so components never repeat it.)
 */

import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import { TauriBackend } from "@/lib/backend/tauri";
import { WebBackend } from "@/lib/backend/web";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function resolveBackend(): ConvaBackend {
  return isTauriRuntime() ? new TauriBackend() : new WebBackend();
}
