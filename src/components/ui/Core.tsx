/**
 * The sonar Core — conva's signature listening instrument.
 *
 * A radar/sonar mark that encodes session state at any size: concentric
 * rings, a rotating sweep + orbiting node while listening, and a breathing
 * iris-gradient center. It doubles as the app's status indicator (top bar,
 * overlay pod, dock) so "is conva hearing this?" is answered by one mark.
 *
 * Pure presentation — drive it from the session state. Animations use the
 * `.core-*` classes in globals.css and are disabled under reduced-motion.
 */

export type CoreState = "idle" | "preparing" | "listening" | "recording";

const CENTER_COLOR: Record<CoreState, string> = {
  idle: "rgba(120,140,180,0.5)",
  preparing: "transparent",
  listening: "url(#coreIris)",
  recording: "url(#coreRec)",
};

const RING_COLOR: Record<CoreState, string> = {
  idle: "rgba(150,190,255,0.14)",
  preparing: "rgba(150,190,255,0.16)",
  listening: "rgba(34,230,214,0.42)",
  recording: "rgba(255,84,104,0.42)",
};

export function Core({
  state,
  size = 22,
  className = "",
}: {
  state: CoreState;
  size?: number;
  className?: string;
}) {
  const listening = state === "listening";
  const recording = state === "recording";
  const preparing = state === "preparing";
  const ring = RING_COLOR[state];
  // Center element breathes when live; the preparing state shows a spinner
  // arc instead of a fill.
  const centerR = size >= 40 ? 9 : 7;

  return (
    <span
      className={`relative inline-block ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`conva ${state}`}
    >
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="coreIris" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22e4f5" />
            <stop offset="0.52" stopColor="#7b5cff" />
            <stop offset="1" stopColor="#ff4fd8" />
          </linearGradient>
          <radialGradient id="coreRec" cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#ff8a97" />
            <stop offset="1" stopColor="#d61e3a" />
          </radialGradient>
          <radialGradient id="coreSweep" cx="0" cy="0" r="1"
            gradientTransform="translate(20 20) rotate(90) scale(18)">
            <stop stopColor="#22e4f5" stopOpacity="0.5" />
            <stop offset="1" stopColor="#22e4f5" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* concentric rings */}
        <circle cx="20" cy="20" r="18" fill="none" stroke={ring} strokeWidth="1" />
        <circle
          cx="20"
          cy="20"
          r="12"
          fill="none"
          stroke={ring}
          strokeWidth="1"
          opacity="0.7"
        />

        {/* radar sweep + orbiting node — only while actively listening */}
        {listening && (
          <>
            <g className="core-sweep">
              <path d="M20 20 L20 2 A18 18 0 0 1 34 12 Z" fill="url(#coreSweep)" />
            </g>
            <g className="core-orbit">
              <circle cx="20" cy="2" r="1.6" fill="#8b6bff" />
            </g>
          </>
        )}

        {/* preparing: a spinning arc instead of a solid core */}
        {preparing ? (
          <g className="core-spin">
            <path
              d="M20 8 A12 12 0 0 1 32 20"
              fill="none"
              stroke="#22e4f5"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>
        ) : (
          <circle
            cx="20"
            cy="20"
            r={centerR}
            fill={CENTER_COLOR[state]}
            className={
              recording
                ? "core-breathe-fast"
                : listening
                  ? "core-breathe"
                  : undefined
            }
            style={{ transformOrigin: "center" }}
          />
        )}
      </svg>
    </span>
  );
}

/** Map the transcript-store session + recording flags to a Core state. */
export function coreStateFrom(
  sessionState: string,
  recording: boolean,
): CoreState {
  if (recording) return "recording";
  if (sessionState === "listening") return "listening";
  if (sessionState === "preparing") return "preparing";
  return "idle";
}
