/**
 * One quiet line under a written answer: Ally can be wrong on a number, a date
 * or a name. Spreadsheet totals are NOT covered by it (they are computed in
 * code, never by the model), so the table answer does not carry it. It stands
 * in for the figure-grounding markers (answer-integrity C7/C8) until those
 * exist; see conva_core `docs/technical/answer-integrity-checks.md`.
 */
export const ANSWER_CHECK_TEXT =
  "Check figures, dates and names before you rely on them. Ally can get them wrong.";

export function AnswerCheckNotice() {
  return (
    <p
      className="text-[0.8em] leading-snug text-fg-muted"
      data-testid="answer-check-notice"
    >
      {ANSWER_CHECK_TEXT}
    </p>
  );
}
