import { useEffect, useState } from "react";

import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { isTauri } from "@/lib/ipc";
import { useNavStore } from "@/state/nav";
import type { View } from "@/state/nav";

/** One "open a page" row — icon, label, blurb, chevron. */
function LinkRow({
  icon,
  label,
  blurb,
  onClick,
}: {
  icon: IconName;
  label: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-bg/40 px-3 py-2.5 text-left transition hover:border-border-strong hover:bg-panel-raised/40"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-fg">{label}</span>
        <span className="block truncate text-[11px] text-fg-faint">{blurb}</span>
      </span>
      <Icon name="chevron" size={14} className="shrink-0 -rotate-90 text-fg-faint" />
    </button>
  );
}

/**
 * "About & extras" hub (owner decision, 2026-08-16) — the Floating HUD
 * toggle and the three product/marketing pages (What conva does / What's
 * Coming / What's New) used to live in the primary nav rail; moved here,
 * off the rail entirely, reachable only via Settings → About. See the note
 * at the top of `navItems.ts` for why.
 */
export function AboutMoreView() {
  const backend = useBackend();
  const setView = useNavStore((s) => s.setView);
  const [hudOpen, setHudOpen] = useState(false);
  const [hudBusy, setHudBusy] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void backend.hud
      .isOpen()
      .then(setHudOpen)
      .catch(() => {});
  }, [backend]);

  const toggleHud = async () => {
    setHudBusy(true);
    try {
      setHudOpen(await backend.hud.toggle());
    } catch {
      /* best-effort — leave the toggle at its last known state */
    } finally {
      setHudBusy(false);
    }
  };

  const goTo = (view: View) => () => setView(view);

  return (
    <ViewShell icon="sparkle" breadcrumb="Settings" title="About & extras">
      {isTauri() && (
        <Section
          title="Floating HUD"
          description="An always-on-top overlay strip you can pin over any other window while on a call."
        >
          <label className="flex items-center gap-2.5 text-[13px] text-fg">
            <input
              type="checkbox"
              checked={hudOpen}
              disabled={hudBusy}
              onChange={() => void toggleHud()}
            />
            {hudOpen ? "Floating HUD is open" : "Show the floating HUD"}
          </label>
        </Section>
      )}

      <Section
        title="Learn more"
        description="Product pages that used to live in the main nav — still here, just tucked away."
      >
        <div className="flex flex-col gap-2">
          <LinkRow
            icon="book"
            label="What conva does"
            blurb="A tour of the product, feature by feature."
            onClick={goTo("features")}
          />
          <LinkRow
            icon="lightbulb"
            label="What's Coming"
            blurb="The roadmap — what's planned next."
            onClick={goTo("whatsnew")}
          />
          <LinkRow
            icon="sparkle"
            label="What's New"
            blurb="Release notes for the build you're running."
            onClick={goTo("releases")}
          />
        </div>
      </Section>
    </ViewShell>
  );
}
