import { useEffect, useState } from "react";

import { Section, ViewShell } from "@/components/studio/ViewShell";
import { Icon, type IconName } from "@/components/ui/Icon";
import { authStatus } from "@/lib/commands";
import { BUILD } from "@/lib/debug";
import { isTauri, type AuthStatus } from "@/lib/ipc";
import { useNavStore, type View } from "@/state/nav";

/** First letter of the email, for a simple monogram avatar. */
function initial(email: string | null): string {
  return (email?.trim()?.[0] ?? "?").toUpperCase();
}

function QuickLink({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: IconName;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-xl border border-border bg-panel-raised/40 p-3.5 text-left transition hover:border-border-strong hover:bg-panel-raised/70"
    >
      <span
        className="brand-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-inbound"
        aria-hidden
      >
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold tracking-tight text-fg">
          {title}
        </span>
        <span className="block truncate text-[11px] text-fg-faint">{desc}</span>
      </span>
      <Icon
        name="chevron"
        size={16}
        className="text-fg-faint transition group-hover:translate-x-0.5 group-hover:text-fg-muted"
      />
    </button>
  );
}

/**
 * Dashboard / home — the signed-in landing surface for both desktop and web.
 * Basic by design: who you are, your access, and quick jumps into the product.
 * Auth data comes from the shell (`authStatus`); on the web (no shell yet) it
 * shows a truthful signed-out state.
 */
export function DashboardView() {
  const setView = useNavStore((s) => s.setView);
  const go = (v: View) => () => setView(v);
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void authStatus()
      .then(setAuth)
      .catch(() => setAuth(null));
  }, []);

  const signedIn = auth?.signed_in ?? false;

  return (
    <ViewShell
      icon="system"
      title="Home"
      subtitle="Your conva account and quick access to the product."
    >
      {/* Profile / access card. */}
      <Section>
        <div className="flex items-center gap-4">
          <span
            className="brand-ring flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold text-inbound"
            aria-hidden
          >
            {signedIn ? initial(auth?.email ?? null) : <Icon name="account" size={24} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-extrabold tracking-tight text-fg">
                {signedIn ? (auth?.email ?? "Signed in") : "Welcome to conva"}
              </h3>
              <span className="inline-flex items-center rounded-full border border-outbound/34 bg-outbound/[0.14] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--voice-you-text)]">
                Beta · invite
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-fg-faint">
              {signedIn
                ? "You're signed in. Your preferences and library travel with your account."
                : "Sign in to sync your profile, preferences, and library across desktop and web."}
            </p>
          </div>
          {!signedIn && (
            <button
              type="button"
              onClick={go("settings")}
              className="shrink-0 rounded-lg border border-border-strong bg-panel-raised px-3 py-1.5 text-xs font-semibold text-fg transition hover:brightness-110"
            >
              Sign in
            </button>
          )}
        </div>
      </Section>

      {/* Quick links into the product + market-facing surfaces. */}
      <Section title="Jump in">
        <div className="grid gap-3 sm:grid-cols-2">
          <QuickLink
            icon="live"
            title="Start a live session"
            desc="Transcribe a call and ask Ally inline"
            onClick={go("live")}
          />
          <QuickLink
            icon="library"
            title="Your library"
            desc="Add documents Ally answers from"
            onClick={go("library")}
          />
          <QuickLink
            icon="book"
            title="What conva does"
            desc="The full feature list"
            onClick={go("features")}
          />
          <QuickLink
            icon="lightbulb"
            title="What's coming"
            desc="A private preview of the roadmap"
            onClick={go("whatsnew")}
          />
        </div>
      </Section>

      <p className="px-1 text-[11px] text-fg-faint">
        Build {BUILD.sha}
      </p>
    </ViewShell>
  );
}
