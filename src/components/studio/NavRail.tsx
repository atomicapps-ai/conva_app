import { useEffect, useState } from "react";

import mark from "@/assets/brand/conva-mark-cutout-white.svg";
import { NAV_ITEMS } from "@/components/studio/navItems";
import { Icon } from "@/components/ui/Icon";
import { useBackend } from "@/lib/backend";
import { isTauri, type AuthStatus } from "@/lib/ipc";
import { PLATFORM } from "@/lib/platform";
import { useAppStore } from "@/state/app";
import { useNavStore } from "@/state/nav";

/**
 * The Studio's left instrument rail — a **file cabinet**, not a strip of
 * equal icon buttons (V4.0, `conva_core/brand/UI/AppUI_V4.0`). Rows carry a
 * label, dropped to icon-only either in the app's manual Compact mode or
 * automatically once the shell narrows below the responsive-tiers Medium
 * threshold (`narrow` prop, driven by StudioShell's own ResizeObserver —
 * see the shed-order note there). The active row takes the content pane's
 * OWN background (`bg-panel` — must match `StudioShell.tsx`'s pane exactly,
 * not a brighter step; see the join comment below for why), a plain bright
 * icon/label (no accent tint), and a 2px azure spine on its leading edge —
 * the accent lives on the spine only, never a voice colour, never the
 * whole row. (A same-day round-trip on 2026-08-17: bumped the background a
 * step brighter for legibility, which broke the pane-color match the tab
 * shape depends on; reverted to the mockup's literal values same day —
 * legibility comes from the fg-muted → fg jump plus the spine, not from
 * recoloring the row.)
 */

/** The shared nav list resolved for THIS platform (base rows + desktop rows).
 *  "dashboard" is deliberately excluded here — V4.0's rail has no Home row;
 *  the way back to it is the WindowChrome mark + the small icon above the
 *  account block below. WebTopNav still shows Home normally (it has no
 *  equivalent bottom-of-rail utility cluster to hang a shortcut off of). */
const RAIL_ITEMS = NAV_ITEMS.filter(
  (i) => (!i.only || i.only === PLATFORM) && i.view !== "dashboard",
);

/** First letter of the email, for the monogram avatar (same as Dashboard/Profile). */
function initial(email: string | null): string {
  return (email?.trim()?.[0] ?? "?").toUpperCase();
}

/** "today 09:14" / "yesterday 09:14" / "Aug 12" — terse, matches the
 *  reference's "Last in · today 09:14". Full detail lives in the popover
 *  (and Profile's Row) via toLocaleString(); this is a rail-row-width label. */
function formatLastIn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, now)) return `today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `yesterday ${time}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function RailButton({
  active,
  join = true,
  label,
  displayLabel,
  compact,
  onClick,
  children,
}: {
  active?: boolean;
  /** Whether the active style grafts the row onto the content pane (the
   *  file-cabinet tab join). The account button opts out: its `active` is
   *  "menu open", not "this page is open", and a popover toggle shouldn't
   *  read as a tab. */
  join?: boolean;
  /** Full description — always the tooltip/aria-label. */
  label: string;
  /** Short row text shown when !compact. Falls back to `label`. */
  displayLabel?: string;
  compact: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active && join ? "page" : undefined}
      className={[
        // ⚠️ WIDTH IS THE WHOLE TRICK — read before touching. The active
        // row's -mr bleed below only widens the row if flex `stretch` is
        // what sizes it: per spec, stretch applies ONLY when the cross
        // size is `auto`, and it subtracts margins from the container's
        // content width — so a negative right margin genuinely widens the
        // row, carrying it across the rail's own right border to die flush
        // against the pane. Giving these rows a definite width (`w-full`,
        // `w-[30px]`) silently disables stretch: the width resolves
        // against the content box, the row stops 7px short of the border,
        // and the negative margin computes but moves nothing. That was
        // the entire "looks like a button, not a tab" bug (owner,
        // 2026-08-17) — every paint property (color/margin/radius)
        // checked out for days while the rendered right edge sat at
        // x=181 instead of x=188. Inactive compact rows keep a definite
        // w-[30px] (centered square); everything else stays width-auto.
        "group relative flex shrink-0 items-center gap-2.5 border border-transparent text-[13px] font-semibold transition",
        compact ? "h-[30px] justify-center" : "h-[34px] justify-start px-2.5",
        active
          ? [
              // bg-panel — EXACTLY the content pane's own background
              // (StudioShell.tsx: "bg-panel — same surface the active
              // rail row takes on, so its join reads as 'becomes the
              // pane'"), not a step brighter — that match is load-bearing.
              // border-border — EXACTLY the same token as the rail's own
              // border-r seam, also load-bearing (owner, 2026-08-17):
              // the tab's outline visually CONTINUES the seam line it
              // interrupts — down the seam, left around the tab, back to
              // the seam — so both must be one color to read as one
              // continuous folder-tab silhouette. border-strong here made
              // the tab's frame a second, lighter line that dead-ended
              // into the darker seam. text-fg (plain bright white, not
              // the accent); only the spine carries azure.
              "border-border bg-panel text-fg",
              join
                ? compact
                  ? // compact rail: no horizontal padding, so only the 1px
                    // border to cross. self-stretch overrides the nav's
                    // items-center so stretch sizing (and the bleed) applies.
                    "-mr-[1px] self-stretch rounded-l-[var(--radius)] rounded-r-none border-r-0"
                  : // 6px px-1.5 + 1px rail border
                    "-mr-[7px] rounded-l-[var(--radius)] rounded-r-none border-r-0"
                : compact
                  ? "w-[30px] rounded-[var(--radius)]"
                  : "rounded-[var(--radius)]",
            ].join(" ")
          : [
              "rounded-[var(--radius)] text-fg-muted hover:bg-white/[0.045] hover:text-fg",
              compact ? "w-[30px]" : "",
            ].join(" "),
      ].join(" ")}
    >
      {/* Leading-edge spine on the active row — the accent, not a voice
          colour (was a 3px violet bar keyed to "you"; V4.0 §5). */}
      <span
        className={[
          "absolute -left-[5px] top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary transition-opacity",
          active ? "opacity-100" : "opacity-0",
        ].join(" ")}
        aria-hidden
      />
      <span className="flex shrink-0 items-center justify-center">
        {children}
      </span>
      {!compact && <span className="truncate">{displayLabel ?? label}</span>}
    </button>
  );
}

export function NavRail({ narrow = false }: { narrow?: boolean }) {
  const backend = useBackend();
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const openPalette = useNavStore((s) => s.openPalette);
  // Manual Compact (physically shrinks the OS window) is independent of
  // `narrow` (a pure visual response to available shell width) — either one
  // is enough to drop the rail to icon-only.
  const manualCompact = useAppStore((s) => s.compact);
  const compact = manualCompact || narrow;
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Reflect sign-in state on the account button. Refreshes when the view
  // changes so signing in via Settings updates the rail without a reload.
  useEffect(() => {
    setMenuOpen(false);
    if (!isTauri()) return;
    void backend.auth
      .status()
      .then(setAuth)
      .catch(() => setAuth(null));
  }, [view, backend]);

  return (
    <nav
      aria-label="Primary"
      className={[
        // One continuous frame with the content pane (V4.0 "file cabinet") —
        // no rounding, no top/bottom border of its own; the single right
        // border IS the join, same as the mockup's `.sidebar`.
        "z-10 flex shrink-0 flex-col gap-0.5 border-r border-border bg-bg-2 py-2",
        compact ? "w-[44px] items-center" : "w-[188px] items-stretch px-1.5",
      ].join(" ")}
    >
      {/* Brand mark. */}
      <img
        src={mark}
        alt="conva"
        title="conva"
        draggable={false}
        className={compact ? "mb-2 h-[22px] w-[22px] self-center" : "mb-2 ml-1.5 h-[22px] w-[22px]"}
      />

      {RAIL_ITEMS.map((item) => (
        <RailButton
          key={item.view}
          active={view === item.view}
          label={item.label}
          compact={compact}
          onClick={() => setView(item.view)}
        >
          <Icon name={item.icon} size={20} />
        </RailButton>
      ))}

      <div
        className={[
          "mt-auto flex gap-0.5 pt-2",
          // self-stretch in compact: this wrapper must span the rail's full
          // width (not shrink to its 30px children) so an active row inside
          // it (Home) can stretch across it and bleed over the rail border
          // — same width mechanics as the main rail items above.
          compact ? "flex-col items-center self-stretch" : "flex-col items-stretch",
        ].join(" ")}
      >
        <RailButton
          label="Command palette (⌘K)"
          displayLabel="Search"
          compact={compact}
          onClick={openPalette}
        >
          <Icon name="search" size={19} />
        </RailButton>

        {/* Home — V4.0's rail has no full-width Home row; this small icon
            (plus the WindowChrome mark) is the way back instead. */}
        <RailButton
          label="Home"
          active={view === "dashboard"}
          compact={compact}
          onClick={() => setView("dashboard")}
        >
          <Icon name="home" size={19} />
        </RailButton>

        {/* Account block — under Settings (V4.0 §5). Signed in + !compact:
            avatar + email row; hovering/focusing reveals an identity
            popover (name/email — see the note on the popover below for what
            V4.0 additionally asks for that isn't wired up yet). Click still
            opens the existing Profile/Settings menu, unchanged. Compact or
            signed-out: falls back to the plain icon button, as before. */}
        <div className="group relative">
          {!compact && auth?.signed_in ? (
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={[
                "flex w-full items-center gap-2.5 rounded-[var(--radius)] border border-transparent px-2 py-1.5 text-left transition",
                menuOpen
                  ? "border-border-strong bg-panel"
                  : "hover:bg-white/[0.045]",
              ].join(" ")}
            >
              <span
                className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-primary font-mono text-[10.5px] font-bold text-primary-ink"
                aria-hidden
              >
                {initial(auth.email)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-fg">
                  {auth.email}
                </span>
                {auth.last_sign_in_at && (
                  <span className="block truncate font-mono text-[9.5px] text-fg-faint">
                    Last in · {formatLastIn(auth.last_sign_in_at)}
                  </span>
                )}
              </span>
            </button>
          ) : (
            <RailButton
              label={auth?.signed_in ? `${auth.email ?? "Signed in"} — account menu` : "Account — sign in"}
              displayLabel={auth?.signed_in ? (auth.email ?? "Account") : "Sign in"}
              active={menuOpen}
              join={false}
              compact={compact}
              onClick={() => {
                if (auth?.signed_in) setMenuOpen((o) => !o);
                else setView("settings");
              }}
            >
              <span className="relative flex items-center justify-center">
                <Icon name="account" size={20} />
                {auth?.signed_in && (
                  <span
                    className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-ok"
                    aria-hidden
                  />
                )}
              </span>
            </RailButton>
          )}

          {/* Hover/focus identity popover — informational only, separate
              from the click menu below. Sign-in time is now real (Supabase's
              own last_sign_in_at, extended into AuthStatus on the Rust side
              + both IPC mirrors — see auth.rs). Still no display name: it's
              provider-dependent (present for OAuth via user_metadata,
              usually absent for email/password accounts), so showing it
              only sometimes would read as broken rather than showing it
              never — email is the one identity string every account has. */}
          {!compact && auth?.signed_in && !menuOpen && (
            <div
              role="tooltip"
              className="glass-raised pointer-events-none absolute bottom-0 left-[calc(100%+8px)] z-50 w-[200px] rounded-lg border border-border-strong p-3 opacity-0 shadow-[var(--shadow-lg)] transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <p className="truncate text-[12.5px] font-bold text-fg">
                {auth.email}
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] text-ok">
                {auth.last_sign_in_at
                  ? `Signed in · ${new Date(auth.last_sign_in_at).toLocaleString()}`
                  : "Signed in"}
              </p>
            </div>
          )}

          {menuOpen && auth?.signed_in && (
            <>
              <button
                type="button"
                aria-label="Close account menu"
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div
                role="menu"
                className="glass-raised absolute bottom-0 left-[calc(100%+8px)] z-50 w-[188px] rounded-lg border border-border-strong p-1 shadow-[var(--shadow-lg)]"
              >
                <p className="truncate px-2.5 py-1.5 text-[11px] text-fg-faint">
                  {auth.email ?? "Signed in"}
                </p>
                <span className="mx-1 mb-1 block h-px bg-border" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setView("settings");
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-1.5 text-left text-xs text-fg hover:bg-panel-raised/70"
                >
                  <Icon name="account" size={15} className="text-fg-muted" />
                  Profile
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setView("settings");
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-1.5 text-left text-xs text-fg hover:bg-panel-raised/70"
                >
                  <Icon name="settings" size={15} className="text-fg-muted" />
                  Settings
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
