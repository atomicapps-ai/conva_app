# Settings: Usage/Subscription split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Settings → Ally's "Usage" section into its own top-level
"Usage" category (unchanged content plus a new real "time listening"
row), and add a new, fully mocked "Subscription" category (Free →
"Conva Membership" plan preview + a decorative Stripe-style card form).

**Architecture:** A new `listening_ms` counter joins `UsageLedger` in
`crates/conva-core/src/metering.rs` (pure, unit-tested) exactly like its
existing `tavily_searches`/`tts_characters` counters, fed from a shell
wrapper in `src-tauri/src/metering.rs` called once from `stop_session` in
`src-tauri/src/lib.rs` using `SessionManager`'s already-tracked
`session_started_ms()`. The TS mirror (`src/lib/ipc.ts`) picks up the new
field with no new Tauri command (existing `usage_summary`/`usage_reset`
already return the whole struct). Two new `SettingsGroup` ids extend
`src/components/settingsNav.ts`; `SettingsPanel.tsx` relocates the
existing `UsageSettings` section under the new "usage" group and wires in
a brand-new, self-contained `SubscriptionSettings` component (client
state only, no backend, no persistence — a real mock, not a stub of a
real feature).

**Tech Stack:** Rust (conva-core pure crate + Tauri shell), React 19 +
TypeScript, Vitest + Testing Library, `cargo test`.

---

### Task 1: Core — `listening_ms` usage counter

**Files:**
- Modify: `crates/conva-core/src/metering.rs`

- [ ] **Step 1: Write the failing tests**

Add these three tests to the `#[cfg(test)] mod tests` block at the bottom
of `crates/conva-core/src/metering.rs` (insert after the existing
`tavily_searches_count_and_ignore_zero` test, around line 403):

```rust
    #[test]
    fn listening_ms_accumulates_and_ignores_zero() {
        let mut led = UsageLedger::default();
        led.record_listening_ms(0, 1);
        assert_eq!(led.listening_ms, 0);
        assert_eq!(
            led.since_unix_ms, 0,
            "a zero duration must not open the window"
        );
        led.record_listening_ms(90_000, 5);
        led.record_listening_ms(30_000, 6);
        assert_eq!(led.listening_ms, 120_000);
        assert_eq!(led.since_unix_ms, 5);
    }

    #[test]
    fn deserializes_ledger_missing_listening_ms_as_zero() {
        // Every UsageLedger field already carries #[serde(default)], so an
        // old usage.json predating this field parses cleanly.
        let led: UsageLedger = serde_json::from_str("{}").unwrap();
        assert_eq!(led.listening_ms, 0);
    }
```

Also extend the existing `reset_clears_everything_and_reopens` test
(around line 406) to cover the new field — change it to:

```rust
    fn reset_clears_everything_and_reopens() {
        let mut led = UsageLedger::default();
        led.record_llm(
            "ally_question",
            ProviderId::Anthropic,
            "claude-sonnet-5",
            tok(1, 1),
            true,
            1,
        );
        led.record_tavily_search(4, 2);
        led.record_tts_characters(120, 3);
        led.record_listening_ms(90_000, 4);
        assert_eq!(led.tts_characters, 120);
        led.reset(50);
        assert!(led.providers.is_empty());
        assert!(led.llm_features.is_empty());
        assert_eq!(led.tavily_searches, 0);
        assert_eq!(led.tts_characters, 0);
        assert_eq!(led.listening_ms, 0);
        assert_eq!(led.since_unix_ms, 50);
        assert_eq!(led.updated_at_unix_ms, 50);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p conva-core --lib metering`
Expected: FAIL to compile — `record_listening_ms` and `listening_ms` don't
exist yet on `UsageLedger`.

- [ ] **Step 3: Add the field**

In `crates/conva-core/src/metering.rs`, in `pub struct UsageLedger` (around
line 78), add the new field right after `tts_characters`:

```rust
    /// Text-to-speech characters synthesized (Deepgram Aura bills per character).
    #[serde(default)]
    pub tts_characters: u64,
    /// Total time an active session (Live or rehearsal) has run, summed
    /// across every stop — best-effort; a session ended by a crash or
    /// force-quit isn't counted, same trade-off as every other counter here.
    #[serde(default)]
    pub listening_ms: u64,
```

- [ ] **Step 4: Add the `record_listening_ms` method**

In `impl UsageLedger` (around line 168), add this right after
`record_tts_characters` and before `reset`:

```rust
    /// Add `ms` of listening time (Live or rehearsal). No-ops on `ms == 0`
    /// (mirrors `record_tavily_search`/`record_tts_characters`).
    pub fn record_listening_ms(&mut self, ms: u64, now_unix_ms: u64) {
        if ms == 0 {
            return;
        }
        self.start_window(now_unix_ms);
        self.listening_ms = self.listening_ms.saturating_add(ms);
    }
```

- [ ] **Step 5: Thread it through `summary()` and `UsageSummary`**

In `UsageLedger::summary()` (around line 197), add `listening_ms` to the
constructed `UsageSummary`:

```rust
        UsageSummary {
            providers: self.providers.clone(),
            llm_features,
            total_input_tokens,
            total_output_tokens,
            total_requests,
            tavily_searches: self.tavily_searches,
            tts_characters: self.tts_characters,
            listening_ms: self.listening_ms,
            since_unix_ms: self.since_unix_ms,
            updated_at_unix_ms: self.updated_at_unix_ms,
        }
```

In `pub struct UsageSummary` (around line 213), add the field:

```rust
    pub tavily_searches: u64,
    pub tts_characters: u64,
    pub listening_ms: u64,
    pub since_unix_ms: u64,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cargo test -p conva-core --lib metering`
Expected: PASS — all metering tests green, including the three new/changed
ones.

- [ ] **Step 7: Full core gate + commit**

Run: `cargo fmt --check && cargo clippy -p conva-core --all-targets && cargo test -p conva-core`
Expected: clean.

```bash
git add crates/conva-core/src/metering.rs
git commit -m "feat(metering): add listening_ms usage counter to UsageLedger

New record_listening_ms method + field, mirroring the existing
record_tavily_search/record_tts_characters pattern exactly. Not yet
wired to anything — the shell call site is the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GiKzMingp6q12HJcuxRSZp"
```

---

### Task 2: Shell — wire `stop_session` to record listening time

**Files:**
- Modify: `src-tauri/src/metering.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the shell wrapper**

In `src-tauri/src/metering.rs`, add this right after `record_tts_characters`
(around line 182), matching its exact shape:

```rust
/// Add `ms` of listening time (Live or rehearsal), then persist. Best-effort.
pub fn record_listening_ms(app: &AppHandle, ms: u64) {
    let state = app.state::<AppState>();
    let mut ledger = state.usage.lock().expect("usage lock");
    ledger.record_listening_ms(ms, now_unix_ms());
    persist(app, &ledger);
}
```

- [ ] **Step 2: Call it from `stop_session`**

In `src-tauri/src/lib.rs`, `stop_session` (around line 332) currently reads:

```rust
#[tauri::command]
async fn stop_session(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Deactivate any conversation-context highlight terms (Phase 3c) and
    // retrieval scope (session grounding) — a stopped session always returns
    // to the unscoped default.
    clear_active_context(&state);
    state.session.stop(&app).map_err(|e| e.to_string())
}
```

Change it to:

```rust
#[tauri::command]
async fn stop_session(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Deactivate any conversation-context highlight terms (Phase 3c) and
    // retrieval scope (session grounding) — a stopped session always returns
    // to the unscoped default.
    clear_active_context(&state);
    // Meter the time this session ran (best-effort; session_started_ms is 0
    // if a session was never actually started).
    let started = state.session.session_started_ms();
    if started > 0 {
        let elapsed = session::now_unix_ms().saturating_sub(started);
        metering::record_listening_ms(&app, elapsed);
    }
    state.session.stop(&app).map_err(|e| e.to_string())
}
```

`session::now_unix_ms()` (module-qualified — `lib.rs` doesn't import it
bare, unlike `metering.rs`; the same qualified call already appears at
`lib.rs:550`) and `state.session.session_started_ms()` both already exist
— no new imports needed.

- [ ] **Step 3: Compile-verify**

This sandbox can't compile the Windows-only shell crate (cpal/WASAPI deps)
— per this branch's established pattern, the shell half of a change is
compile-verified by CI's Windows job on push, not locally. Read back both
diffs once against the exact snippets above to catch a typo before
committing (a missing `session::` qualifier or a wrong field name is the
kind of thing that would only surface in CI otherwise).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/metering.rs src-tauri/src/lib.rs
git commit -m "feat(metering): record listening_ms on stop_session

Wires the new UsageLedger counter to the one place a session actually
ends (covers both a normal Live session and a rehearsal — both go
through this same stop_session command). Uses SessionManager's
already-tracked session_started_ms(), nothing new to track.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GiKzMingp6q12HJcuxRSZp"
```

---

### Task 3: TypeScript mirror — `UsageSummary.listening_ms`

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add the field**

In `src/lib/ipc.ts`, `export interface UsageSummary` (around line 498),
add the field between `tts_characters` and `since_unix_ms`:

```ts
  /** TTS characters synthesized (Aura bills per character). */
  tts_characters: number;
  /** Milliseconds an active session (Live or rehearsal) has run, summed
   *  across every stop. */
  listening_ms: number;
  /** When the current window opened (first record / last reset); 0 = never. */
  since_unix_ms: number;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: clean — nothing currently constructs a `UsageSummary` object
literal (both `tauri.ts` and `web.ts` pass it through generically), so
this is a pure additive change with no other call sites to fix yet.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "feat(ipc): mirror UsageSummary.listening_ms

TS side of the new metering field from the previous two commits.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GiKzMingp6q12HJcuxRSZp"
```

---

### Task 4: Settings IA — new `usage`/`subscription` groups

**Files:**
- Modify: `src/components/settingsNav.ts`
- Modify: `src/components/settingsNav.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/components/settingsNav.test.ts`, the `describe("SETTINGS_GROUPS")`
block's first test currently reads:

```ts
  it("is exactly the five approved groups, in order", () => {
    expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual([
      "Account",
      "Devices",
      "Transcription",
      "Ally",
      "Privacy",
    ]);
  });
```

Change it to:

```ts
  it("is exactly the seven approved groups, in order", () => {
    expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual([
      "Account",
      "Devices",
      "Transcription",
      "Ally",
      "Usage",
      "Subscription",
      "Privacy",
    ]);
  });
```

(Every other test in this file — `groupForKey`'s wrap/Home/End cases,
`toSettingsGroup`'s fallback — references only `account`, `devices`,
`transcription`, `ally`, or `privacy`, and Privacy stays last, Account
stays first, so none of them need to change. Verify that's still true
after Step 2 by re-reading the file; don't skip this check.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settingsNav.test.ts`
Expected: FAIL — `SETTINGS_GROUPS` only has 5 entries today.

- [ ] **Step 3: Add the two groups**

Replace the whole top of `src/components/settingsNav.ts` (through the
`SETTINGS_GROUPS` export, roughly lines 1–29) with:

```ts
/**
 * Settings' left sub-nav — AppUI V5.0 §8.
 *
 * > Settings is not a rail row — it opens from the **gear** in the account
 * > utility row below [the user]. No nav row is active while on Settings.
 * > …Account, devices, transcription, Ally, privacy.
 *
 * Seven groups, in that order (Usage and Subscription split out of Ally,
 * 2026-09-03). Every pre-V5 Settings section is mapped onto one of them —
 * nothing was dropped in the reorganisation, and this table is the record
 * of where each went, so a future section has an obvious home:
 *
 * | Group         | Sections it owns                                          |
 * | ------------- | --------------------------------------------------------- |
 * | Account       | sign-in, display name + role                              |
 * | Devices       | microphone + system-audio device pickers                  |
 * | Transcription | engine, whisper model, noise filter                       |
 * | Ally          | providers & models, web research key                      |
 * | Usage         | usage counters (LLM tokens, searches, time listening)      |
 * | Subscription  | plan + billing (mocked — see SubscriptionSettings.tsx)    |
 * | Privacy       | portable secrets, settings file, about & extras           |
 */

export type SettingsGroup =
  | "account"
  | "devices"
  | "transcription"
  | "ally"
  | "usage"
  | "subscription"
  | "privacy";

export const SETTINGS_GROUPS: { id: SettingsGroup; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "devices", label: "Devices" },
  { id: "transcription", label: "Transcription" },
  { id: "ally", label: "Ally" },
  { id: "usage", label: "Usage" },
  { id: "subscription", label: "Subscription" },
  { id: "privacy", label: "Privacy" },
];
```

Everything below this point in the file (`DEFAULT_SETTINGS_GROUP`,
`toSettingsGroup`, `groupForKey`) is unchanged — they're already generic
over `SETTINGS_GROUPS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/settingsNav.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/components/settingsNav.ts src/components/settingsNav.test.ts
git commit -m "feat(settings): add Usage and Subscription groups

SettingsGroup grows from 5 to 7 entries, inserted between Ally (their
origin) and Privacy. Nothing renders under them yet — that's the next
two commits.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GiKzMingp6q12HJcuxRSZp"
```

---

### Task 5: `SubscriptionSettings` — new mocked component

**Files:**
- Create: `src/components/SubscriptionSettings.tsx`
- Create: `src/components/SubscriptionSettings.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/SubscriptionSettings.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SubscriptionSettings } from "@/components/SubscriptionSettings";

afterEach(cleanup);

describe("SubscriptionSettings", () => {
  it("shows Free as the current plan by default", () => {
    render(<SubscriptionSettings />);
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Current plan")).toBeInTheDocument();
    expect(screen.getByText("Conva Membership")).toBeInTheDocument();
    expect(screen.getByText("$7.99/mo")).toBeInTheDocument();
  });

  it("clicking Upgrade reveals the card form", () => {
    render(<SubscriptionSettings />);
    expect(screen.queryByText("Card number")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    expect(screen.getByText("Card number")).toBeInTheDocument();
  });

  it("saving a card flips to Conva Membership active with a masked number", () => {
    render(<SubscriptionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    fireEvent.change(screen.getByPlaceholderText("4242 4242 4242 4242"), {
      target: { value: "5555 4444 3333 2222" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save payment method" }));
    expect(screen.getByText("•••• 2222")).toBeInTheDocument();
    // Only one "Conva Membership" now — the standalone upgrade card is gone.
    expect(screen.getAllByText("Conva Membership")).toHaveLength(1);
  });

  it("downgrading returns to Free", () => {
    render(<SubscriptionSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    fireEvent.click(screen.getByRole("button", { name: "Save payment method" }));
    fireEvent.click(screen.getByRole("button", { name: "Downgrade to Free" }));
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Conva Membership")).toBeInTheDocument();
    expect(screen.getByText("$7.99/mo")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/SubscriptionSettings.test.tsx`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Write the component**

Create `src/components/SubscriptionSettings.tsx`:

```tsx
import { useState } from "react";

import { Icon } from "@/components/ui/Icon";

/** Trimmed to four bullets from the full candidate-inclusions list —
 *  conva_core/docs/product/conva-positioning-market-and-usage-pricing-
 *  strategy-2026-09.md §8.3 — enough to read as a real plan preview. */
const MEMBERSHIP_BULLETS = [
  "Desktop app access and updates",
  "Local audio capture + on-device transcription",
  "Local transcript and Context library",
  "AI usage at the lowest member rates",
];

/** Strip everything but digits and keep the last 4 — falls back to
 *  "4242" (Stripe's well-known test card) if the field was left empty, so
 *  the mock always shows something plausible without pretending to
 *  validate a real card number. */
function last4(cardNumber: string): string {
  const digits = cardNumber.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "4242";
}

/**
 * Settings → Subscription (owner, 2026-09-03: "mock the page, it doesn't
 * have to fully work"). Entirely client-side — no backend call, no
 * `AppConfig`/IPC field, nothing persisted; resets on restart. Payments
 * live only in the web app per the real design
 * (conva_core/docs/platform/04-billing-credits.md) — desktop deep-links out
 * to Stripe Checkout there, it never embeds a real card form. This is a
 * preview of that future flow, not an implementation of it.
 */
export function SubscriptionSettings() {
  const [plan, setPlan] = useState<"free" | "membership">("free");
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [savedLast4, setSavedLast4] = useState("4242");

  const upgrade = () => setShowCardForm(true);
  const save = () => {
    setSavedLast4(last4(cardNumber));
    setPlan("membership");
    setShowCardForm(false);
    setCardNumber("");
  };
  const downgrade = () => {
    setPlan("free");
    setShowCardForm(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-fg-muted">
        Preview only — nothing here charges a card or changes your account.
        Real billing lives on the web once it's ready.
      </p>

      <div className="rounded-lg border border-border bg-bg/40 p-3">
        {plan === "free" ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-fg">Free</span>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                Current plan
              </span>
            </div>
            <p className="mt-1 text-[11px] text-fg-faint">
              conva is free during the invite-only beta.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-fg">Conva Membership</span>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                Current plan
              </span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-fg-faint">
              •••• {savedLast4}
            </p>
            <button
              type="button"
              onClick={downgrade}
              className="mt-2 text-[11px] font-semibold text-fg-muted underline decoration-dotted hover:text-fg"
            >
              Downgrade to Free
            </button>
          </>
        )}
      </div>

      {plan === "free" && (
        <div className="rounded-lg border border-border bg-bg/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-[13px] font-bold text-fg">Conva Membership</span>
              <span className="ml-2 font-mono text-[12px] text-fg-muted">$7.99/mo</span>
            </div>
            {!showCardForm && (
              <button
                type="button"
                onClick={upgrade}
                className="btn btn-primary h-7 px-3 text-[12px]"
              >
                Upgrade
              </button>
            )}
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-[11px] text-fg-muted">
            {MEMBERSHIP_BULLETS.map((b) => (
              <li key={b} className="flex items-center gap-1.5">
                <Icon name="check" size={11} className="shrink-0 text-primary" />
                {b}
              </li>
            ))}
          </ul>

          {showCardForm && (
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              <label className="field">
                Name on card
                <input className="input" placeholder="Jane Doe" />
              </label>
              <label className="field">
                Card number
                <input
                  className="input font-mono"
                  placeholder="4242 4242 4242 4242"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <label className="field flex-1">
                  Expiry
                  <input className="input" placeholder="MM/YY" />
                </label>
                <label className="field flex-1">
                  CVC
                  <input className="input" placeholder="123" />
                </label>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={save}
                  className="btn btn-primary h-7 px-3 text-[12px]"
                >
                  Save payment method
                </button>
                <button
                  type="button"
                  onClick={() => setShowCardForm(false)}
                  className="text-[11px] text-fg-faint hover:text-fg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/SubscriptionSettings.test.tsx`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b`
Expected: clean.

```bash
git add src/components/SubscriptionSettings.tsx src/components/SubscriptionSettings.test.tsx
git commit -m "feat(settings): add mocked SubscriptionSettings component

Free -> Conva Membership (\$7.99/mo, real pricing-doc numbers) upgrade
preview with a decorative Stripe-style card form. Entirely client-side
state -- no backend call, no persistence, per the owner's 'mock it,
doesn't have to fully work.' Not yet wired into SettingsPanel.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GiKzMingp6q12HJcuxRSZp"
```

---

### Task 6: Wire it all into `SettingsPanel.tsx`

**Files:**
- Modify: `src/components/SettingsPanel.tsx`

- [ ] **Step 1: Import `SubscriptionSettings`**

Near the top of `src/components/SettingsPanel.tsx` (around line 3), the
import currently reads:

```ts
import { AllySettings } from "@/components/AllySettings";
```

Add a second import right after it:

```ts
import { AllySettings } from "@/components/AllySettings";
import { SubscriptionSettings } from "@/components/SubscriptionSettings";
```

- [ ] **Step 2: Add the "Time listening" row to `UsageSettings`**

In `UsageSettings` (around line 432), `hasUsage` currently reads:

```tsx
  const hasUsage =
    !!usage &&
    (usage.providers.length > 0 ||
      usage.tavily_searches > 0 ||
      usage.tts_characters > 0);
```

Change it to:

```tsx
  const hasUsage =
    !!usage &&
    (usage.providers.length > 0 ||
      usage.tavily_searches > 0 ||
      usage.tts_characters > 0 ||
      usage.listening_ms > 0);
```

Further down (around line 592), the Aura TTS characters row currently
reads:

```tsx
          {/* Aura TTS characters — separate meter (per-character billing). */}
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[12px]">
            <span className="text-fg-muted">Voice characters (Aura TTS)</span>
            <span className="font-mono tabular-nums text-fg">
              {fmt(usage.tts_characters)}
            </span>
          </div>
        </div>
      )}
```

Add a new row right after it, before the closing `</div>`:

```tsx
          {/* Aura TTS characters — separate meter (per-character billing). */}
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[12px]">
            <span className="text-fg-muted">Voice characters (Aura TTS)</span>
            <span className="font-mono tabular-nums text-fg">
              {fmt(usage.tts_characters)}
            </span>
          </div>
          {/* Session time — summed across every stop_session (Live + rehearsal). */}
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[12px]">
            <span className="text-fg-muted">Time listening</span>
            <span className="font-mono tabular-nums text-fg">
              {fmt(Math.round(usage.listening_ms / 60_000))} min
            </span>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Move the Usage section to the new group + add Subscription**

The group-render blocks (around line 1181) currently read:

```tsx
      {group === "ally" && (
      <Section
        title="Usage"
        description="What your API keys have been spent on — LLM tokens and web searches."
      >
        <UsageSettings />
      </Section>
      )}
```

Change to:

```tsx
      {group === "usage" && (
      <Section
        title="Usage"
        description="What your API keys have been spent on — LLM tokens, web searches, and time listening."
      >
        <UsageSettings />
      </Section>
      )}

      {group === "subscription" && (
      <Section>
        <SubscriptionSettings />
      </Section>
      )}
```

`AllySettings` and the "Web research (Context)" section (the two other
`group === "ally"` blocks, around lines 1150 and 1172) are untouched —
still gated on `"ally"`.

- [ ] **Step 4: Typecheck + run the full UI test suite**

Run: `npx tsc -b`
Expected: clean.

Run: `npx vitest run`
Expected: every test file passes, including `settingsNav.test.ts` and
the new `SubscriptionSettings.test.tsx` from Tasks 4–5.

- [ ] **Step 5: Build + commit**

Run: `npm run build`
Expected: clean.

```bash
git add src/components/SettingsPanel.tsx
git commit -m "feat(settings): wire Usage/Subscription groups into SettingsPanel

Usage section moves from group===\"ally\" to group===\"usage\"
(content unchanged besides the new Time listening row); Subscription
renders the new SubscriptionSettings component. Ally keeps its
provider/model config and Web research sections, untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GiKzMingp6q12HJcuxRSZp"
```

---

### Task 7: Full verification + push

**Files:** none — verification only.

- [ ] **Step 1: Full core gate**

Run: `cargo fmt --check && cargo clippy -p conva-core --all-targets && cargo test -p conva-core`
Expected: clean.

- [ ] **Step 2: Full UI gate**

Run: `npx tsc -b --clean && npx tsc -b && npx vitest run && npm run build`
Expected: clean; test count should be 393 (this branch's baseline) + the
4 new `SubscriptionSettings` tests = 397.

- [ ] **Step 3: Push**

```bash
git push -u origin claude/conva-app-home-density-icons
```

If the push fails on a network error, retry up to 4 times with
exponential backoff (2s, 4s, 8s, 16s) before giving up.

- [ ] **Step 4: Report**

Summarize what shipped (both new Settings groups, the real time-listening
counter, the mocked Subscription page) and that CI will verify the
Windows shell build (Task 2's `stop_session`/`metering.rs` changes) since
this sandbox can't compile it locally.

---

## Self-review notes

**Spec coverage:** every section of
`docs/superpowers/specs/2026-09-03-settings-usage-subscription-design.md`
maps to a task — §1 (data model) → Tasks 1–3, §2 (Settings IA) → Task 4,
§3 (Usage row) → Task 6 Step 2, §4 (Subscription component) → Task 5,
wiring → Task 6 Step 3, testing → each task's own test steps, out-of-scope
items are simply not touched by any task.

**Placeholder scan:** no TBD/TODO; every step shows complete code, not a
description of code.

**Type consistency:** `listening_ms` (Rust `u64` / TS `number`) is spelled
identically in `crates/conva-core/src/metering.rs`,
`src-tauri/src/metering.rs`, `src-tauri/src/lib.rs`, and `src/lib/ipc.ts`;
`SettingsGroup`'s new `"usage"`/`"subscription"` string literals match
between `settingsNav.ts` and their two `group === "..."` call sites in
`SettingsPanel.tsx`; `SubscriptionSettings` is imported and rendered with
the exact name it's exported under.
