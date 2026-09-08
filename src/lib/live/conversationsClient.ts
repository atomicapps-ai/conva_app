/**
 * Cloud Conversations for the web build — the browser side of
 * `/api/live/conversations` (M2 checkpoint 8; spec
 * `conva_core/docs/platform/live-gateway-protocol.md` "Cloud Conversations").
 * A hosted session is ephemeral; the ONLY transcript that persists is the one
 * the user saves explicitly, and the Worker writes it to Supabase AS THE USER
 * (RLS). Save mirrors the desktop command's inputs (id, title, segments, linked
 * docs, active Context); the Worker keeps finals only, derives a title when
 * none is given and replaces the stored transcript on a re-save. Delete purges.
 * Refusals become coded {@link LiveSessionError}s (`unprovisioned` until
 * migration 0006 is applied, `signed_out`, `not_found`, `too_large`…).
 */
import type { ClaimSnapshotEvent, Conversation, ConversationSummary, TranscriptSegment } from "@/lib/ipc";
import { badResponse, callStore, type StoreClientDeps } from "./storeClient";

export type ConversationsClientDeps = StoreClientDeps;

const NOUN = "Conversation";

export interface SaveConversationInput {
  id: string | null;
  title: string | null;
  segments: readonly TranscriptSegment[];
  linked_docs: readonly string[];
  context_id?: string | null;
  source_session_ids?: readonly string[];
  claim_snapshots?: readonly ClaimSnapshotEvent[];
}

export function listConversations(deps: ConversationsClientDeps): Promise<ConversationSummary[]> {
  return callStore(deps, NOUN, "/conversations", { method: "GET" }, (b) => (Array.isArray(b.conversations) ? (b.conversations as ConversationSummary[]) : []));
}

export function loadConversation(deps: ConversationsClientDeps, id: string): Promise<Conversation> {
  return callStore(deps, NOUN, `/conversations/${encodeURIComponent(id)}`, { method: "GET" }, (b) => {
    if (!b.conversation || typeof b.conversation !== "object") throw badResponse(NOUN);
    return b.conversation as Conversation;
  });
}

export function saveConversation(deps: ConversationsClientDeps, input: SaveConversationInput): Promise<Conversation> {
  const body: Record<string, unknown> = { id: input.id, title: input.title, segments: input.segments, linked_docs: input.linked_docs };
  if (input.context_id) body.context_id = input.context_id;
  if (input.source_session_ids) body.source_session_ids = input.source_session_ids;
  if (input.claim_snapshots) body.claim_snapshots = input.claim_snapshots;
  return callStore(deps, NOUN, "/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, (b) => {
    if (!b.conversation || typeof b.conversation !== "object") throw badResponse(NOUN);
    return b.conversation as Conversation;
  });
}

export function deleteConversation(deps: ConversationsClientDeps, id: string): Promise<void> {
  return callStore(deps, NOUN, `/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }, () => undefined);
}
