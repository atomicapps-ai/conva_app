/**
 * A button label that shrinks in 3 tiers instead of ever wrapping: full text
 * -> short text -> nothing (icon-only, relying on the button's own `title`
 * as the tooltip). Viewport-width breakpoints are the right tool here — the
 * app is one full-window view (not a variable-width embedded panel), and
 * Compact mode's 380px window is well below `sm`, so it always lands on
 * icon-only automatically. Pair with `shrink-0` on the button itself so the
 * flex row squeezes the label, never the button's own box.
 *
 * Use where a button lives somewhere genuinely space-constrained (a crowded
 * toolbar row); most buttons just need `.btn`'s baseline `white-space:
 * nowrap` (globals.css) and don't need this.
 */
export function ResponsiveLabel({ full, short }: { full: string; short: string }) {
  return (
    <>
      <span className="hidden lg:inline">{full}</span>
      <span className="hidden sm:inline lg:hidden">{short}</span>
    </>
  );
}
