import mark from "@/assets/brand/conva-mark-white.svg";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useNavStore, type View } from "@/state/nav";

/**
 * The Studio's left instrument rail (64px). View selectors with the conva mark
 * up top and the ⌘K palette trigger at the foot. The active view gets a 3px
 * violet indicator on its leading edge and a violet-tinted chip (brand v2).
 */

const NAV_ITEMS: { view: View; icon: IconName; label: string }[] = [
  { view: "live", icon: "live", label: "Live" },
  { view: "conversations", icon: "conversations", label: "Conversations" },
  { view: "sessions", icon: "sessions", label: "Sessions" },
  { view: "library", icon: "library", label: "Library" },
  { view: "settings", icon: "settings", label: "Settings" },
];

function RailButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={[
        "group relative flex h-11 w-11 items-center justify-center rounded-xl border transition",
        active
          ? "border-outbound/34 bg-outbound/[0.14] text-[var(--voice-you-text)]"
          : "border-transparent text-fg-faint hover:bg-panel-raised/60 hover:text-fg",
      ].join(" ")}
    >
      {/* 3px violet indicator on the leading edge of the active view. */}
      <span
        className={[
          "absolute -left-3 h-5 w-[3px] rounded-full bg-outbound transition-opacity",
          active ? "opacity-100" : "opacity-0",
        ].join(" ")}
        aria-hidden
      />
      {children}
    </button>
  );
}

export function NavRail() {
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const openPalette = useNavStore((s) => s.openPalette);

  return (
    <nav
      aria-label="Primary"
      className="glass z-10 flex w-16 shrink-0 flex-col items-center gap-1 rounded-r-[26px] border-l-0 py-3"
    >
      {/* Brand mark. */}
      <img
        src={mark}
        alt="conva"
        title="conva"
        draggable={false}
        className="mb-2.5 h-[26px] w-[26px]"
      />

      {NAV_ITEMS.map((item) => (
        <RailButton
          key={item.view}
          active={view === item.view}
          label={item.label}
          onClick={() => setView(item.view)}
        >
          <Icon name={item.icon} size={20} />
        </RailButton>
      ))}

      <div className="mt-auto flex flex-col items-center gap-1 pt-2">
        <RailButton label="Command palette (⌘K)" onClick={openPalette}>
          <Icon name="search" size={19} />
        </RailButton>
        <kbd className="rounded border border-border px-1 py-0.5 font-mono text-[9px] text-fg-faint">
          ⌘K
        </kbd>
      </div>
    </nav>
  );
}
