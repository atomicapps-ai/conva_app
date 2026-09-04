import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import type { AssignmentStatus, SpeakerKind } from "@/state/speakers";

/** The minimal shape of a voice the header (and its naming/correction
 *  editor) needs — decoupled from the full `SpeakerProfile` so this stays a
 *  presentational component, testable with plain fixtures independent of
 *  the Zustand store. */
export interface SpeakerHeaderInfo {
  id: string;
  label: string;
  kind: SpeakerKind;
}

interface TranscriptBubbleHeaderProps {
  speakerLabel: string;
  speakerTone: "inbound" | "outbound";
  timeLabel: string;
  timeTitle: string;
  isFinal: boolean;
  collapsed: boolean;
  busy: boolean;
  onToggleCollapse: () => void;
  onResearch: () => void;

  /**
   * Speaker-aware naming/correction (doc §6.4/§6.6). Omitted entirely on the
   * outbound/"You" side, where the label is never editable, and on the
   * inbound side until the caller has a real voice to attach — when any of
   * `speaker`/`onRename` is missing the label stays the original plain,
   * non-interactive span (zero behavior change from before this feature).
   */
  speaker?: SpeakerHeaderInfo;
  /** How settled this turn's voice assignment is — "uncertain" (doc §1:
   *  overlap/insufficient speech) never presents a confident guess. */
  status?: AssignmentStatus;
  /** Other known session voices this turn could be merged into (doc §6.4's
   *  "Merge with…") — excludes this turn's own voice and "you". */
  otherSpeakers?: SpeakerHeaderInfo[];
  /** Save action in the name editor. */
  onRename?: (label: string) => void;
  /** "Merge with…" — this turn's voice turned out to be `targetId`. */
  onMerge?: (targetId: string) => void;
  /** "Different voice from here" (doc §6.4) — split this turn off as a new
   *  session voice. Scoped to this turn only; doc's "rerun background
   *  clustering for nearby turns" needs the Phase A/B pipeline and isn't
   *  implemented yet. */
  onSplit?: () => void;
  /** "Forget" — clear a named voice back to its anonymous placeholder.
   *  Hidden unless the voice has actually been named. */
  onForget?: () => void;
}

/**
 * Doc §6.4's name-voice editor, anchored to the speaker label: a heading, one
 * prefilled-when-renaming text field, Save/Cancel, a "Remember for future
 * conversations" toggle, and overflow actions (Merge with…, Different voice
 * from here, Forget).
 *
 * The remember toggle is rendered per the approved anatomy but stays
 * disabled: doc §15 Phase B ("session-local MVP") explicitly keeps
 * remembered profiles disabled until Phase C builds the local profile store
 * and its consent/privacy copy — showing it enabled now would promise
 * persistence this build doesn't have.
 */
function NameVoiceEditor({
  speaker,
  otherSpeakers,
  onRename,
  onMerge,
  onSplit,
  onForget,
  onClose,
}: {
  speaker: SpeakerHeaderInfo;
  otherSpeakers: SpeakerHeaderInfo[];
  onRename: (label: string) => void;
  onMerge?: (targetId: string) => void;
  onSplit?: () => void;
  onForget?: () => void;
  onClose: () => void;
}) {
  // Prefilled only when actually renaming a named voice — an anonymous
  // "New voice"/"Voice N" placeholder starts blank so the user types a real
  // name instead of having to first clear placeholder text (doc §6.4: "one
  // text field, prefilled when renaming").
  const [value, setValue] = useState(speaker.kind === "named" ? speaker.label : "");
  const [mergeOpen, setMergeOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // The popover stops propagation on its own container's click/mousedown
    // (below), so any click that reaches window here is genuinely outside it.
    const onClickAway = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClickAway);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClickAway);
    };
  }, [onClose]);

  const save = () => {
    const trimmed = value.trim();
    if (trimmed) onRename(trimmed);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label={`Name this voice — currently ${speaker.label}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="glass-raised absolute left-0 top-full z-50 mt-1 w-[236px] rounded-lg border border-border p-2.5 shadow-[var(--shadow-lg)]"
    >
      <p className="mb-1.5 font-mono text-[9.5px] font-bold uppercase tracking-wider text-fg-faint">
        Name this voice
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-1.5"
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Voice name"
          placeholder={speaker.label}
          maxLength={60}
          className="min-w-0 rounded border border-border bg-bg px-1.5 py-1 text-[12px] text-fg outline-none focus:border-ai/60"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="submit"
            className="rounded-full bg-ai px-2.5 py-1 text-[11px] font-bold text-bg transition hover:brightness-110"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border-strong px-2.5 py-1 text-[11px] font-medium text-fg-muted transition hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </form>

      <label className="mt-2 flex cursor-not-allowed items-start gap-1.5 border-t border-border pt-2 opacity-60">
        <input type="checkbox" checked={false} disabled readOnly className="mt-0.5" />
        <span className="text-[10.5px] leading-snug text-fg-muted">
          Remember for future conversations
          <span className="mt-0.5 block text-[9.5px] text-fg-faint">
            Coming soon — voices aren't remembered across conversations yet.
          </span>
        </span>
      </label>

      {(otherSpeakers.length > 0 || onSplit || (onForget && speaker.kind === "named")) && (
        <div className="mt-2 flex flex-col gap-0.5 border-t border-border pt-1.5">
          {otherSpeakers.length > 0 && onMerge && (
            <>
              <button
                type="button"
                onClick={() => setMergeOpen((v) => !v)}
                aria-expanded={mergeOpen}
                className="flex items-center gap-1.5 rounded px-1 py-1 text-left text-[11.5px] text-fg-muted transition-colors hover:bg-panel-raised/60 hover:text-fg"
              >
                <Icon
                  name="chevron"
                  size={10}
                  className={`transition-transform ${mergeOpen ? "" : "-rotate-90"}`}
                />
                Merge with…
              </button>
              {mergeOpen && (
                <ul className="ml-3 flex flex-col">
                  {otherSpeakers.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onMerge(s.id);
                          onClose();
                        }}
                        className="w-full truncate rounded px-1 py-0.5 text-left text-[11.5px] text-fg transition-colors hover:bg-panel-raised/60"
                      >
                        {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {onSplit && (
            <button
              type="button"
              onClick={() => {
                onSplit();
                onClose();
              }}
              className="rounded px-1 py-1 text-left text-[11.5px] text-fg-muted transition-colors hover:bg-panel-raised/60 hover:text-fg"
            >
              Different voice from here
            </button>
          )}
          {onForget && speaker.kind === "named" && (
            <button
              type="button"
              onClick={() => {
                onForget();
                onClose();
              }}
              className="rounded px-1 py-1 text-left text-[11.5px] text-rec/80 transition-colors hover:bg-rec/10 hover:text-rec"
            >
              Forget
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The compact identity/action line for a transcript bubble (option B,
 * owner-approved 2026-09-03 — see
 * `conva_core/docs/technical/speaker-aware-conversations.md`).
 *
 * `speakerLabel` is deliberately data-agnostic: today it receives Them/You;
 * the speaker-aware pipeline can later pass New voice, Voice 2, a confirmed
 * name, or an explicitly uncertain label without changing bubble geometry.
 *
 * The label becomes an intuitive button once a real `speaker`/`onRename` are
 * supplied (doc §6.6: "a native button with an accessible name such as
 * 'Voice 2, unnamed — name or correct speaker'") — opening the name/correct
 * editor above. "You" never gets one: the current user's own speech is
 * always labeled "You" (owner decision) and is never renamed.
 */
export function TranscriptBubbleHeader({
  speakerLabel,
  speakerTone,
  timeLabel,
  timeTitle,
  isFinal,
  collapsed,
  busy,
  onToggleCollapse,
  onResearch,
  speaker,
  status,
  otherSpeakers = [],
  onRename,
  onMerge,
  onSplit,
  onForget,
}: TranscriptBubbleHeaderProps) {
  const [editing, setEditing] = useState(false);
  // Editable only once the turn is final (matches collapse/Ask Ally's own
  // isFinal gate — a still-streaming turn's grouping can still shift) AND a
  // real voice + save handler were supplied.
  const editable = isFinal && speakerTone === "inbound" && !!speaker && !!onRename;
  const uncertain = status === "uncertain";
  const speakerClass =
    speakerTone === "inbound" ? "text-inbound" : "text-[var(--voice-you-text)]";

  const accessibleName = speaker
    ? `${speaker.label}${speaker.kind === "anonymous" ? ", unnamed" : ""} — name or correct speaker`
    : undefined;

  return (
    <div className="relative mb-0.5 flex min-h-5 select-none items-center gap-1.5 border-b border-border/55 pb-0.5">
      {editable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing((v) => !v);
          }}
          aria-haspopup="dialog"
          aria-expanded={editing}
          aria-label={accessibleName}
          title={speakerLabel}
          className={[
            "min-w-0 truncate rounded font-mono text-[9px] font-semibold uppercase tracking-[0.12em] transition-colors hover:bg-inbound/10",
            uncertain
              ? "italic text-fg-faint underline decoration-dashed decoration-1 underline-offset-2"
              : speakerClass,
          ].join(" ")}
        >
          {speakerLabel}
          {!uncertain && speaker?.kind === "named" && (
            <Icon name="check" size={8} className="ml-1 inline-block align-middle text-ai" />
          )}
        </button>
      ) : (
        <span
          className={`min-w-0 truncate font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${
            uncertain ? "italic text-fg-faint" : speakerClass
          }`}
          title={speakerLabel}
        >
          {speakerLabel}
        </span>
      )}

      {editable && editing && speaker && onRename && (
        <NameVoiceEditor
          speaker={speaker}
          otherSpeakers={otherSpeakers}
          onRename={onRename}
          onMerge={onMerge}
          onSplit={onSplit}
          onForget={onForget}
          onClose={() => setEditing(false)}
        />
      )}

      <span className="h-1 w-1 shrink-0 rounded-full bg-border-strong" aria-hidden />
      <span
        title={timeTitle}
        className="shrink-0 cursor-help font-mono text-[9px] text-fg-faint"
      >
        {isFinal ? timeLabel : "live"}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        {isFinal && (
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse();
            }}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand turn" : "Collapse turn"}
            className="grid h-5 w-5 place-items-center rounded text-fg-faint transition-colors hover:bg-bg/50 hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
          >
            <Icon
              name="chevron"
              size={11}
              strokeWidth={2.6}
              className={collapsed ? "" : "rotate-180"}
            />
          </button>
        )}
        {isFinal && (
          <button
            type="button"
            disabled={busy}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onResearch}
            title="Ask Ally about this turn"
            aria-label="Ask Ally about this turn"
            className="grid h-5 w-5 place-items-center rounded text-ai/65 transition-colors hover:bg-ai/10 hover:text-ai focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ai/70 disabled:opacity-40"
          >
            <Icon name="lightbulb" size={12} />
          </button>
        )}
      </span>
    </div>
  );
}
