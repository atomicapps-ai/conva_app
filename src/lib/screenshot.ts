/** No-op default so every call site in this file can call `trace(...)`
 *  unconditionally instead of guarding it every time. */
const noopTrace = (_msg: string) => {};

/** html2canvas awaits the cloned document's `fonts.ready` (the Font Loading
 *  API) before it ever calls `onclone` — a step this file doesn't control
 *  and can't skip. If that promise never settles in a given webview, or
 *  html2canvas hangs anywhere else in its own clone/render pipeline, the
 *  capture would otherwise wait forever with zero observable symptom: no
 *  flash, no popover, no error (owner, 2026-08-30, three rounds in: "I
 *  don't see anything happening"). Race it against a timeout instead, so a
 *  hang becomes a loud, traceable failure. */
const CAPTURE_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}

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
 * independent of the button's React state. `trace`, if given, is called at
 * each stage — `StatusBar.tsx` wires it to `backend.diagnostics.trace`,
 * which (on desktop) reaches the terminal, not just webview devtools; see
 * that function's own doc comment for why this file can't just log there
 * directly (`screenshot.ts` stays backend-agnostic, no `ConvaBackend`
 * import).
 */
export async function captureScreenshot(trace: (msg: string) => void = noopTrace): Promise<Blob> {
  trace("captureScreenshot:start");
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root element to capture");
  trace("html2canvas:import:start");
  const { default: html2canvas } = await import("html2canvas");
  trace("html2canvas:import:done");
  trace("html2canvas:render:start");
  const canvas = await withTimeout(
    html2canvas(root, {
      onclone: (clonedDoc: Document, clonedRoot: HTMLElement) => {
        trace("onclone:start");
        try {
          fixPlaceholderPseudoElement(clonedDoc);
          normalizeClonedColors(clonedDoc, clonedRoot, trace);
        } catch (e) {
          // Never let a bug in the color-fixup itself break html2canvas's
          // clone/render pipeline — worst case this capture reverts to the
          // pre-fix "unsupported color function" failure, not a new,
          // harder-to-diagnose one.
          trace(`onclone:normalizeClonedColors threw: ${String(e)}`);
        }
        trace("onclone:done");
      },
    }),
    CAPTURE_TIMEOUT_MS,
    `html2canvas didn't finish within ${CAPTURE_TIMEOUT_MS / 1000}s — it likely hung inside its own render pipeline (e.g. waiting on the cloned document's font loading), not this app's code`,
  );
  trace("html2canvas:render:done");
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  trace("toBlob:done");
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
 *
 * v1.6 (owner, 2026-08-30, sixth round — after `::before`/`::after` and a
 * verify pass that traced "0 element properties, 0 ::before/::after
 * properties" / "verify:clean" fixed, yet the capture STILL failed with the
 * exact same `"color"` function): the fix pass had been checking a
 * hand-picked list of "the color properties" (`COLOR_PROPERTIES`, below,
 * now removed) — a list that grew once per round (`::placeholder`, then
 * `::before`/`::after`) because it was always missing exactly one more
 * property nobody had thought of yet. Grepping the compiled CSS bundle
 * turned up the likely next one uncaught by that list:
 * `accent-color:var(--color-primary,#4fb8ff)` on checkboxes/radios — a real
 * color property, never in `COLOR_PROPERTIES`. Rather than add it and wait
 * for round seven to find the next omission (`scrollbar-color` was sitting
 * right next to it, equally unchecked), this switches from a curated list
 * to a brute-force scan: `getComputedStyle()`'s return value is iterable by
 * index (`cs.length` / `cs.item(i)`), so walking every index it reports —
 * not a hand-picked subset — checks literally every property the browser
 * computed for that element, guaranteeing nothing color-shaped can be
 * missed again regardless of which CSS property carries it. Checking a
 * non-color property (e.g. `display: block`) costs nothing: the suspect-
 * function regex just never matches it, so it's never touched.
 */

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

/** Every property `cs` (a `getComputedStyle` result) reports whose value
 *  contains a suspect color function — walked by index, not a curated
 *  property-name list (see the v1.6 note above for why). Custom properties
 *  (`--*`) are skipped: html2canvas never reads them directly, only the
 *  resolved longhand values they feed via `var()` — which this same scan
 *  already catches on whatever real property consumes them — so fixing the
 *  custom property itself would just be wasted work on every element that
 *  inherits it. */
function suspectProperties(cs: CSSStyleDeclaration): Array<{ name: string; value: string }> {
  const found: Array<{ name: string; value: string }> = [];
  for (let i = 0; i < cs.length; i++) {
    const name = cs.item(i);
    if (!name || name.startsWith("--")) continue;
    const value = cs.getPropertyValue(name);
    if (!value || !HAS_SUSPECT_COLOR_FN.test(value)) continue;
    found.push({ name, value });
  }
  return found;
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

/**
 * `::placeholder` is a pseudo-element — it has no real DOM node, so
 * `normalizeClonedColors`'s `querySelectorAll("*")` walk (real elements
 * only) can never see or fix it, no matter how thorough the property list.
 * Confirmed via the PR #149 terminal trace: capture got all the way through
 * `onclone:done` (so the element walk ran clean) and still failed with the
 * same "unsupported color function" during html2canvas's OWN subsequent
 * render pass, which — unlike this file — does read placeholder text
 * styling for empty inputs. Tailwind's PREFLIGHT sets
 * `::placeholder { color: color-mix(in oklab, currentcolor 50%,
 * transparent); }` UNCONDITIONALLY on every `<input>`/`<textarea>`,
 * regardless of any class used — confirmed in the compiled CSS bundle,
 * where it's the only other pseudo-element rule (besides `::selection`,
 * already `in srgb` from `globals.css`'s own fix) using a suspect function.
 *
 * No per-element JS API can set a pseudo-element's style directly, so this
 * overrides it the one way that works: inject a `<style>` rule into the
 * cloned document. `color: inherit; opacity: .5` reproduces the exact same
 * "half-transparent current text color" look `color-mix(in oklab,
 * currentcolor 50%, transparent)` was going for, using only a keyword and
 * an opacity value — nothing color-mix, oklab, or any other function
 * html2canvas can choke on.
 */
export function fixPlaceholderPseudoElement(doc: Document) {
  const style = doc.createElement("style");
  style.textContent = "::placeholder { color: inherit !important; opacity: .5 !important; }";
  (doc.head ?? doc.documentElement).appendChild(style);
}

/** Every element this walk touches: `root` (the app's `#root` mount) and
 *  its descendants, PLUS `<html>`/`<body>` — html2canvas reads THEIR
 *  `backgroundColor` directly (`getComputedStyle(ownerDocument.body)...`,
 *  its own source) to fill the canvas background, entirely outside any
 *  walk scoped to `#root`. Neither carries a suspect value in this
 *  codebase today (`globals.css`'s `html, body { background: var(...) }`
 *  is a plain hex custom property, no color-mix), but it's a real gap in
 *  what this walk covers, cheap to close, and exactly the kind of thing
 *  that turns into a fifth round of "still broken" if left for later. */
function elementsToCheck(doc: Document, root: HTMLElement): Element[] {
  const extra = [doc.documentElement, doc.body].filter(
    (el): el is HTMLElement => el != null && el !== root && !root.contains(el),
  );
  return [...extra, root, ...root.querySelectorAll("*")];
}

/** Real elements only — html2canvas's own `resolvePseudoContent` calls
 *  `window.getComputedStyle(node, ':before')` / `':after'` for EVERY node
 *  it processes (confirmed by reading its source directly), feeding the
 *  exact same color parser as everything else. `::placeholder`'s v1.4 fix
 *  and `<html>`/`<body>`'s v1.5 one both turned out to be red herrings —
 *  the v1.5 verification pass proved every REAL-ELEMENT property this file
 *  checks was already clean, yet the capture still failed identically, so
 *  the remaining gap had to be something read outside that walk entirely.
 *  `::before`/`::after` were the one remaining color source confirmed (by
 *  reading html2canvas's own source, not guessed) to be read for every
 *  element and never checked here. */
const PSEUDO_ELEMENTS = [":before", ":after"] as const;

/** No JS API sets a pseudo-element's style directly — the only way to
 *  override one is a stylesheet rule. Elements that need a fix get a
 *  throwaway `data-scr-fix` id so a rule can target them individually;
 *  every fix collected across the walk goes into ONE injected `<style>`
 *  block (cheaper than one `<style>` per element, and keeps the applied
 *  rules easy to read back out of the DOM while debugging). */
let pseudoFixCounter = 0;

function normalizePseudoElementColors(view: Window & typeof globalThis, elements: Element[]): number {
  const rules: string[] = [];
  for (const el of elements) {
    if (!(el instanceof view.HTMLElement)) continue; // pseudo-content is an HTML-element-only concept
    for (const pseudo of PSEUDO_ELEMENTS) {
      const cs = view.getComputedStyle(el, pseudo);
      if (cs.getPropertyValue("content") === "none") continue; // no generated content, nothing to render
      let elementRules = "";
      for (const { name, value } of suspectProperties(cs)) {
        const fixed = replaceSuspectColorFunctions(value, normalizeColor);
        elementRules += `${name}: ${fixed} !important; `;
      }
      if (!elementRules) continue;
      const id = `scr-fix-${pseudoFixCounter++}`;
      el.setAttribute("data-" + id, "");
      rules.push(`[data-${id}]${pseudo === ":before" ? "::before" : "::after"} { ${elementRules} }`);
    }
  }
  if (rules.length > 0) {
    const style = view.document.createElement("style");
    style.textContent = rules.join("\n");
    (view.document.head ?? view.document.documentElement).appendChild(style);
  }
  return rules.length;
}

/** Walks every element `elementsToCheck` returns and rewrites any
 *  color-bearing computed value that contains a function html2canvas can't
 *  parse into an inline-style override using its normalized equivalent —
 *  then does the same for `::before`/`::after` on every real element via
 *  a scoped stylesheet injection (see `normalizePseudoElementColors`).
 *  Then, so a failure is never a mystery again (owner, 2026-08-30: "you
 *  need better intelligence to verify assumptions through trace data...
 *  so you can see just at what point it fails"), RE-CHECKS every one of
 *  those same values — real elements AND their `::before`/`::after` —
 *  and traces the exact tag/selector/property/raw-value of anything
 *  STILL suspect, meaning this fixup didn't actually catch it, not just
 *  that html2canvas failed somewhere unspecified. */
function normalizeClonedColors(doc: Document, root: HTMLElement, trace: (msg: string) => void) {
  const view = doc.defaultView;
  if (!view) return;
  const elements = elementsToCheck(doc, root);
  let fixedCount = 0;
  for (const el of elements) {
    if (!(el instanceof view.HTMLElement) && !(el instanceof view.SVGElement)) continue;
    const cs = view.getComputedStyle(el);
    for (const { name, value } of suspectProperties(cs)) {
      const fixed = replaceSuspectColorFunctions(value, normalizeColor);
      el.style.setProperty(name, fixed, "important");
      fixedCount++;
    }
  }
  const pseudoFixedCount = normalizePseudoElementColors(view, elements);
  trace(
    `onclone:normalizeClonedColors fixed ${fixedCount} element propert${fixedCount === 1 ? "y" : "ies"}, ${pseudoFixedCount} ::before/::after propert${pseudoFixedCount === 1 ? "y" : "ies"}`,
  );

  let stillSuspect = 0;
  for (const el of elements) {
    if (!(el instanceof view.HTMLElement) && !(el instanceof view.SVGElement)) continue;
    const cs = view.getComputedStyle(el);
    for (const { name, value } of suspectProperties(cs)) {
      stillSuspect++;
      trace(`onclone:VERIFY still suspect: ${describeElement(el)} ${name}="${value}"`);
    }
    if (!(el instanceof view.HTMLElement)) continue;
    for (const pseudo of PSEUDO_ELEMENTS) {
      const cs2 = view.getComputedStyle(el, pseudo);
      if (cs2.getPropertyValue("content") === "none") continue;
      for (const { name, value } of suspectProperties(cs2)) {
        stillSuspect++;
        trace(`onclone:VERIFY still suspect: ${describeElement(el)}${pseudo} ${name}="${value}"`);
      }
    }
  }
  trace(
    stillSuspect === 0
      ? "onclone:verify:clean — every walked element/property is now html2canvas-safe"
      : `onclone:verify:FAILED — ${stillSuspect} propert${stillSuspect === 1 ? "y" : "ies"} still suspect after fixup, listed above`,
  );
}

/** Tag + id + first couple classes — enough to find the actual element in
 *  the live app from a trace line, without dumping its whole className. */
export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const classes = Array.from(el.classList).slice(0, 3).join(".");
  return `<${tag}${id}${classes ? `.${classes}` : ""}>`;
}
