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
 * label (icon-only in compact mode, matching the old rail exactly — the
 * window is too narrow for text there anyway). The active row takes the
 * panel background and a 2px azure spine on its leading edge — the accent,
 * never a voice colour; voice identity is never borrowed by chrome.
 */

/** The shared nav list resolved for THIS platform (base rows + desktop rows). */
const RAIL_ITEMS = NAV_ITEMS.filter((i) => !i.only || i.only === PLATFORM);

/** First letter of the email, for the monogram avatar (same as Dashboard/Profile). */
function initial(email: string | null): string {
  return (email?.trim()?.[0] ?? "?").toUpperCase();
}

function RailButton({
  active,
  label,
  displayLabel,
  compact,
  onClick,
  children,
}: {
  active?: boolean;
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
      aria-current={active ? "page" : undefined}
      className={[
        "group relative flex shrink-0 items-center gap-2.5 rounded-[var(--radius)] border border-transparent text-[13px] font-semibold transition",
        compact
          ? "h-[30px] w-[30px] justify-center"
          : "h-[34px] w-full justify-start px-2.5",
        active
          ? "border-border-strong bg-panel text-fg"
          : "text-fg-muted hover:bg-white/[0.045] hover:text-fg",
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

export function NavRail() {
  const backend = useBackend();
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const openPalette = useNavStore((s) => s.openPalette);
  const compact = useAppStore((s) => s.compact);
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
        "z-10 flex shrink-0 flex-col gap-0.5 rounded-r-lg border border-l-0 border-border bg-bg-2 py-2",
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
          compact ? "flex-col items-center" : "flex-col items-stretch",
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

        {/* Floating HUD panel — always-on-top, non-activating overlay. */}
        <RailButton
          label="Floating HUD"
          compact={compact}
          onClick={() => {
            if (isTauri()) void backend.hud.toggle().catch(() => {});
          }}
        >
          <Icon name="expand" size={18} />
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
              </span>
            </button>
          ) : (
            <RailButton
              label={auth?.signed_in ? `${auth.email ?? "Signed in"} — account menu` : "Account — sign in"}
              displayLabel={auth?.signed_in ? (auth.email ?? "Account") : "Sign in"}
              active={menuOpen}
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
              from the click menu below. V4.0 also asks for a "last-login"
              line under the row and a sign-in date/time inside this
              popover; I've left both out rather than fake them. The auth
              IPC (`AuthStatus`) only carries email/user_id/token expiry —
              no display name and no real sign-in timestamp (token expiry
              is a different thing and would be misleading to show as
              "signed in at"). Wiring real values means extending
              AuthStatus on the Rust side and both IPC mirrors — flagging
              rather than guessing. */}
          {!compact && auth?.signed_in && !menuOpen && (
            <div
              role="tooltip"
              className="glass-raised pointer-events-none absolute bottom-0 left-[calc(100%+8px)] z-50 w-[200px] rounded-lg border border-border-strong p-3 opacity-0 shadow-[var(--shadow-lg)] transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <p className="truncate text-[12.5px] font-bold text-fg">
                {auth.email}
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] text-ok">Signed in</p>
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
