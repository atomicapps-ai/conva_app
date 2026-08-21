import { useEffect, useState } from "react";

import type { DiffWord } from "@/lib/transcriptStability";

const SCRAMBLE_CHARS = "abcdefghijklmnopqrstuvwxyz";
const TICK_MS = 60;
const TICKS = 6; // ~360ms total — brief, doesn't hold up reading

function randomWord(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
  }
  return out;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Renders a word-level diff (`transcriptStability.ts`'s `diffWords`) — the
 * one-time visible correction when a segment's true final text differs
 * from whatever was last shown for it (F13, design doc §4.3). Unchanged
 * words render immediately; each `changed` word briefly cycles randomized
 * same-length characters before settling on the real word, so a whisper
 * correction reads as a visible, intentional fix rather than a silent snap.
 * Caller keys this component by the segment's own key — that's what makes
 * "plays once" free: React only mounts a fresh instance (and runs its mount
 * effect) the first time a given segment appears here.
 */
export function ScrambleText({ words }: { words: DiffWord[] }) {
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 && " "}
          {w.changed ? <ScrambleWord word={w.text} /> : w.text}
        </span>
      ))}
    </>
  );
}

function ScrambleWord({ word }: { word: string }) {
  const [display, setDisplay] = useState(() =>
    prefersReducedMotion() ? word : randomWord(word.length),
  );

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(word);
      return;
    }
    let tick = 0;
    const id = window.setInterval(() => {
      tick += 1;
      if (tick >= TICKS) {
        setDisplay(word);
        window.clearInterval(id);
      } else {
        setDisplay(randomWord(word.length));
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
    // Mount-once: this component is keyed by its caller to one specific
    // finalized segment, and `word` is fixed for its whole lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <span>{display}</span>;
}
