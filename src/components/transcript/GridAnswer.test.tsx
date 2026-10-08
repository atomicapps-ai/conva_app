import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChoicePrompt,
  GridAnswer,
  gridAsText,
} from "@/components/transcript/GridAnswer";
import type { GridPayload } from "@/lib/ipc";
import { DISTRICT_GRID } from "@/test/liveAssistFixtures";

afterEach(cleanup);

describe("GridAnswer", () => {
  it("draws every group and an emphasised total, numbers right-aligned", () => {
    render(<GridAnswer grid={DISTRICT_GRID} />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // header + 4 districts + total
    expect(rows).toHaveLength(6);
    expect(within(rows[5]!).getByText("Total")).toBeInTheDocument();
    expect(within(rows[5]!).getByText("$439,519.85")).toBeInTheDocument();
    const header = within(rows[0]!).getAllByRole("columnheader");
    expect(header.map((h) => h.textContent)).toEqual(["District", "Amount", "Rows"]);
    expect(header[1]!.className).toContain("text-right");
    expect(header[0]!.className).toContain("text-left");
  });

  it("explains a number on demand: file, column, rows and the exact sum", () => {
    render(<GridAnswer grid={DISTRICT_GRID} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "$128,430.50" }));
    const note = screen.getByRole("status");
    // Wording is neutral: it must be true for a sum, average, count, min or max.
    expect(note).toHaveTextContent("$128,430.50 is calculated exactly from 1 row of “Amount”");
    expect(note).not.toHaveTextContent(/exact sum/);
    expect(note).toHaveTextContent("Q3-district-sales.csv");
    expect(note).toHaveTextContent("row 2");
    // Toggle off.
    fireEvent.click(screen.getByRole("button", { name: "$128,430.50" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says when more rows contributed than are listed", () => {
    const big: GridPayload = {
      ...DISTRICT_GRID,
      rows: [
        {
          kind: "total",
          cells: [
            { text: "Total" },
            {
              text: "$10.00",
              value: "10.00",
              sources: [
                {
                  doc_id: "d",
                  file_name: "big.csv",
                  column: "Amount",
                  rows: [2, 3, 4],
                  row_count: 50,
                },
              ],
            },
            { text: "50" },
          ],
        },
      ],
    };
    render(<GridAnswer grid={big} />);
    fireEvent.click(screen.getByRole("button", { name: "$10.00" }));
    expect(screen.getByRole("status")).toHaveTextContent("50 rows");
    expect(screen.getByRole("status")).toHaveTextContent("and 47 more");
  });

  it("lists cautions with their rows and leaves info notes quiet", () => {
    render(
      <GridAnswer
        grid={{
          ...DISTRICT_GRID,
          notices: [
            { level: "caution", text: "2 blank value(s) in “Amount” were left out.", rows: [14, 88] },
            { level: "info", text: "Only the first sheet was read." },
          ],
        }}
      />,
    );
    const list = screen.getByRole("list", { name: "Things to check" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Check");
    expect(items[0]).toHaveTextContent("rows 14, 88");
    expect(items[1]).not.toHaveTextContent("Check");
  });

  it("copies as tab-separated text that pastes into a sheet", () => {
    expect(gridAsText(DISTRICT_GRID).split("\n")).toEqual([
      "District\tAmount\tRows",
      "East\t$96,210.00\t1",
      "North\t$128,430.50\t1",
      "South\t$141,875.25\t1",
      "West\t$73,004.10\t1",
      "Total\t$439,519.85\t4",
    ]);
  });
});

describe("ChoicePrompt", () => {
  const options = [
    { id: "1", label: "Amount", detail: "column 2" },
    { id: "2", label: "Net amount", detail: "column 3" },
  ];

  it("asks once and reports which option was tapped", () => {
    const onChoose = vi.fn();
    render(<ChoicePrompt question="Which amount do you mean?" options={options} onChoose={onChoose} />);
    expect(screen.getByText("Which amount do you mean?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Net amount/ }));
    expect(onChoose).toHaveBeenCalledWith("2");
  });

  it("is inert without a handler rather than pretending to work", () => {
    render(<ChoicePrompt question="Which?" options={options} />);
    expect(screen.getByRole("button", { name: /Amount column 2/ })).toBeDisabled();
  });
});
