import mark from "@/assets/brand/conva-mark-cutout-white.svg";
import { NAV_ITEMS } from "@/components/studio/navItems";
import * as webAuth from "@/lib/backend/webAuth";
import { useNavStore } from "@/state/nav";

/*
 * The web shell's top navigation (web-only). Replaces the desktop left rail:
 * conva mark, the view tabs, and the account monogram — a standard web app bar.
 * Uses the shared NAV_ITEMS so it stays in sync with the desktop rail.
 */

// Shorter labels for a horizontal bar (the rail can afford the long ones).
const SHORT: Partial<Record<string, string>> = {
  features: "Features",
  whatsnew: "Roadmap",
};

const ITEMS = NAV_ITEMS.filter((i) => !i.only || i.only === "web");

export function WebTopNav() {
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const email = webAuth.status().email;
  const initial = (email?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-panel px-4">
      <img
        src={mark}
        alt="conva"
        title="conva"
        draggable={false}
        className="mr-3 h-[26px] w-[26px]"
      />

      <nav aria-label="Primary" className="flex items-center gap-0.5">
        {ITEMS.map((item) => {
          const active = view === item.view;
          return (
            <button
              key={item.view}
              type="button"
              onClick={() => setView(item.view)}
              aria-current={active ? "page" : undefined}
              className={[
                "rounded-lg px-3 py-1.5 text-sm font-semibold tracking-tight transition",
                active
                  ? "bg-panel-raised text-fg"
                  : "text-fg-muted hover:bg-panel-raised/50 hover:text-fg",
              ].join(" ")}
            >
              {SHORT[item.view] ?? item.label}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setView("profile")}
          title={email ?? "Your account"}
          aria-label="Your account"
          className={[
            "brand-gradient grid h-8 w-8 place-items-center rounded-full text-sm font-extrabold text-bg transition hover:brightness-110",
            view === "profile" ? "ring-2 ring-inbound ring-offset-2 ring-offset-panel" : "",
          ].join(" ")}
        >
          {initial}
        </button>
      </div>
    </header>
  );
}
