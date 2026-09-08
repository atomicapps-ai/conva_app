import { useState } from "react";

import mark from "@/assets/brand/conva-mark-cutout-white.svg";
import * as webAuth from "@/lib/backend/webAuth";
import { useNavStore } from "@/state/nav";

/*
 * The TOP band of the web experience: the core WEBSITE navigation, rendered by
 * the app so it's always present above the app's own icon nav (owner spec:
 * "top level = core website links, below that = app navigation icons").
 *
 * These are links to the marketing/account site (conva_web). The app is served
 * same-origin at /app/ (no iframe), so the site is simply this origin.
 */
const SITE_ORIGIN = typeof window !== "undefined" ? window.location.origin : "";

const site = (path: string) => `${SITE_ORIGIN}${path}`;

const LINKS = [
  { label: "Product", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Beta", href: "/#join" },
];

export function WebSiteNav() {
  const email = webAuth.status().email;
  const initial = (email?.trim()?.[0] ?? "?").toUpperCase();
  const setView = useNavStore((s) => s.setView);
  const [avatarBroken, setAvatarBroken] = useState(false);

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-5 border-b border-border bg-panel-raised px-4">
      <a
        href={site("/")}
        target="_top"
        aria-label="conva home"
        className="flex items-center gap-2 text-fg no-underline"
      >
        <img src={mark} alt="" className="h-[22px] w-[22px]" draggable={false} />
        <span className="text-[15px] font-extrabold tracking-tight">conva</span>
      </a>

      <nav aria-label="Site" className="flex items-center gap-4 text-sm">
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={site(l.href)}
            target="_top"
            className="text-fg-muted no-underline transition hover:text-fg"
          >
            {l.label}
          </a>
        ))}
      </nav>

      <span className="ml-auto" />

      {/* Account access — opens the app's own Profile view (ProfileView.tsx),
          not the retired marketing-site account.html (that page runs a
          separate, disconnected auth flow — see conva_web's account.html /
          scripts/auth.js — and doesn't reflect this session at all). */}
      <button
        type="button"
        onClick={() => setView("profile")}
        title={email ?? "Your account"}
        aria-label="Your account"
        className="grid h-8 w-8 place-items-center rounded-full text-sm font-extrabold text-bg transition hover:brightness-110"
      >
        {avatarBroken ? (
          <span className="brand-gradient grid h-8 w-8 place-items-center rounded-full">{initial}</span>
        ) : (
          <img
            src={webAuth.avatarUrl()}
            onError={() => setAvatarBroken(true)}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        )}
      </button>
    </header>
  );
}
