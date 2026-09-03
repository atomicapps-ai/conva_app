import { useEffect, useRef, useState } from "react";

import orbitArtwork from "@/assets/brand/raster/conva-core-orbit-reference@2x.png";
import { NAV_ITEMS } from "@/components/studio/navItems";
import { activeRailView } from "@/components/studio/railState";
import { Icon } from "@/components/ui/Icon";
import { LockedIcon, LockedMark, LockedWordmark } from "@/components/ui/LockedIcon";
import { formatLastSignIn } from "@/lib/account";
import { useBackend } from "@/lib/backend";
import { RAIL_EXPANDED_PX, RAIL_ICONS_PX, type RailMode } from "@/lib/responsive";
import { useAccount } from "@/lib/useAccount";
import { useNavStore } from "@/state/nav";

/**
 * The primary navigation rail — AppUI V5.0 (`conva_core@1b007ed`,
 * `brand/UI/AppUI_V5.0/NavRail.dc.html`, the component every frame imports).
 *
 * Structure, top to bottom:
 *
 *   wordmark (expanded) / mark (icon-only)
 *   the SIX destinations (navItems.ts) — locked icons, azure spine when active
 *   the Conva Core orbit artwork — EDGE TO EDGE
 *   account block: avatar · name · role · caret  +  the three locked utilities
 *                  (Notifications · Settings · Sign out)
 *
 * Things that are load-bearing and easy to break:
 *
 * - **The orbit is edge-to-edge.** Its wrapper cancels the rail's own
 *   horizontal padding with a negative margin and adds none of its own, and
 *   the image is `block / w-full / h-auto / m-0 / border-0 / rounded-none`.
 *   The locked-artwork README is explicit: "It must touch both rail edges with
 *   no inset card treatment or duplicate divider line." No card, no ring, no
 *   extra hairline above it — the account block's own `border-t` is the only
 *   rule anywhere near it.
 * - **The artwork is imported, never redrawn.** `src/assets/brand/raster/` is
 *   a byte-identical copy of the conva_core asset; don't trace/recolor it.
 * - **Icons are the locked pack** (`LockedIcon`) — active/inactive change
 *   colour and surface only, never geometry.
 * - **Settings is NOT a row.** It is the middle utility button. `activeRailView`
 *   returns null on Settings so no row lights while it's open.
 *
 * Rail modes come from `resolveLayout()` (V5.0 §10): `expanded` ≥1024,
 * `icons` 560–1023, and `menu` below 560 — where StudioShell renders this same
 * component inside a ☰ drawer, in `expanded` form, and passes `onNavigate` so
 * picking a row closes the drawer.
 */
export function NavRail({
  mode = "expanded",
  onNavigate,
}: {
  mode?: RailMode;
  /** Called after any navigation — lets the ☰ drawer close itself. */
  onNavigate?: () => void;
}) {
  const backend = useBackend();
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const openPalette = useNavStore((s) => s.openPalette);
  const { account, auth, refresh } = useAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The rail is rendered in `expanded` form inside the ☰ drawer, so treat
  // "menu" as expanded here; StudioShell decides where it lives.
  const compact = mode === "icons";
  const active = activeRailView(view);

  useEffect(() => {
    setMenuOpen(false);
    setNotifOpen(false);
  }, [view]);

  const go = (next: typeof view) => {
    setView(next);
    onNavigate?.();
  };

  const signOut = () => {
    setMenuOpen(false);
    void backend.auth
      .signout()
      .catch(() => undefined)
      .finally(refresh);
  };

  return (
    <nav
      aria-label="Primary"
      style={{ width: compact ? RAIL_ICONS_PX : RAIL_EXPANDED_PX }}
      className={[
        "relative z-10 flex shrink-0 flex-col border-r border-border bg-bg-2 py-5",
        // px-3 == the 12px the orbit's -mx-3 cancels below. Change one, change
        // the other or the artwork stops being edge-to-edge.
        compact ? "items-center px-2" : "px-3",
      ].join(" ")}
    >
      {/* ── brand ─────────────────────────────────────────────────────── */}
      {compact ? (
        <div className="flex justify-center pb-5 pt-0.5">
          <LockedMark size={30} className="text-fg" />
        </div>
      ) : (
        <div className="px-2.5 pb-[22px] pt-1.5">
          <LockedWordmark width={112} className="text-fg" />
        </div>
      )}

      {/* ── the six destinations ──────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-[3px]">
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => go(item.view)}
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className={[
                "relative flex shrink-0 items-center rounded-[var(--radius)] border transition",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                compact
                  ? "h-11 w-full justify-center"
                  : "gap-3 px-[13px] py-2 text-left text-[13px]",
                isActive
                  ? "border-border-strong bg-panel-raised text-fg"
                  : "border-transparent text-fg-muted hover:bg-white/[0.045] hover:text-fg",
              ].join(" ")}
            >
              {/* 2px azure spine on the leading edge — the accent lives here
                  and nowhere else on the row (never a voice colour). */}
              <span
                aria-hidden
                className={[
                  "absolute -left-px bottom-[7px] top-[7px] w-[2px] rounded-full bg-primary transition-opacity",
                  isActive ? "opacity-100" : "opacity-0",
                ].join(" ")}
              />
              <LockedIcon
                name={item.icon}
                size={20}
                className={isActive ? "text-primary" : ""}
              />
              {!compact && (
                <span className={isActive ? "truncate font-bold" : "truncate font-semibold"}>
                  {item.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── lower brand: the Conva Core orbit ─────────────────────────────
          EDGE TO EDGE horizontally — -mx-3 exactly cancels the rail's px-3,
          no padding/border/radius/divider of its own. Height-CAPPED and
          object-cover-cropped as of 2026-09-02 (owner screenshot feedback:
          "trim to this yellow box... move the below login up more") — this
          supersedes the earlier "never crop the locked artwork" rule for
          this element specifically; width stays uncropped/edge-to-edge.
          object-center (not object-top): the mark sits centered in the
          source image with rings above AND below it, so an object-top crop
          showed empty upper rings instead of the mark — object-center
          brings the actual icon into view. mt-0 (no top margin): flush
          against the last nav button, per "no need for padding between the
          icon and the menu buttons on top." */}
      {!compact && (
        <div className="-mx-3 mb-2 mt-0 h-16 overflow-hidden">
          <img
            src={orbitArtwork}
            alt=""
            aria-hidden
            className="m-0 block h-full w-full rounded-none border-0 object-cover object-center"
          />
        </div>
      )}

      {/* ── account block ─────────────────────────────────────────────── */}
      {compact ? (
        <div ref={menuRef} className="relative flex justify-center border-t border-border pt-3">
          <button
            type="button"
            onClick={() => (account.signedIn ? setMenuOpen((o) => !o) : go("settings"))}
            aria-haspopup="menu"
            aria-expanded={account.signedIn ? menuOpen : undefined}
            title={account.signedIn ? `${account.displayName} — account` : "Sign in"}
            aria-label={
              account.signedIn ? `${account.displayName} — account` : "Account — sign in"
            }
            className="grid h-[38px] w-[38px] place-items-center rounded-full border-[1.5px] border-primary/50 bg-[radial-gradient(120%_120%_at_50%_25%,#1a2742,#0c1424)] font-bold text-fg-muted transition hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Avatar account={account} size={38} />
          </button>
          {menuOpen && account.signedIn && (
            <AccountMenu
              className="absolute bottom-[52px] left-1 right-1 z-50"
              onClose={() => setMenuOpen(false)}
              onSettings={() => go("settings")}
              onSearch={openPalette}
              onSignOut={signOut}
              account={account}
              auth={auth}
            />
          )}
        </div>
      ) : (
        <div className="border-t border-border pt-2.5">
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => (account.signedIn ? setMenuOpen((o) => !o) : go("settings"))}
              aria-haspopup="menu"
              aria-expanded={account.signedIn ? menuOpen : undefined}
              aria-label={
                account.signedIn ? `${account.displayName} — account` : "Account — sign in"
              }
              className="flex w-full items-center gap-[11px] rounded-[var(--radius)] px-1 py-1 text-left transition hover:bg-white/[0.045] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border-[1.5px] border-primary/50 bg-[radial-gradient(120%_120%_at_50%_25%,#1a2742,#0c1424)]">
                <Avatar account={account} size={40} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold leading-tight text-fg">
                  {account.displayName}
                </span>
                {/* No role line at all when the user hasn't set one — never a
                    fabricated title (decision 6/7). Signed out: the prompt. */}
                {(account.role ?? (account.signedIn ? account.email : "Sign in to sync")) && (
                  <span className="mt-0.5 block truncate text-[11px] font-medium leading-snug text-fg-muted">
                    {account.role ?? (account.signedIn ? account.email : "Sign in to sync")}
                  </span>
                )}
              </span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
                className="shrink-0 text-fg-faint"
              >
                <path
                  d="M6 9.5l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {menuOpen && account.signedIn && (
              <AccountMenu
                className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-50"
                onClose={() => setMenuOpen(false)}
                onSettings={() => go("settings")}
                onSearch={openPalette}
                onSignOut={signOut}
                account={account}
                auth={auth}
              />
            )}
          </div>

          {/* The three locked account utilities. Settings lives HERE, not in
              the rail list above (V5.0 §1). */}
          <div className="relative mt-2.5 flex gap-2">
            {/* Notifications has no producer yet, so it shows an honest empty
                state and NO unread dot — the mockup's red dot is fixture
                content (decision 7: never fabricate). Wire the dot up when a
                real notification source exists. */}
            <UtilityButton
              icon="utility-notifications"
              label="Notifications"
              active={notifOpen}
              onClick={() => setNotifOpen((o) => !o)}
            />
            {notifOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close notifications"
                  onClick={() => setNotifOpen(false)}
                  className="fixed inset-0 z-40 cursor-default"
                />
                <div
                  role="status"
                  className="glass-raised absolute bottom-[calc(100%+8px)] left-0 right-0 z-50 rounded-lg border border-border-strong p-3 shadow-[var(--shadow-lg)]"
                >
                  <p className="text-[12px] font-bold text-fg">No notifications</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                    Alerts about your account and long-running preparation will
                    appear here.
                  </p>
                </div>
              </>
            )}
            <UtilityButton
              icon="utility-settings"
              label="Settings"
              active={view === "settings"}
              onClick={() => go("settings")}
            />
            <UtilityButton
              icon="utility-sign-out"
              label={account.signedIn ? "Sign out" : "Sign in"}
              onClick={() => (account.signedIn ? signOut() : go("settings"))}
            />
          </div>
        </div>
      )}
    </nav>
  );
}

/** Approved photo when one exists, otherwise the account-initials monogram —
 *  never a stock face (decision 6). */
function Avatar({
  account,
  size,
}: {
  account: ReturnType<typeof useAccount>["account"];
  size: number;
}) {
  if (account.avatarUrl) {
    return (
      <img
        src={account.avatarUrl}
        alt=""
        aria-hidden
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="font-sans font-extrabold leading-none text-fg-muted"
      style={{ fontSize: Math.round(size * 0.36) }}
    >
      {account.initials}
    </span>
  );
}

function UtilityButton({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: "utility-notifications" | "utility-settings" | "utility-sign-out";
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        "grid h-[34px] flex-1 place-items-center rounded-[var(--radius)] border bg-panel transition",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        active
          ? "border-border-strong text-primary"
          : "border-border text-fg-muted hover:text-fg",
      ].join(" ")}
    >
      <LockedIcon name={icon} size={18} />
    </button>
  );
}

/**
 * The account popover. Carries the identity detail V5.0 keeps out of the rail
 * row itself, plus ⌘K — the command palette lost its rail row when the rail
 * became exactly six destinations, so this is its discoverable home (the
 * global ⌘K shortcut is unchanged).
 */
function AccountMenu({
  className,
  account,
  auth,
  onClose,
  onSettings,
  onSearch,
  onSignOut,
}: {
  className: string;
  account: ReturnType<typeof useAccount>["account"];
  auth: import("@/lib/ipc").AuthStatus | null;
  onClose: () => void;
  onSettings: () => void;
  onSearch: () => void;
  onSignOut: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close account menu"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        role="menu"
        className={`glass-raised rounded-lg border border-border-strong p-1.5 shadow-[var(--shadow-lg)] ${className}`}
      >
        <p className="truncate px-2 pb-1 pt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.06em] text-fg-faint">
          {account.email ?? account.displayName}
        </p>
        {auth?.last_sign_in_at && (
          <p className="truncate px-2 pb-1 font-mono text-[10px] text-ok">
            Signed in · {formatLastSignIn(auth.last_sign_in_at)}
          </p>
        )}
        <span className="mx-1 mb-1 block h-px bg-border" aria-hidden />
        <MenuRow icon={<Icon name="search" size={16} />} label="Search everything (⌘K)" onClick={onSearch} />
        <MenuRow icon={<LockedIcon name="utility-settings" size={16} />} label="Settings" onClick={onSettings} />
        <MenuRow icon={<LockedIcon name="utility-sign-out" size={16} />} label="Sign out" onClick={onSignOut} />
      </div>
    </>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[5px] px-1.5 py-1.5 text-left text-[11px] font-semibold text-fg-muted transition hover:bg-panel-raised/70 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {icon}
      {label}
    </button>
  );
}
