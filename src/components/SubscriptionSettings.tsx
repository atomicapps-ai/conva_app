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
