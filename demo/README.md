# Demo dataset

A clean, organised, **entirely fictional** workspace that shows what conva looks like when it is used properly. It is the single source for:

- the browser tests and showcase recordings (loaded into the cloud stub in `scripts/certify/`), and
- later, a dedicated demo account on the dev deployment (a separate loader, not built yet).

## The world

**Brightwater Labs**, a workflow-software company, and its Brightwater Flow product. Customers, partners and people are made up (Larkspur Foods, Marlow Cold Storage, Cedarline Logistics, Quill Analytics, Elena Voss, Dana Whitfield). Emails use `example.com`, phones use 555-01xx. Nothing here is real; a test enforces this.

## What is in it

| Folder or file | What |
|---|---|
| `library/` | 30 documents: markdown and CSV text (the stub extracts text only; Word and PDF come with the real-account loader) |
| `contexts.json` | 5 Contexts, one per category, each with key terms, glossary, personas and a generated briefing |
| `conversations.json` | 7 saved conversations with two-sided transcripts |
| `answers.json` | Canned cited answers the stub gives for the questions the showcase asks |

## Rules for editing

- Keep numbers consistent across files (the quote, the usage table and the Q&A agree). `demoDataset.test.mjs` checks the references; it cannot check the arithmetic story, so re-read before changing a figure.
- Fictional only: no real people, companies or customer data. No real URLs (use `example.com`).
- Keep the whole folder under 1 MB (a test enforces this).
- Conversations are written as turns (`you` / `them`) and given timings by the loader.
