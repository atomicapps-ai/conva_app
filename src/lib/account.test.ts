import { describe, expect, it } from "vitest";

import {
  accountInitials,
  formatLastSignIn,
  greetingFor,
  resolveAccount,
  SIGNED_IN_FALLBACK_NAME,
  SIGNED_OUT_NAME,
} from "@/lib/account";
import type { AuthStatus } from "@/lib/ipc";

function auth(over: Partial<AuthStatus> = {}): AuthStatus {
  return {
    signed_in: true,
    email: "maya.chen@example.com",
    user_id: "u1",
    expires_at_unix: null,
    last_sign_in_at: null,
    configured: true,
    ...over,
  };
}

describe("accountInitials", () => {
  it("takes first + last word of a display name", () => {
    expect(accountInitials("Maya Chen", null)).toBe("MC");
    expect(accountInitials("ada lovelace", null)).toBe("AL");
  });

  it("uses first + last of a three-part name, not the middle", () => {
    expect(accountInitials("Ana Maria Silva", null)).toBe("AS");
  });

  it("returns a single letter for a one-word name", () => {
    expect(accountInitials("Prince", null)).toBe("P");
  });

  it("falls back to the email local part when there is no name", () => {
    expect(accountInitials(null, "maya.chen@example.com")).toBe("MC");
    expect(accountInitials("   ", "jules@example.com")).toBe("J");
  });

  it("treats dots, underscores, hyphens and plus as separators", () => {
    expect(accountInitials(null, "maya_chen+beta@example.com")).toBe("MB");
    expect(accountInitials("Jean-Luc", null)).toBe("JL");
  });

  it("handles non-latin scripts", () => {
    expect(accountInitials("Ana Ćirić", null)).toBe("AĆ");
  });

  it("returns ? when there is nothing to work from", () => {
    expect(accountInitials(null, null)).toBe("?");
    expect(accountInitials("", "")).toBe("?");
    expect(accountInitials("!!! ???", null)).toBe("?");
  });
});

describe("resolveAccount", () => {
  it("prefers the user's own profile name and role", () => {
    const a = resolveAccount(auth(), { displayName: "Maya Chen", role: "Senior Product Manager" });
    expect(a.signedIn).toBe(true);
    expect(a.displayName).toBe("Maya Chen");
    expect(a.role).toBe("Senior Product Manager");
    expect(a.initials).toBe("MC");
  });

  it("falls back to the email local part for the name, and shows NO role", () => {
    const a = resolveAccount(auth(), null);
    expect(a.displayName).toBe("maya.chen");
    // Never invent a job title — decision 7 (no fabricated data) applies to
    // identity too.
    expect(a.role).toBeNull();
    expect(a.initials).toBe("MC");
  });

  it("uses a generic label when signed in with no email at all", () => {
    const a = resolveAccount(auth({ email: null }), null);
    expect(a.displayName).toBe(SIGNED_IN_FALLBACK_NAME);
    expect(a.initials).toBe("?");
  });

  it("reports the signed-out state without leaking identity", () => {
    const a = resolveAccount(auth({ signed_in: false }), {
      displayName: "Maya Chen",
      role: "Senior Product Manager",
      avatarUrl: "https://example.com/a.png",
    });
    expect(a.signedIn).toBe(false);
    expect(a.role).toBeNull();
    expect(a.avatarUrl).toBeNull();
    expect(a.initials).toBe("?");
  });

  it("handles a null auth status (backend unavailable)", () => {
    const a = resolveAccount(null, null);
    expect(a.signedIn).toBe(false);
    expect(a.displayName).toBe(SIGNED_OUT_NAME);
  });

  it("passes an approved photo through when one exists", () => {
    const a = resolveAccount(auth(), { displayName: "Maya Chen", role: null, avatarUrl: "blob:x" });
    expect(a.avatarUrl).toBe("blob:x");
  });

  it("treats whitespace-only profile fields as unset", () => {
    const a = resolveAccount(auth(), { displayName: "  ", role: "  " });
    expect(a.displayName).toBe("maya.chen");
    expect(a.role).toBeNull();
  });
});

describe("formatLastSignIn", () => {
  it("says 'today' with a time for today", () => {
    const now = new Date();
    expect(formatLastSignIn(now.toISOString())).toMatch(/^today /);
  });

  it("says 'yesterday' for yesterday", () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    expect(formatLastSignIn(d.toISOString())).toMatch(/^yesterday /);
  });

  it("returns an em dash for null or unparseable input", () => {
    expect(formatLastSignIn(null)).toBe("—");
    expect(formatLastSignIn("not-a-date")).toBe("—");
  });
});

describe("greetingFor", () => {
  it("splits morning / afternoon / evening", () => {
    expect(greetingFor(new Date(2026, 8, 2, 9, 0))).toBe("Good morning");
    expect(greetingFor(new Date(2026, 8, 2, 13, 0))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 8, 2, 21, 0))).toBe("Good evening");
  });

  it("treats noon as afternoon and midnight as morning", () => {
    expect(greetingFor(new Date(2026, 8, 2, 12, 0))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 8, 2, 0, 0))).toBe("Good morning");
  });
});
