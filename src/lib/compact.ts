/**
 * Compact mode (design §4.3 U9): a narrow always-on-top strip that sits
 * beside a full-screen call window. Window sizing is remembered and
 * restored when toggled off.
 */

import { isTauri } from "@/lib/ipc";

const COMPACT_WIDTH = 380;
const COMPACT_MIN_HEIGHT = 440;

/**
 * The full shell's floor — AppUI V5.0 §10/§12, FIXED: "New-window 1280×800;
 * min shell 700×600." Kept in lockstep with `tauri.conf.json`'s
 * `minWidth`/`minHeight`; the compact strip is deliberately NOT the full
 * shell, so it lowers the floor while it's on and puts it back on the way out
 * (without the swap, the 380px strip would be clamped to 700 and Compact mode
 * would silently stop working).
 */
export const SHELL_MIN_WIDTH = 700;
export const SHELL_MIN_HEIGHT = 600;

let savedSize: { width: number; height: number } | null = null;

export async function applyCompact(on: boolean): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow, LogicalSize } = await import(
    "@tauri-apps/api/window"
  );
  const win = getCurrentWindow();

  if (on) {
    const inner = await win.innerSize();
    const factor = await win.scaleFactor();
    savedSize = {
      width: inner.width / factor,
      height: inner.height / factor,
    };
    await win.setAlwaysOnTop(true);
    await win.setMinSize(new LogicalSize(COMPACT_WIDTH, COMPACT_MIN_HEIGHT));
    await win.setSize(new LogicalSize(COMPACT_WIDTH, savedSize.height));
  } else {
    await win.setAlwaysOnTop(false);
    await win.setMinSize(new LogicalSize(SHELL_MIN_WIDTH, SHELL_MIN_HEIGHT));
    if (savedSize) {
      // Restore exactly what the user had — never "normalize" to the 1280×800
      // default (decision 5: never force-resize a window the user has sized).
      await win.setSize(new LogicalSize(savedSize.width, savedSize.height));
      savedSize = null;
    }
  }
}
