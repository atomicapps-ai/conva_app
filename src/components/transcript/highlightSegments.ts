/**
 * Pure highlight segmentation for transcript text — the ONE implementation
 * behind both `HighlightedText` (real bubbles) and the dev FANER panel's
 * preview, so the panel shows exactly what a bubble would render.
 *
 * Terms are matched case-insensitively as whole words, **longest first**, with
 * any run of whitespace inside a multi-word term. A longer phrase therefore
 * always wins over a shorter one nested in it at the same position ("API
 * Gateway" over "API"), while a standalone occurrence of the shorter term
 * elsewhere still highlights.
 */

export interface HighlightSegment {
  text: string;
  /** True when this segment is a highlighted term occurrence. */
  hit: boolean;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildHighlightSegments(
  text: string,
  terms: readonly string[],
): HighlightSegment[] {
  const usable = terms.map((t) => t.trim()).filter(Boolean);
  if (usable.length === 0) return [{ text, hit: false }];

  const alts = [...usable]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.split(/\s+/).map(escapeRegExp).join("\\s+"));
  const re = new RegExp(`\\b(${alts.join("|")})\\b`, "gi");

  const out: HighlightSegment[] = [];
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}
