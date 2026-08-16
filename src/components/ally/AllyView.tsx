import { Section, ViewShell } from "@/components/studio/ViewShell";

/**
 * Ally as its own rail destination — new in V4.0 (`conva_core/brand/UI/
 * AppUI_V4.0`). Today Ally only exists as the Live view's right-hand panel;
 * this placeholder holds the rail slot honestly rather than inventing
 * content for a screen nobody's specced yet. What it should actually show
 * outside a live call — cross-conversation history? saved answers? — is an
 * open product question (owner decision, 2026-08-16: placeholder now, spec
 * later).
 */
export function AllyView() {
  return (
    <ViewShell
      icon="ally"
      title="Ally"
      subtitle="A standalone Ally destination is planned — not yet specced."
    >
      <Section title="Coming soon">
        <p className="text-sm text-fg-muted">
          Right now Ally lives in the panel next to your Live conversation.
          This screen will hold whatever Ally means outside of a live call —
          once that's decided.
        </p>
      </Section>
    </ViewShell>
  );
}
