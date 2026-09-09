import { useState } from "react";

// This file is small enough that Vite inlines it as a `data:` URI rather
// than emitting a real file (a `?url` suffix does NOT change that here —
// verified empirically). That matters because the encoder Vite uses for
// that inlining escapes `<`/`>`/`#`/quotes but NOT parentheses — and the
// SVG source used to carry a stray, unmatched `)` (an Adobe Illustrator
// export comment, "...Build 11)"). Used inside `mask-image: url(...)`,
// that raw `)` terminated the CSS url() token early and corrupted it, so
// the mask silently failed to load and the browser just painted a plain
// `currentColor` box — confirmed live: that's exactly the solid square
// the logo was rendering as instead of the masked mark. Fixed at the
// source: the .svg file no longer carries that comment (or any other
// content with an unescaped special character) — see its own history.
import mark from "@/assets/brand/conva-mark-cutout-white.svg";
import { LockedWordmark } from "@/components/ui/LockedIcon";
import { isOperatorEmail } from "@/lib/account";
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

// Mirrors conva_web's real header nav (index.html: "How it works | About |
// Download") — these must stay in lockstep with that markup, hrefs included.
const SITE_LINKS = [
  { label: "How it works", href: "/how-it-works.html" },
  { label: "About", href: "/about.html" },
  { label: "Download", href: "/download.html" },
];

export function WebSiteNav() {
  const email = webAuth.status().email;
  const initial = (email?.trim()?.[0] ?? "?").toUpperCase();
  const setView = useNavStore((s) => s.setView);
  const view = useNavStore((s) => s.view);
  const [avatarBroken, setAvatarBroken] = useState(false);

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-5 border-b border-border bg-panel-raised px-4">
      <a
        href={site("/")}
        target="_top"
        aria-label="conva home"
        className="flex items-center gap-2 text-fg no-underline"
      >
        {/* Same technique as the site's `.mark` class (conva_web/CLAUDE.md
            "The mark"): a currentColor CSS mask over the white cutout SVG,
            never an <img> — an <img> can't be recolored/theme-flipped. */}
        <span
          aria-hidden="true"
          className="h-[22px] w-[22px] shrink-0 bg-current"
          style={{
            WebkitMaskImage: `url(${mark})`,
            maskImage: `url(${mark})`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
        <LockedWordmark width={72} />
      </a>

      <nav aria-label="Site" className="flex min-w-0 items-center gap-4 text-sm">
        {/* My Account leads the link group (owner mockup) — same destination
            as the avatar button, just reachable without spotting the avatar. */}
        <button
          type="button"
          onClick={() => setView("profile")}
          aria-current={view === "profile" ? "page" : undefined}
          className={[
            "hidden no-underline transition md:block",
            view === "profile" ? "text-fg" : "text-fg-muted hover:text-fg",
          ].join(" ")}
        >
          My Account
        </button>
        {SITE_LINKS.map((l) => (
          <a
            key={l.href}
            href={site(l.href)}
            target="_top"
            className="text-fg-muted no-underline transition hover:text-fg"
          >
            {l.label}
          </a>
        ))}
        {isOperatorEmail(email) && (
          <a
            href={site("/ops.html")}
            target="_top"
            className="hidden text-fg-muted no-underline transition hover:text-fg md:block"
          >
            Admin
          </a>
        )}
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
