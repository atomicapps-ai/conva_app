import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AnswerBody, inlineMd } from "@/lib/allyMarkdown";

afterEach(cleanup);

describe("inlineMd", () => {
  it("renders bold, italic, and inline code as their own elements", () => {
    const { container } = render(
      <p>{inlineMd("**bold** and *italic* and _also italic_ and `code`")}</p>,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelectorAll("em").length).toBe(2);
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("passes plain text through untouched", () => {
    const { container } = render(<p>{inlineMd("no markup here")}</p>);
    expect(container.textContent).toBe("no markup here");
  });
});

describe("AnswerBody", () => {
  it("renders a numbered list as an <ol> — the gap that shipped literal '1. ' prefixes", () => {
    const { container } = render(<AnswerBody text={"1. First step\n2. Second step"} />);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    const items = ol!.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0]?.textContent).toBe("First step");
    expect(items[1]?.textContent).toBe("Second step");
  });

  it("renders a bulleted list as a <ul>", () => {
    const { container } = render(<AnswerBody text={"- one\n- two"} />);
    expect(container.querySelectorAll("ul li").length).toBe(2);
  });

  it("keeps bullets and numbered items in separate lists when they alternate", () => {
    const { container } = render(<AnswerBody text={"- bullet\n1. numbered"} />);
    expect(container.querySelectorAll("ul").length).toBe(1);
    expect(container.querySelectorAll("ol").length).toBe(1);
  });

  it("renders a heading line bold and a plain line as a paragraph", () => {
    const { container } = render(<AnswerBody text={"## Heading\nplain paragraph"} />);
    expect(container.textContent).toContain("Heading");
    expect(container.textContent).toContain("plain paragraph");
    expect(container.querySelectorAll("p").length).toBe(2);
  });
});
