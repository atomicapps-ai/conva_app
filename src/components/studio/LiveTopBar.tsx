import { GroundPicker } from "@/components/contexts/GroundPicker";
import { useGroundingStore } from "@/state/grounding";
import { useTranscriptStore } from "@/state/transcript";

/**
 * Live session's own crown (V4.0's `.topbar`: breadcrumb › title, actions
 * top-right) — every other routed view already gets this from `ViewShell`;
 * Live was the one deliberate exception (see the note at the top of
 * `TranscriptView.tsx`). The full-rebuild decision retires that exception:
 * Live gets a real crown too, just a lighter one than `ViewShell` renders
 * (no scrolling body wrapper — the transcript below owns its own scroll and
 * "never shrinks first", §4.3/§8) so it sits directly above the existing
 * "Conversation" sub-header without double-charging the vertical budget.
 *
 * Title is the active grounding context's name (GroundPicker already tracks
 * this) — "Live session" is the breadcrumb, the context is what's actually
 * being talked about, same relationship as the mockup's "Contexts › Amazon
 * Interview". Actions are deliberately narrower than the mockup's set (Add
 * document / Ground / Delete context / text-size / Brief) — those are
 * context-*management* actions that belong on the Contexts page, not Live;
 * inventing delete/prime affordances here would be new, unreviewed product
 * surface, not a mockup-fidelity fix.
 *
 * Record used to live here too — moved to `LiveControlBar` (owner
 * feedback): it's a session-lifecycle action, same family as Start/Stop and
 * End & summarise, not a context-management one, so it belongs with them at
 * the bottom, not stranded up here on its own.
 */
export function LiveTopBar() {
  const session = useTranscriptStore((s) => s.session);
  const listening = session.state === "listening";
  const activeTitle = useGroundingStore((s) => s.activeTitle);

  return (
    <header className="flex shrink-0 items-start gap-4 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-faint">
          Live session
        </p>
        <h2 className="truncate text-[18px] font-extrabold tracking-tight text-fg">
          {activeTitle || "General conversation"}
        </h2>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <GroundPicker disabled={listening} />
      </div>
    </header>
  );
}
