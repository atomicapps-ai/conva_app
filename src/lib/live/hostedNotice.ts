import type { CaptureSourceKind } from "@/lib/capture/contract";
import type { LiveTerms } from "./protocol";

/**
 * The hosted-processing notice (M2 cp16) — the ONE place its text lives.
 *
 * Architecture §10: before first capture, state which sources are captured,
 * where processing occurs, whether content will be saved, and the user's duty
 * toward participants; repeat when the scope expands (mic → shared call audio).
 * The wording was drafted for owner approval in core
 * `docs/platform/14-provider-retention-and-region.md` §7; every claim in it is
 * either a verified provider term recorded there or a configuration fact the
 * gateway reports in `GET /api/live/status` `terms`. Change the text → bump
 * `HOSTED_NOTICE_ID` (and the Worker's `HOSTED_NOTICE_ID`), so a stale build can
 * never start a session under a notice the deployment no longer stands behind.
 */
export const HOSTED_NOTICE_ID = "hosted-v1";

export interface HostedNoticeCopy {
  title: string;
  paragraphs: string[];
  confirm: string;
}

const PROVIDER_NAMES: Record<string, string> = { deepgram: "Deepgram", anthropic: "Anthropic" };
const REGION_NAMES: Record<string, string> = { us: "United States", eu: "European Union" };
const providerName = (id: string) => PROVIDER_NAMES[id] ?? "Conva's hosted provider";

function transcriptionSentence(terms: LiveTerms | undefined): string {
  const asr = terms?.asr;
  if (!asr) return "While you listen, your audio is streamed to Conva's hosted transcription provider and discarded after processing.";
  const training = asr.mip_opt_out
    ? `Conva tells ${providerName(asr.provider)} not to use your audio for training.`
    : `${providerName(asr.provider)} may use your audio to improve its models.`;
  return `While you listen, your audio is streamed to ${providerName(asr.provider)} (${REGION_NAMES[asr.region] ?? asr.region}) for transcription and discarded after processing. ${training}`;
}

function allySentence(terms: LiveTerms | undefined): string {
  const ally = terms?.ally;
  const lead = "When you ask Ally, the recent transcript, your selected Context and library excerpts go to";
  if (!ally) return `${lead} Conva's hosted model provider to produce the answer.`;
  const where = ally.inference_geo === "us" ? "United States" : "inference may run outside the United States";
  const retention =
    ally.provider === "anthropic"
      ? " Anthropic does not train on it and deletes it within 30 days under its commercial policy."
      : "";
  return `${lead} ${providerName(ally.provider)} (${where}) to produce the answer.${retention}`;
}

/**
 * The copy for one acknowledgement. `scope` = the capture kinds being added by
 * this step; `expanding` = a live session is adding shared call audio.
 */
export function hostedNotice(terms: LiveTerms | undefined, scope: CaptureSourceKind[], expanding = false): HostedNoticeCopy {
  const sharing = scope.includes("display") || scope.includes("tab");
  const sources = expanding
    ? "You are about to add the call audio you share — a tab or screen with “share audio” enabled — to this session. Only that audio is sent; video never is."
    : sharing
      ? "Your microphone and the call audio you share will be transcribed live. Only audio is sent; video never is."
      : "Your microphone will be transcribed live. The other side of the call is included only if you choose “Share call audio” later.";
  return {
    title: expanding ? "Before you share call audio" : "Before you start listening",
    paragraphs: [
      sources,
      `${transcriptionSentence(terms)} ${allySentence(terms)}`,
      "Conva stores nothing from this call unless you save the conversation or upload to your library, and you can delete those at any time. Conva's logs never contain what was said.",
      "You are responsible for telling the other participants and for following the recording rules that apply to you.",
    ],
    confirm: expanding ? "Share call audio" : "Start listening",
  };
}
