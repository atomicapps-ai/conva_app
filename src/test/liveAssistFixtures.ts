import type {
  GridPayload,
  LiveAssistLifecycle,
  LiveAssistPayload,
  LiveAssistResult,
} from "@/lib/ipc";
import { LIVE_ASSIST_CONTRACT_VERSION } from "@/lib/ipc";

/** The Q3 district sales grid the mockups and Rust replay fixtures use. */
export const DISTRICT_GRID: GridPayload = {
  title: "Total Amount by District",
  columns: [
    { key: "group", label: "District", align: "left" },
    { key: "value", label: "Amount", align: "right" },
    { key: "rows", label: "Rows", align: "right" },
  ],
  rows: [
    ["East", "$96,210.00", "96210.00", [3]],
    ["North", "$128,430.50", "128430.50", [2]],
    ["South", "$141,875.25", "141875.25", [4]],
    ["West", "$73,004.10", "73004.10", [5]],
  ].map(([name, text, value, rows]) => ({
    kind: "body" as const,
    cells: [
      { text: name as string },
      {
        text: text as string,
        value: value as string,
        sources: [
          {
            doc_id: "doc-1",
            file_name: "Q3-district-sales.csv",
            column: "Amount",
            rows: rows as number[],
            row_count: 1,
          },
        ],
      },
      { text: "1", value: "1" },
    ],
  })).concat([
    {
      kind: "total" as const,
      cells: [
        { text: "Total" },
        {
          text: "$439,519.85",
          value: "439519.85",
          sources: [
            {
              doc_id: "doc-1",
              file_name: "Q3-district-sales.csv",
              column: "Amount",
              rows: [2, 3, 4, 5],
              row_count: 4,
            },
          ],
        },
        { text: "4", value: "4" },
      ],
    },
  ]),
  notices: [],
  source_files: ["Q3-district-sales.csv"],
};

export function assistResult(
  over: Partial<LiveAssistResult> & { lifecycle?: LiveAssistLifecycle } = {},
): LiveAssistResult {
  return {
    contract_version: LIVE_ASSIST_CONTRACT_VERSION,
    result_id: "la-1",
    correlation_id: "s1:them:4",
    session_id: "s1",
    context_id: "ctx",
    revision: 1,
    kind: "table_aggregate",
    lifecycle: "provisional",
    question: "What's the total amount per district?",
    say_now: "One moment, I'm working that out from Q3-district-sales.csv.",
    payload: {
      type: "text",
      text: "Adding up Amount by District from Q3-district-sales.csv…",
    },
    timing: { enqueued_at_unix_ms: 1_000, holding_ms: 2, emitted_ms: 2 },
    ...over,
  };
}

/** The finished revision of {@link assistResult}. */
export function completedResult(): LiveAssistResult {
  const payload: LiveAssistPayload = { type: "grid", ...DISTRICT_GRID };
  return assistResult({
    revision: 2,
    lifecycle: "complete",
    say_now:
      "The total amount is $439,519.85. South is the largest at $141,875.25.",
    payload,
    timing: {
      enqueued_at_unix_ms: 1_000,
      holding_ms: 2,
      emitted_ms: 31,
      compute_ms: 24,
    },
  });
}

export function choiceResult(): LiveAssistResult {
  return assistResult({
    result_id: "la-2",
    correlation_id: "ask:ask:1",
    lifecycle: "needs_choice",
    say_now: "Let me check which one you mean.",
    payload: {
      type: "choice",
      question: "Which column do you want to add up?",
      options: [
        { id: "1", label: "Amount", detail: "column 2" },
        { id: "2", label: "Net amount", detail: "column 3" },
      ],
    },
  });
}
