/**
 * Why a model stream ended — mirror of `conva_core::stop_reason::StopReason`
 * (answer-integrity checks C1/C2/C9). Hand-kept in lockstep with the Rust enum
 * and its `snake_case` serde names.
 */
export type StopReason =
  | "complete"
  | "truncated"
  | "refused"
  | "other"
  | "unknown";

/** Map a hosted-protocol `stop_reason` (the Anthropic Messages API's raw
 *  value, passed through by the live Worker) to a [`StopReason`]. Mirrors
 *  `StopReason::from_anthropic`; `null` (the Worker sent none) is `unknown`. */
export function stopReasonFromHosted(raw: string | null): StopReason {
  if (raw === null) return "unknown";
  switch (raw) {
    case "end_turn":
    case "stop_sequence":
    case "tool_use":
      return "complete";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "truncated";
    case "refusal":
      return "refused";
    default:
      return "other";
  }
}

/** Shown at the end of an answer that hit its length limit. A plain markdown
 *  line so every surface that renders the answer text (the card, the View
 *  window, the web fallback) shows it without a special case. */
export const CUT_OFF_NOTE =
  "_Cut off: this answer hit its length limit. Ask again, or narrow the question._";

/** Card error when the model returned nothing at all. */
export const NO_ANSWER_ERROR =
  "Ally returned no answer. Ask again, or rephrase the question.";

/** Card error when the provider declined or filtered the reply. */
export const REFUSED_ERROR =
  "The model declined to answer that. Ask again, or rephrase the question.";

/**
 * Settle a finished answer card from why the stream stopped (check C9/C2).
 * `error` is the card's existing error (already friendly); a stream-level error
 * always wins. Otherwise: a refusal or an empty answer becomes a plain message
 * instead of a blank card, and a truncated answer gets [`CUT_OFF_NOTE`].
 */
export function settleFinishedAnswer(
  text: string,
  error: string | null,
  stop: StopReason | null | undefined,
): { text: string; error: string | null } {
  if (error != null) return { text, error };
  if (stop === "refused") return { text, error: REFUSED_ERROR };
  if (text.trim() === "") return { text, error: NO_ANSWER_ERROR };
  if (stop === "truncated") return { text: `${text.trimEnd()}\n\n${CUT_OFF_NOTE}`, error };
  return { text, error };
}
