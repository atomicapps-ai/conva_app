import { describe, expect, it } from "vitest";

import {
  backupSentence,
  clearResume,
  deleteErrorCode,
  emailMatches,
  friendlyDeleteError,
  hasResume,
  isFreshSignIn,
  markResume,
  RESUME_KEY,
} from "@/lib/accountDeletion";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function memory(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe("account deletion helpers", () => {
  it("treats a sign-in under four minutes old as fresh, and nothing else", () => {
    expect(isFreshSignIn(ago(30_000), NOW)).toBe(true);
    expect(isFreshSignIn(ago(3 * 60_000), NOW)).toBe(true);
    expect(isFreshSignIn(ago(4 * 60_000 + 1), NOW)).toBe(false);
    expect(isFreshSignIn(ago(60 * 60_000), NOW)).toBe(false);
    expect(isFreshSignIn(null, NOW)).toBe(false);
    expect(isFreshSignIn("not a date", NOW)).toBe(false);
    expect(isFreshSignIn(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe(false); // wrong clock
  });

  it("matches the typed email ignoring case and spaces, and never matches a missing email", () => {
    expect(emailMatches("  Alice@Example.COM ", "alice@example.com")).toBe(true);
    expect(emailMatches("alice@example.com", "bob@example.com")).toBe(false);
    expect(emailMatches("", "alice@example.com")).toBe(false);
    expect(emailMatches("anything", null)).toBe(false);
  });

  it("names a backup window only when it is known", () => {
    expect(backupSentence(null)).toBeNull();
    expect(backupSentence(7)).toBe("Backups kept by our database host can hold copies for up to 7 more days.");
    expect(backupSentence(1)).toMatch(/1 more day\./);
  });

  it("turns whatever a backend rejected with into a stable code, never a raw message", () => {
    expect(deleteErrorCode("recent_sign_in_required")).toBe("recent_sign_in_required");
    expect(deleteErrorCode(new Error("storage_cleanup_failed"))).toBe("storage_cleanup_failed");
    expect(deleteErrorCode(new Error("relation hbxftjyooblxiiapaeei.documents missing"))).toBe("upstream");
    expect(deleteErrorCode(undefined)).toBe("upstream");
    for (const c of ["recent_sign_in_required", "signed_out", "quota_exceeded", "unprovisioned", "storage_cleanup_failed", "network", "upstream"] as const) {
      expect(friendlyDeleteError(c).length).toBeGreaterThan(20);
    }
    expect(friendlyDeleteError("unprovisioned")).toMatch(/nothing was deleted/);
    expect(friendlyDeleteError("storage_cleanup_failed")).toMatch(/nothing was deleted/);
  });

  it("remembers that a deletion was in progress across the sign-in redirect, for ten minutes", () => {
    const s = memory();
    expect(hasResume(NOW, s)).toBe(false);
    markResume(NOW, s);
    expect(s.m.has(RESUME_KEY)).toBe(true);
    expect(hasResume(NOW + 5 * 60_000, s)).toBe(true);
    expect(hasResume(NOW + 11 * 60_000, s)).toBe(false);
    clearResume(s);
    expect(hasResume(NOW, s)).toBe(false);
  });

  it("survives storage that throws (private windows): no resume, no crash", () => {
    const broken = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(() => markResume(NOW, broken)).not.toThrow();
    expect(hasResume(NOW, broken)).toBe(false);
    expect(() => clearResume(broken)).not.toThrow();
  });
});
