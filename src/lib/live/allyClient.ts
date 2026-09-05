/**
 * Ally over the hosted live session — the browser side of `POST /api/live/ally`
 * (M2 checkpoint 3; spec `conva_core/docs/platform/live-gateway-protocol.md`).
 *
 * Sends the bounded evidence (finals + the latest partial per voice, capped),
 * reads the NDJSON answer stream and hands each line to the caller in order:
 * `sources` first, `chunk`s, then exactly one `done` or `error`. HTTP refusals
 * become {@link LiveSessionError}s with the server's stable code
 * (`signed_out` / `not_entitled` / `unconfigured` / `duplicate_request` / …) so
 * the UI can say why — never a silent no-op. Pure apart from injected fetch.
 */
import type { TranscriptSegment } from "@/lib/ipc";
import { LiveSessionError } from "./liveClient";
import { parseAllyLine, type AllyEvidenceSegment, type AllyRequestBody, type AllyRequestKind, type AllyStreamLine } from "./protocol";

/** Upper bound on segments sent as evidence; the server budgets characters on top. */
export const MAX_EVIDENCE_SEGMENTS = 800;

export interface AllyClientDeps {
  fetch: typeof fetch;
  base?: string;
}

/**
 * Evidence = every final in order (newest {@link MAX_EVIDENCE_SEGMENTS} kept)
 * plus the latest partial per side so a mid-sentence question still has the
 * freshest words. Only the fields the server reads travel.
 */
export function evidenceFrom(segments: readonly TranscriptSegment[]): AllyEvidenceSegment[] {
  const finals: AllyEvidenceSegment[] = [];
  const latestPartial = new Map<string, AllyEvidenceSegment>();
  for (const s of segments) {
    if (!s.text.trim()) continue;
    const slim: AllyEvidenceSegment = { side: s.side, text: s.text, is_final: s.is_final, start_ms: s.start_ms, end_ms: s.end_ms };
    if (s.is_final) finals.push(slim);
    else latestPartial.set(s.side, slim);
  }
  const kept = finals.length > MAX_EVIDENCE_SEGMENTS ? finals.slice(finals.length - MAX_EVIDENCE_SEGMENTS) : finals;
  return [...kept, ...latestPartial.values()];
}

/**
 * Run one Ally request; resolves when the stream has ended (after the terminal
 * line was delivered). Rejects with a coded {@link LiveSessionError} when the
 * request is refused before any line — the caller then marks the card failed.
 */
export async function runAlly(
  deps: AllyClientDeps,
  body: { request_id: string; kind: AllyRequestKind; question: string | null; segments: readonly TranscriptSegment[] },
  onLine: (line: AllyStreamLine) => void,
  signal?: AbortSignal,
): Promise<void> {
  const base = deps.base ?? "/api/live";
  const payload: AllyRequestBody = { request_id: body.request_id, kind: body.kind, question: body.question, segments: evidenceFrom(body.segments) };
  let res: Response;
  try {
    res = await deps.fetch(`${base}/ally`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (e) {
    throw new LiveSessionError("network", `Ally request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    let reason: string | undefined;
    try {
      const j = (await res.json()) as { error?: unknown; reason?: unknown };
      if (typeof j.error === "string") code = j.error;
      if (typeof j.reason === "string") reason = j.reason;
    } catch {
      /* non-JSON error body */
    }
    throw new LiveSessionError(code, reason ?? describe(code, res.status));
  }
  if (!res.body) throw new LiveSessionError("empty_response", "Ally answered without a body.");

  let terminal = false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const feed = (text: string) => {
    buf += text;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const raw = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!raw) continue;
      const line = parseAllyLine(raw);
      if (!line || line.request_id !== body.request_id) continue;
      if (line.type === "done" || line.type === "error") terminal = true;
      onLine(line);
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
    }
    feed(decoder.decode());
    if (buf.trim()) feed("\n");
  } catch (e) {
    if (!terminal) {
      terminal = true;
      onLine({ type: "error", request_id: body.request_id, code: signal?.aborted ? "cancelled" : "stream_interrupted", message: `The answer stream was interrupted: ${e instanceof Error ? e.message : String(e)}` });
    }
    return;
  }
  if (!terminal) {
    onLine({ type: "error", request_id: body.request_id, code: "stream_truncated", message: "The answer stream ended without a final line." });
  }
}

function describe(code: string, status: number): string {
  switch (code) {
    case "signed_out":
      return "Sign in to ask Ally.";
    case "not_entitled":
      return "This account is not on the beta allowlist.";
    case "unconfigured":
      return "Ally is not configured on this deployment.";
    case "duplicate_request":
      return "This request was already answered.";
    case "cross_origin":
      return "The request was refused as cross-origin.";
    default:
      return `Ally answered ${status}.`;
  }
}
