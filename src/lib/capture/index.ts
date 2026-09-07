/**
 * `@/lib/capture` — the pure, framework-free half of the browser product
 * contract (M0): versioned types + legacy mapping (`contract`), ordering /
 * de-duplication (`ledger`), transcript revisions (`transcriptState`),
 * cancellation (`operations`) and the legacy record bridge (`legacy`).
 *
 * No React, no Tauri, no browser APIs — everything here runs in Vitest and
 * in the desktop and web adapters alike. Adapters live in `@/lib/backend`.
 */

export * from "@/lib/capture/contract";
export * from "@/lib/capture/ledger";
export * from "@/lib/capture/legacy";
export * from "@/lib/capture/operations";
export * from "@/lib/capture/transcriptState";
