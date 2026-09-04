# Settings: split out Usage, add a mocked Subscription page

> Brainstorming-skill design doc. Status: **approved** (owner, 2026-09-03).
> Shipping on `claude/conva-app-home-density-icons` (current branch/PR #188 —
> this session's active branch; unrelated in scope to #188's original
> density/icon work, same as the templates spec that already landed there).

## Problem

Owner: *"In settings > Ally, separate the metrics from usage into a new
setting category called usage, and create another called subscription.
Subscription will be where the plan can be updated, start as free and
stripe credit card entry can be setup. Mock the page it doesn't have to
fully work. On usage i like how its already looking with the metrics for
FANER and the rest. add another row for time used in minutes."*

Settings today has five groups (`settingsNav.ts`): Account, Devices,
Transcription, Ally, Privacy. "Ally" carries three sections —
provider/model config, the web-research (Tavily) key, and a `Usage`
section (`UsageSettings` in `SettingsPanel.tsx`) showing per-provider LLM
token totals, feature × model buckets, Tavily searches, and TTS
characters — all real, metered data from `crates/conva-core/src/metering.rs`'s
`UsageLedger`. There's no time-based counter anywhere: `UsageLedger` has no
duration field at all. There's also no billing/subscription surface of any
kind yet, though the platform's real design for one already exists in
`conva_core/docs/platform/04-billing-credits.md` (Stripe Products/Prices,
credit ledger, webhooks — **payments live only in the web app; desktop
never embeds Stripe**, it deep-links out to a real paywall). That real
surface isn't built yet — nothing to deep-link to — so a Settings mock is
the right scope for now, as the owner's own ask frames it.

## Design

Three independent pieces, all touching the same Settings surface:

### 1. New `listening_ms` usage counter

`crates/conva-core/src/metering.rs`:

```rust
pub struct UsageLedger {
    // ...existing fields...
    /// Total time an active session (Live or rehearsal) has been running,
    /// summed across every `stop_session` (best-effort — a session ended by
    /// a crash/force-quit isn't counted, same trade-off as every other
    /// counter here).
    #[serde(default)]
    pub listening_ms: u64,
}

impl UsageLedger {
    /// Add `ms` of listening time. No-ops on `ms == 0` (mirrors
    /// `record_tavily_search`/`record_tts_characters`).
    pub fn record_listening_ms(&mut self, ms: u64, now_unix_ms: u64) {
        if ms == 0 {
            return;
        }
        self.start_window(now_unix_ms);
        self.listening_ms = self.listening_ms.saturating_add(ms);
    }
}

pub struct UsageSummary {
    // ...existing fields...
    pub listening_ms: u64,
}
```

`summary()` copies `listening_ms` straight through, same as every other
field. `#[serde(default)]` means an existing `usage.json` without this key
deserializes with `listening_ms: 0` — no migration.

**`src-tauri/src/lib.rs`'s `stop_session`** — `SessionManager` already
tracks a session's start time (`session_started_ms: AtomicU64`, set in
`start()`, read via the existing `session_started_ms()` getter) for
internal use; nothing currently reads it back out. Wire it into the stop
path, captured *before* `state.session.stop(&app)` runs:

```rust
#[tauri::command]
async fn stop_session(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    clear_active_context(&state);
    let started = state.session.session_started_ms();
    if started > 0 {
        let elapsed = now_unix_ms().saturating_sub(started);
        metering::record_listening_ms(&app, elapsed);
    }
    state.session.stop(&app).map_err(|e| e.to_string())
}
```

`metering::record_listening_ms` is a new shell wrapper in
`src-tauri/src/metering.rs`, matching `record_tavily_search`'s exact shape:

```rust
/// Add `ms` of listening time (Live or rehearsal), then persist. Best-effort.
pub fn record_listening_ms(app: &AppHandle, ms: u64) {
    let state = app.state::<AppState>();
    let mut ledger = state.usage.lock().expect("usage lock");
    ledger.record_listening_ms(ms, now_unix_ms());
    persist(app, &ledger);
}
```

This covers both a normal Live session and a rehearsal session — both go
through the same `SessionManager` start/stop path, so one hook is enough;
no per-mode branching. `session_started_ms` isn't reset by `stop()`, but
that's harmless: the next `start()` overwrites it before the next
`stop_session` ever reads it again.

### 2. Settings IA: two new top-level groups

**`src/components/settingsNav.ts`**:

```ts
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

Inserted right after `ally` (their origin) and before `privacy` — smallest
diff from today's order. The file's own doc-comment table (the "where did
each pre-V5 section go" record) gets a matching update: Ally's row drops
"usage counters"; two new rows for Usage and Subscription.

`groupForKey`/`toSettingsGroup`/`DEFAULT_SETTINGS_GROUP` are unchanged —
they're already generic over `SETTINGS_GROUPS`.

**`src/components/SettingsPanel.tsx`**: the existing

```tsx
{group === "ally" && (
<Section title="Usage" description="...">
  <UsageSettings />
</Section>
)}
```

block moves to `group === "usage"`, verbatim except the group guard. The
`AllySettings` and "Web research (Context)" sections stay under `"ally"`
unchanged. One new block added for the new group:

```tsx
{group === "subscription" && (
<Section>
  <SubscriptionSettings />
</Section>
)}
```

### 3. `UsageSettings` — one new row

In the existing metrics table (`SettingsPanel.tsx`), alongside the current
"Web searches (Tavily)" / "Voice characters (Aura TTS)" rows:

```tsx
<div className="flex items-center justify-between border-t border-border px-3 py-2 text-[12px]">
  <span className="text-fg-muted">Time listening</span>
  <span className="font-mono tabular-nums text-fg">
    {fmt(Math.round(usage.listening_ms / 60_000))} min
  </span>
</div>
```

`hasUsage` (the "No usage recorded yet" empty-state gate) extends to
`|| usage.listening_ms > 0`, so a fresh install still shows the empty
state instead of a lone "0 min" row.

**`src/lib/ipc.ts`**: `UsageSummary` gains `listening_ms: number;` —
mirrors the Rust field.

### 4. `SubscriptionSettings` — new mocked component

New file, **`src/components/SubscriptionSettings.tsx`** (`SettingsPanel.tsx`
is already 1,372 lines; this is enough new surface to earn its own file
rather than growing that further — the pattern every other settings
sub-component here already follows, just not yet broken out of the one
file). Entirely client-side `useState`; **no backend call, no new Tauri
command, no `AppConfig`/IPC field, nothing persisted** — resets on
restart, which is fine for a mock.

Content:

- **Current plan card.** "Free" — real and accurate (conva *is* free
  through the invite-only beta today; not a fabricated tier). One line:
  "conva is free during the invite-only beta."
- **Upgrade card.** "Conva Membership" · $7.99/mo — pulled from the
  current canonical pricing doc
  (`conva_core/docs/product/conva-positioning-market-and-usage-pricing-strategy-2026-09.md`
  §8.3), not invented. Four bullets from that doc's candidate-inclusions
  list: desktop app access, local audio capture + on-device transcription,
  local transcript/context library, AI usage at member rates. An
  "Upgrade" button.
- Clicking **Upgrade** reveals a mocked card-entry form below: name / card
  number / expiry / CVC, plain `<input>`s, no Stripe SDK, no real
  validation. The card-number field's placeholder is Stripe's well-known
  test number (`4242 4242 4242 4242`) so the form reads as an obvious
  sandbox, not something that looks like it's collecting a real card. A
  "Save payment method" button.
- Clicking **Save payment method** flips local state: the current-plan
  card now shows "Conva Membership" active with a masked "•••• 4242" line
  and a "Downgrade to Free" link. Clicking that reverts to the Free state.
  Nothing charged, nothing survives a reload.
- No "manage billing on web" link — the real destination
  (`04-billing-credits.md`'s actual desktop-deep-links-to-web-Stripe-Checkout
  design) isn't built yet, so there's nothing to link to. Explicitly out
  of scope here, not an oversight.

## Out of scope

- Any real Stripe integration, real payment processing, or real plan
  persistence (backend or `AppConfig`) — this is a mock, per the ask.
- A live "manage billing on web" deep-link.
- Splitting the time counter by session type (Live vs. rehearsal) — one
  combined counter, matching how every other field in this ledger is
  already unscoped by session type.
- Any change to `AllySettings` (providers/models) or the Web research
  section — untouched, stay under Ally.
- Any change to `ConversationTemplate`/`FileSlot`/the per-category
  templates work from the prior spec in this branch — unrelated.

## Testing

- **`crates/conva-core`**: extend `metering.rs`'s test module —
  `record_listening_ms` accumulates and opens the window on a zero-state
  ledger (mirrors `first_record_opens_the_window`); a zero-ms call is a
  no-op (mirrors the existing zero-guard behavior on
  `record_tavily_search`/`record_tts_characters`); a `UsageLedger` JSON
  literal missing `listening_ms` still deserializes with `0` (back-compat).
- **`src-tauri`**: no new dedicated test for `stop_session`'s elapsed-time
  read — Windows-only compile, CI-verified per this branch's established
  pattern (the sandbox can't compile the shell); the change itself is a
  straight-line read-then-record with an existing getter, low risk.
- **`src/components/settingsNav.test.ts`**: extend the existing "uses
  canonical groups" assertion for the two new ids/labels and their
  position in `SETTINGS_GROUPS`.
- **New `src/components/SubscriptionSettings.test.tsx`**: renders the Free
  state by default; Upgrade reveals the card form; Save flips to the
  Conva Membership active state with the masked card line; Downgrade
  returns to Free.
- **`src/lib/ipc.ts`** change is a type-only addition — covered by
  `npx tsc -b` catching any now-required field at call sites (there are
  none outside `UsageSettings`, which already reads `usage.listening_ms`
  from this spec's own new row).
- `npx tsc -b`, `npx vitest run`, `npm run build`; `cargo test -p conva-core`
  for the metering changes.
