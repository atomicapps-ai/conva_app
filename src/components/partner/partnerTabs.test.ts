import { describe, expect, it } from "vitest";

import {
  addOrFocus,
  closeTab,
  documentTab,
  itemTab,
  tabFromPayload,
  tabLabel,
  type PartnerTab,
} from "@/components/partner/partnerTabs";
import type { PartnerPayload } from "@/lib/ipc";

function payload(overrides: Partial<PartnerPayload> = {}): PartnerPayload {
  return {
    term: "API Gateway",
    kind: "concept",
    preview: null,
    answer: null,
    source_lines: [],
    doc_id: null,
    ...overrides,
  };
}

describe("addOrFocus", () => {
  it("appends a new tab and makes it active", () => {
    const t = itemTab(payload());
    const r = addOrFocus([], t);
    expect(r.tabs).toEqual([t]);
    expect(r.activeKey).toBe(t.key);
  });

  it("focuses an existing tab instead of duplicating it", () => {
    const t = itemTab(payload());
    const first = addOrFocus([], t);
    const again = addOrFocus(first.tabs, itemTab(payload()));
    expect(again.tabs).toHaveLength(1);
    expect(again.activeKey).toBe(t.key);
  });

  it("treats the same term with a different answer as a different tab", () => {
    const fresh = itemTab(payload());
    const answered = itemTab(payload({ answer: "It routes requests." }));
    const r = addOrFocus(addOrFocus([], fresh).tabs, answered);
    expect(r.tabs).toHaveLength(2);
    expect(r.activeKey).toBe(answered.key);
  });

  it("dedupes document tabs by doc id", () => {
    const d = documentTab("doc-1", "aws.pdf");
    const r = addOrFocus(addOrFocus([], d).tabs, documentTab("doc-1", "aws.pdf"));
    expect(r.tabs).toHaveLength(1);
    expect(r.activeKey).toBe(d.key);
  });
});

describe("tabFromPayload", () => {
  it("becomes a document tab when doc_id is set, term as the file name", () => {
    const t = tabFromPayload(payload({ term: "aws.pdf", doc_id: "doc-1" }));
    expect(t).toEqual(documentTab("doc-1", "aws.pdf"));
  });

  it("ignores kind/preview/answer/source_lines on a document open", () => {
    const t = tabFromPayload(
      payload({
        term: "aws.pdf",
        doc_id: "doc-1",
        kind: "concept",
        preview: "should be ignored",
        answer: "should be ignored too",
        source_lines: ["ignored.pdf — ¶1"],
      }),
    );
    expect(t).toEqual(documentTab("doc-1", "aws.pdf"));
  });

  it("becomes an item tab when doc_id is absent", () => {
    const p = payload({ term: "API Gateway" });
    expect(tabFromPayload(p)).toEqual(itemTab(p));
  });
});

describe("closeTab", () => {
  const three = (): PartnerTab[] => [
    itemTab(payload({ term: "a" })),
    itemTab(payload({ term: "b" })),
    itemTab(payload({ term: "c" })),
  ];

  it("closing an inactive tab keeps the active one", () => {
    const tabs = three();
    const r = closeTab(tabs, tabs[0]!.key, tabs[2]!.key);
    expect(r.tabs.map((t) => tabLabel(t))).toEqual(["b", "c"]);
    expect(r.activeKey).toBe(tabs[2]!.key);
  });

  it("closing the active tab activates its right neighbor", () => {
    const tabs = three();
    const r = closeTab(tabs, tabs[1]!.key, tabs[1]!.key);
    expect(r.activeKey).toBe(tabs[2]!.key);
  });

  it("closing the active last tab falls back to its left neighbor", () => {
    const tabs = three();
    const r = closeTab(tabs, tabs[2]!.key, tabs[2]!.key);
    expect(r.activeKey).toBe(tabs[1]!.key);
  });

  it("closing the only tab clears the active key", () => {
    const tabs = [itemTab(payload())];
    const r = closeTab(tabs, tabs[0]!.key, tabs[0]!.key);
    expect(r.tabs).toEqual([]);
    expect(r.activeKey).toBeNull();
  });

  it("ignores an unknown key", () => {
    const tabs = three();
    const r = closeTab(tabs, "nope", tabs[0]!.key);
    expect(r.tabs).toHaveLength(3);
    expect(r.activeKey).toBe(tabs[0]!.key);
  });
});
