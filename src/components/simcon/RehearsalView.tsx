import { Section, ViewShell } from "@/components/studio/ViewShell";

/**
 * Rehearsal as its own rail destination — new in V4.0 (`conva_core/brand/UI/
 * AppUI_V4.0`). Today a rehearsal only exists as a floating overlay bar
 * (RehearsalBar.tsx) during an active Sim Con run; this placeholder holds
 * the rail slot honestly rather than inventing content for a screen nobody's
 * specced yet. A rehearsal history? A launcher separate from Contexts? An
 * open product question (owner decision, 2026-08-16: placeholder now, spec
 * later).
 */
export function RehearsalView() {
  return (
    <ViewShell
      icon="rehearsal"
      title="Rehearsal"
      subtitle="A standalone Rehearsal destination is planned — not yet specced."
    >
      <Section title="Coming soon">
        <p className="text-sm text-fg-muted">
          Right now a rehearsal runs as a floating bar over Live, started
          from a context's detail page. This screen will hold whatever
          Rehearsal means as its own destination — once that's decided.
        </p>
      </Section>
    </ViewShell>
  );
}
