/**
 * ConvaBackend — the Platform Abstraction Layer entry point.
 *
 * Usage: `import { getBackend } from "@/lib/backend";` then call
 * `getBackend().auth.status()`, `getBackend().session.start()`, etc. Resolve
 * `capabilities()` once at bootstrap and branch the UI on it — never on `isTauri`.
 *
 * Migration note: `@/lib/commands` (the flat Tauri wrappers) and `useIpcBridge`
 * remain in place; components move onto `getBackend()` incrementally. The Tauri
 * adapter delegates to those same wrappers, so behavior is identical during the
 * migration. See `conva_core/docs/technical/CONVA_ARCHITECTURE.md` §5.
 */

import type { ConvaBackend } from "@/lib/backend/ConvaBackend";
import { resolveBackend } from "@/lib/backend/detect";

export type { ConvaBackend } from "@/lib/backend/ConvaBackend";
export type {
  Capabilities,
  GpuBackend,
  IncogState,
  SystemAudioMode,
} from "@/lib/backend/capabilities";
export type { EventMap, Unsubscribe } from "@/lib/backend/events";
export { isTauriRuntime, resolveBackend } from "@/lib/backend/detect";
export { UnsupportedOnWebError } from "@/lib/backend/web";
export {
  BackendProvider,
  useBackend,
  useCapabilities,
} from "@/lib/backend/context";

let singleton: ConvaBackend | null = null;

/** The active backend for this runtime (memoized). */
export function getBackend(): ConvaBackend {
  if (!singleton) singleton = resolveBackend();
  return singleton;
}
