/**
 * Captures the whole app window (the `#root` mount, i.e. everything the app
 * currently renders) as a PNG `Blob`. Pure DOM/canvas rendering via
 * `html2canvas` — no native OS window-capture code, so it behaves
 * identically on every platform the webview runs on (see the design doc,
 * `docs/superpowers/specs/2026-08-30-screenshot-button-design.md`, for why
 * that beat OS-level `PrintWindow`/`CGWindowListCreateImage`).
 *
 * `html2canvas` (~200KB) is dynamically imported here rather than statically
 * — it's only ever needed after a screenshot-button click, so most sessions
 * never pay for it in the main bundle.
 *
 * Kept out of `StatusBar.tsx` so the capture step is easy to reason about
 * independent of the button's React state.
 */
export async function captureScreenshot(): Promise<Blob> {
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root element to capture");
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(root);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("canvas produced no image data");
  return blob;
}

/** `Blob` -> base64 (no `data:` prefix) — what `backend.screenshot.save`
 *  expects, since the Tauri command receives a plain base64 string. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("failed to read blob"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("unexpected FileReader result type"));
        return;
      }
      // "data:image/png;base64,AAAA..." -> "AAAA..."
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}
