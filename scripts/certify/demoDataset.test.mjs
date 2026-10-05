import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categoryTemplate } from "../../src/components/context/categoryTemplates";
import { createCloudStub, matchDemoAnswer } from "./cloud.mjs";
import { DEMO_DIR, loadDemoDataset, turnsToSegments } from "./demoDataset.mjs";

const ds = loadDemoDataset();
const docNames = new Set(ds.documents.map((d) => d.name));
const ctxKeys = new Set(ds.contexts.map((c) => c.key));
const CATEGORIES = ["interview", "company_meeting", "sales_call", "live_stream", "other"];
const csv = (name) => ds.documents.find((d) => d.name === name).text.trim().split("\n").slice(1).map((l) => l.split(","));

describe("demo dataset — shape", () => {
  it("has 30 documents, one Context per category, and 7 conversations (one unlinked)", () => {
    expect(ds.documents).toHaveLength(30);
    expect(ds.contexts.map((c) => c.category).sort()).toEqual([...CATEGORIES].sort());
    expect(ds.conversations).toHaveLength(7);
    expect(ds.conversations.filter((c) => c.context === null)).toHaveLength(1);
  });

  it("every document a Context names exists, is slotted validly, and no library file is orphaned", () => {
    const used = new Set();
    for (const c of ds.contexts) {
      const slots = new Set(categoryTemplate(c.category).fileSlots.map((s) => s.key));
      for (const d of c.docs) {
        expect(docNames.has(d.file), `${c.key}: ${d.file}`).toBe(true);
        if (d.slot) expect(slots.has(d.slot), `${c.key}: slot ${d.slot}`).toBe(true);
        used.add(d.file);
      }
      expect(docNames.has(c.briefing), `${c.key} briefing`).toBe(true);
      used.add(c.briefing);
      expect(c.key_terms.length).toBeGreaterThanOrEqual(4);
      expect(c.personas).toHaveLength(3);
      expect(c.personas.filter((p) => p.recommended)).toHaveLength(1);
    }
    expect([...docNames].filter((n) => !used.has(n))).toEqual([]);
  });

  it("conversations are well formed and name real Contexts", () => {
    const titles = new Set();
    for (const cv of ds.conversations) {
      expect(titles.has(cv.title)).toBe(false);
      titles.add(cv.title);
      if (cv.context) expect(ctxKeys.has(cv.context)).toBe(true);
      expect(cv.segments.length).toBeGreaterThanOrEqual(7);
      expect(new Set(cv.segments.map((s) => s.side))).toEqual(new Set(["inbound", "outbound"]));
      let prevEnd = 0;
      for (const s of cv.segments) {
        expect(s.is_final).toBe(true);
        expect(s.start_ms).toBeGreaterThanOrEqual(prevEnd);
        expect(s.end_ms).toBeGreaterThan(s.start_ms);
        prevEnd = s.end_ms;
      }
      for (const side of ["inbound", "outbound"]) {
        const seqs = cv.segments.filter((s) => s.side === side).map((s) => s.seq);
        expect(seqs).toEqual(seqs.map((_, i) => i + 1));
      }
    }
  });

  it("turnsToSegments rejects an unknown speaker", () => {
    expect(() => turnsToSegments([["them", "ok"], ["robot", "no"]])).toThrow(/unknown speaker/);
  });
});

describe("demo dataset — the story agrees with itself", () => {
  it("the renewal numbers match across the quote, the overview, the usage table and the prepared answers", () => {
    const quote = csv("larkspur-renewal-quote.csv").map(([item, seats, unit, months, disc]) => ({ item, total: Number(seats) * Number(unit) * Number(months) * (1 - Number(disc) / 100) }));
    const existing = quote.find((l) => l.item.includes("existing sites")).total;
    const expansion = quote.find((l) => l.item.includes("Spokane")).total;
    const audit = quote.find((l) => l.item.includes("Audit")).total;
    expect(existing).toBe(151_200);
    expect(Math.round(expansion)).toBe(53_222);
    expect(audit).toBe(18_000);
    const text = ds.documents.map((d) => d.text).join("\n");
    expect(text).toContain("$151,200");
    expect(text).toContain("$53,222");
    expect(text).toContain("$18,000");
    const usage = csv("larkspur-usage-2026.csv");
    expect(usage[0][3]).toBe("5.8");
    expect(usage[usage.length - 1][3]).toBe("3.4");
  });

  it("Q3 financials add up to the headline revenue and the Q4 numbers appear in the summary", () => {
    const rows = csv("q3-financials.csv");
    const revenue = rows.reduce((n, r) => n + Number(r[1]), 0);
    expect(revenue).toBe(11_800);
    expect(ds.documents.find((d) => d.name === "q3-results-summary.md").text).toContain("$11.8 million");
  });
});

describe("demo dataset — canned answers", () => {
  it("name existing documents and Contexts, and put a say-now line before a background split", () => {
    for (const a of ds.answers) {
      if (a.context) expect(ctxKeys.has(a.context)).toBe(true);
      for (const n of a.docs) expect(docNames.has(n), n).toBe(true);
      expect(a.answer).toMatch(/^\*\*[^\n]+\*\*\n\n---\n\n- /);
    }
  });

  it("every example question finds its own answer, and an unrelated one finds none", () => {
    for (const a of ds.answers) for (const q of a.questions) expect(matchDemoAnswer(q, a.context, ds.answers)).toBe(a);
    expect(matchDemoAnswer("Who won the football match yesterday?", "larkspur", ds.answers)).toBeNull();
    expect(matchDemoAnswer("", null, ds.answers)).toBeNull();
  });

  it("an answer is only offered inside its own Context", () => {
    expect(matchDemoAnswer("What is the base salary?", "larkspur", ds.answers)).toBeNull();
  });
});

describe("demo dataset — fictional and small", () => {
  const files = [
    ...readdirSync(join(DEMO_DIR, "library")).map((n) => join(DEMO_DIR, "library", n)),
    ...["contexts.json", "conversations.json", "answers.json", "README.md"].map((n) => join(DEMO_DIR, n)),
  ];
  const all = files.map((f) => readFileSync(f, "utf8")).join("\n");

  it("uses only reserved example contact details and no links", () => {
    for (const email of all.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(email.endsWith("@example.com"), email).toBe(true);
    for (const phone of all.match(/\b\d{3}-\d{4}\b/g) ?? []) expect(phone.startsWith("555-01"), phone).toBe(true);
    for (const url of all.match(/https?:\/\/[^\s)]+/g) ?? []) expect(url, url).toMatch(/example\.(com|org)/);
  });

  it("names no well-known real brands and holds no key-shaped strings", () => {
    const denylist = ["Microsoft", "Google", "Amazon", "Salesforce", "HubSpot", "Slack", "Oracle", "SAP", "Zendesk", "Shopify", "Walmart", "FedEx", "UPS", "Northwind"];
    for (const brand of denylist) expect(new RegExp(`\\b${brand}\\b`).test(all), brand).toBe(false);
    expect(/\b(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,})/.test(all)).toBe(false);
  });

  it("stays under 1 MB", () => {
    const total = files.reduce((n, f) => n + statSync(f).size, 0);
    expect(total).toBeLessThan(1_000_000);
  });
});

describe("demo dataset — planted into the cloud stub", () => {
  const stub = createCloudStub({ dataset: ds, now: () => 1_800_000_000_000 });
  const get = (path) => stub.handle({ method: "GET", path }).body;

  it("serves the whole workspace through the same routes the app calls", () => {
    expect(get("/library").documents).toHaveLength(30);
    const contexts = get("/contexts").contexts;
    expect(contexts).toHaveLength(5);
    for (const c of contexts) {
      expect(c.status).toBe("ready");
      expect(c.has_generated_resources).toBe(true);
      expect(c.has_key_terms).toBe(true);
      expect(c.source_doc_count).toBeGreaterThanOrEqual(4);
    }
    const convs = get("/conversations").conversations;
    expect(convs).toHaveLength(7);
    expect(convs.map((c) => c.updated_at_unix_ms)).toEqual([...convs.map((c) => c.updated_at_unix_ms)].sort((a, b) => b - a));
    expect(convs[0].preview.length).toBeGreaterThan(10);
  });

  it("answers a typed question with its canned, cited answer inside the right Context", () => {
    const larkspur = stub.records.contexts().find((c) => c.title === "Larkspur Foods renewal");
    const r = stub.handle({ method: "POST", path: "/ally", body: { request_id: "d1", kind: "ask", question: "How much notice do we need before renewal?", context_id: larkspur.id, segments: [] } });
    expect(r.status).toBe(200);
    const sources = r.lines[0].sources.map((s) => s.file_name);
    expect(sources).toContain("master-services-terms.md");
    const text = r.lines.filter((l) => l.type === "chunk").map((l) => l.token).join("");
    expect(text).toContain("60 days");
    expect(r.lines[r.lines.length - 1].type).toBe("done");
  });

  it("says plainly when it cannot find something, with no invented sources", () => {
    const larkspur = stub.records.contexts()[0];
    const r = stub.handle({ method: "POST", path: "/ally", body: { request_id: "d2", kind: "ask", question: "What is the capital of Peru?", context_id: larkspur.id, segments: [] } });
    expect(r.lines[0].sources).toEqual([]);
    expect(r.lines.filter((l) => l.type === "chunk").map((l) => l.token).join("")).toMatch(/could not find/i);
  });

  it("keeps the original single-document rehearsal seed when no dataset is given", () => {
    const plain = createCloudStub({});
    expect(plain.snapshot()).toMatchObject({ documents: 1, contexts: 1, conversations: 0 });
  });
});
