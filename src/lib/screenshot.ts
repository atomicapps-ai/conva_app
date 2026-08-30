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
  const canvas = await html2canvas(root, {
    onclone: (_clonedDoc: Document, clonedRoot: HTMLElement) => normalizeClonedColors(clonedRoot),
  });
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

// ------------------------------------------------------------ color fixup

/**
 * Why this exists (owner reports, 2026-08-30 — two separate captures, two
 * separate function names): "Attempting to parse an unsupported color
 * function 'oklab'", then after that fix, "... 'color'". Root cause:
 * `getComputedStyle` on any element styled via Tailwind v4's alpha-modifier
 * utilities (`bg-primary/50`, `border-rec/30`, ...) or its oklch-defined
 * default palette serializes the color using the SAME modern CSS Color 4
 * function it was written in — `oklab(...)`, `oklch(...)`, `color(...)` —
 * and html2canvas's own color parser only understands rgb/rgba/hsl/hsla/hex.
 * It throws on the very first element with one, aborting the whole capture.
 *
 * This is NOT a small, fixable-at-the-source problem: `globals.css`'s own
 * 17 hand-written `color-mix()` calls were switched to `in srgb` (real,
 * verified fix), but Tailwind's OWN alpha-modifier utilities compile to
 * `color-mix(in oklab, ...)` via a template hardcoded in its engine with no
 * config override — confirmed against the installed `tailwindcss` source.
 * A Vite build-pipeline transform was tried and abandoned: instrumented
 * logging proved it never actually saw Tailwind's generated CSS content
 * (the module's `code` arrived empty on the one call observed, through
 * whatever internal channel Tailwind's Vite plugin actually uses to emit
 * the final CSS) — so ~90 auto-generated occurrences went on unconverted
 * despite the transform looking like it should catch them. Chasing that
 * further wasn't a reliable fix; this file is.
 *
 * The fix instead runs at capture time, once, on html2canvas's own cloned
 * document (the `onclone` hook — called after the clone's stylesheets are
 * attached, so `getComputedStyle` on it reflects real, current styling):
 * walk every element, and for any color-bearing computed value that
 * contains a suspect function, round-trip it through a throwaway <canvas>
 * 2D context. `fillStyle`'s SETTER accepts any valid CSS <color> —
 * oklab/oklch/color-mix/color() included — but its GETTER always
 * serializes back out as `rgb()`/`rgba()`/hex, the standard browser trick
 * for "any CSS color in, a parseable one out." The result is written back
 * as an inline style on the clone (which wins the cascade), so html2canvas
 * only ever sees colors it can read. This catches every source uniformly —
 * Tailwind's utilities, the app's own tokens, and anything added later —
 * with no per-declaration chasing required.
 */

const COLOR_PROPERTIES = [
  "color",
  "backgroundColor",
  "backgroundImage",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "textDecorationColor",
  "caretColor",
  "columnRuleColor",
  "boxShadow",
  "fill",
  "stroke",
] as const;

/** Matches the opening of a CSS color function html2canvas can't parse.
 *  `color-mix` catches Tailwind's alpha-modifier utilities; `oklab`/`oklch`
 *  catch its oklch-defined default palette (used directly, no alpha
 *  modifier); `lab`/`lch`/`color` catch anything else CSS Color 4 offers.
 *  Kept as a source string, not a shared `RegExp`: a global-flag regex's
 *  `lastIndex` is stateful across calls, and this pattern gets used both
 *  as a one-shot `.test()` (needs no `g` flag) and as a scanning loop
 *  (needs its own fresh instance) — sharing one object between those two
 *  use sites is exactly the kind of bug that silently drops matches. */
const SUSPECT_COLOR_FN_SOURCE = String.raw`\b(?:color-mix|oklab|oklch|lab|lch|color)\(`;
/** Non-global — safe to call `.test()` repeatedly with no `lastIndex` state. */
const HAS_SUSPECT_COLOR_FN = new RegExp(SUSPECT_COLOR_FN_SOURCE, "i");

/** Index of `s`'s matching `)` for the `(` at `openParenIndex`, honoring
 *  nesting (a `color-mix(in oklab, oklch(...) 50%, transparent)` has one
 *  suspect function nested inside another). -1 if unbalanced. */
function findMatchingParen(s: string, openParenIndex: number): number {
  let depth = 0;
  for (let i = openParenIndex; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Replaces every top-level suspect-color-function call in `value` with
 * `normalize(thatCall)`'s result, leaving everything else untouched. Pure
 * and DOM-free — the canvas round-trip lives in `normalize`, injected so
 * this parsing logic is unit-testable without a real browser canvas.
 * Exported for that test coverage; `normalizeClonedColors` is the only
 * real caller.
 */
export function replaceSuspectColorFunctions(
  value: string,
  normalize: (colorFunctionCall: string) => string,
): string {
  if (!value) return value;
  const re = new RegExp(SUSPECT_COLOR_FN_SOURCE, "gi");
  let out = "";
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    const start = match.index;
    if (start < lastEnd) continue; // inside an already-replaced span
    const openParenIndex = start + match[0].length - 1;
    const end = findMatchingParen(value, openParenIndex);
    if (end === -1) break; // malformed — leave the rest as-is
    out += value.slice(lastEnd, start) + normalize(value.slice(start, end + 1));
    lastEnd = end + 1;
    re.lastIndex = lastEnd;
  }
  out += value.slice(lastEnd);
  return out;
}

let normalizeCanvasCtx: CanvasRenderingContext2D | null | undefined;
const normalizeCache = new Map<string, string>();

/** Round-trips one color-function call through a canvas 2D context's
 *  `fillStyle` to get back a browser-normalized `rgb()`/`rgba()`/hex
 *  string. Cached per distinct input — the same token+percentage pair
 *  recurs on many elements. Falls back to the original text if the browser
 *  rejects it (silently ignored assignment, per the Canvas spec) rather
 *  than risk corrupting an unrelated color. */
function normalizeColor(colorFunctionCall: string): string {
  const cached = normalizeCache.get(colorFunctionCall);
  if (cached !== undefined) return cached;
  if (normalizeCanvasCtx === undefined) {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    normalizeCanvasCtx = c.getContext("2d");
  }
  const ctx = normalizeCanvasCtx;
  let result = colorFunctionCall;
  if (ctx) {
    const sentinel = "#010203";
    ctx.fillStyle = sentinel;
    ctx.fillStyle = colorFunctionCall;
    const normalized = ctx.fillStyle;
    if (normalized !== sentinel) result = normalized;
  }
  normalizeCache.set(colorFunctionCall, result);
  return result;
}

/** Walks every element under `root` (inclusive) and rewrites any
 *  color-bearing computed value that contains a function html2canvas can't
 *  parse into an inline-style override using its normalized equivalent. */
function normalizeClonedColors(root: HTMLElement) {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  if (!view) return;
  const elements: Element[] = [root, ...root.querySelectorAll("*")];
  for (const el of elements) {
    if (!(el instanceof view.HTMLElement) && !(el instanceof view.SVGElement)) continue;
    const cs = view.getComputedStyle(el);
    for (const prop of COLOR_PROPERTIES) {
      const value = cs.getPropertyValue(kebabCase(prop));
      if (!value || !HAS_SUSPECT_COLOR_FN.test(value)) continue;
      const fixed = replaceSuspectColorFunctions(value, normalizeColor);
      (el.style as unknown as Record<string, string>)[prop] = fixed;
    }
  }
}

function kebabCase(prop: string): string {
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
