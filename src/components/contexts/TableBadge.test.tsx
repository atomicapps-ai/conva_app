import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TableBadge } from "@/components/contexts/TableBadge";

afterEach(cleanup);

describe("TableBadge", () => {
  it("says a sheet is a table, with its row count", () => {
    render(<TableBadge doc={{ table: { rows: 12345, columns: 4, supported: true } }} />);
    expect(screen.getByText(/Table · 12,345 rows/)).toBeInTheDocument();
  });

  it("says out loud when a sheet is searchable only", () => {
    render(<TableBadge doc={{ table: { rows: 3, columns: 2, supported: false } }} />);
    const badge = screen.getByText("Search only");
    expect(badge).toHaveAttribute("title", expect.stringContaining("can't be totalled safely"));
  });

  it("renders nothing for an ordinary document or one saved before tables existed", () => {
    const { container } = render(<TableBadge doc={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
