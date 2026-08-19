#!/usr/bin/env node
// FANER offline rubric-eval harness.
//
// Feeds each turn of the golden transcript through an LLM using the FANER
// capture rubric, then scores the produced captures against the owner-labeled
// ground truth. This tests the *brain* (does the model, given our rubric,
// route correctly?) with no app, audio, or UI in the loop.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... node scripts/faner-eval.mjs
//   node scripts/faner-eval.mjs --stub scripts/faner-eval.stub.json   # offline, no key: score canned replies
//   node scripts/faner-eval.mjs --fixture ../conva_core/docs/technical/faner-golden-transcript.json --model claude-...
//
// Design docs: ../conva_core/docs/technical/faner-capture-algorithm.md
//
// The rubric below is the prompt-ready version from that doc. Keep them in sync.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const FIXTURE = opt("--fixture", "../conva_core/docs/technical/faner-golden-transcript.json");
const STUB = opt("--stub", null);
const MODEL = opt("--model", "claude-sonnet-5");
const ARG_OVERLAP_MIN = 0.5; // fraction of an expected capture's args that must appear to count as matched

const RUBRIC = `You assist a user during a live conversation. You receive the OTHER party's latest utterance plus the user's PREPARED CONTEXT (their role and the terms already on their résumé). Decide what to surface to help the user answer right now.

For the utterance:
1. Find the QUESTIONS first — a question is the clearest signal of what the user must address.
2. Extract TASK FRAMES — (verb + arguments); split a compound ask into separate items.
3. For each item choose an ACTION by its relationship to the prepared context:
   - term NOT in prepared context (a gap) -> EXPLAIN
   - term IN the prepared context, referenced back ("on your résumé", "you mentioned") -> RECALL
   - a task to perform -> ASSIST
   - a keyword-free behavioral/hypothetical question -> SYNTHESIZE
4. Choose a TRIGGER for each item: "question", "task_frame", "prep_reference", or "gap".
5. Skip anything with no marginal value — do NOT surface a term the user plainly already owns unless the other party attaches something new to it.

Respond with ONLY a JSON object, no prose, no code fences, matching exactly:
{"captures":[{"trigger":"question|task_frame|prep_reference|gap","action":"EXPLAIN|RECALL|ASSIST|SYNTHESIZE","arguments":[string,...]}]}
arguments are the operands of the item (the tool/topic/task), lowercased or as spoken. Empty captures array is allowed.`;

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9/ ]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s) => new Set(norm(s).split(" ").filter(Boolean));

function argsOverlap(expected, produced) {
  // fraction of expected arg-tokens that appear somewhere in the produced arg-tokens
  const exp = new Set();
  for (const a of expected) for (const t of tokens(a)) exp.add(t);
  const prod = new Set();
  for (const a of produced) for (const t of tokens(a)) prod.add(t);
  if (exp.size === 0) return 1;
  let hit = 0;
  for (const t of exp) if (prod.has(t)) hit++;
  return hit / exp.size;
}

function matchCapture(expected, produced) {
  return produced.some(
    (p) =>
      norm(p.trigger) === norm(expected.trigger) &&
      norm(p.action) === norm(expected.action) &&
      argsOverlap(expected.arguments || [], p.arguments || []) >= ARG_OVERLAP_MIN
  );
}

function silenceViolations(silence, produced) {
  // Heuristic, human-reviewable. Two kinds of silence entry:
  //  - qualified "X (... definition / standalone / chip ...)": X is fine as an
  //    argument or via RECALL/ASSIST/SYNTHESIZE; only a bare EXPLAIN on X alone
  //    is a violation (surfacing it as its own definition chip).
  //  - plain "X": X should not be surfaced as a capture on its own at all —
  //    violation iff a capture's whole argument set is just X.
  const out = [];
  for (const s of silence || []) {
    const paren = /\(([^)]*)\)/.exec(s);
    const core = norm(s.replace(/\(.*\)/, "")); // strip the qualifier
    const coreTokens = tokens(core);
    const qualifiedDefn = paren && /definition|standalone|chip/.test(paren[1].toLowerCase());
    for (const p of produced) {
      const pt = new Set();
      for (const a of p.arguments || []) for (const t of tokens(a)) pt.add(t);
      const soleCore = pt.size === coreTokens.size && [...coreTokens].every((t) => pt.has(t));
      if (qualifiedDefn) {
        if (norm(p.action) === "explain" && soleCore) out.push({ silenced: s, capture: p });
      } else if (soleCore) {
        out.push({ silenced: s, capture: p });
      }
    }
  }
  return out;
}

async function callModel(turn, ctx) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set (use --stub to score canned replies offline)");
  const user = `PREPARED CONTEXT\nrole: ${ctx.role}\nrésumé terms: ${(ctx.resume_terms || []).join(", ")}\n\nOTHER PARTY SAID:\n"${turn.utterance}"`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: RUBRIC,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.map((b) => b.text || "").join("") ?? "";
}

function parseCaptures(reply) {
  const s = reply.indexOf("{");
  const e = reply.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(reply.slice(s, e + 1)).captures ?? [];
  } catch {
    return null;
  }
}

async function main() {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const ctx = fixture.prepared_context;
  const stub = STUB ? JSON.parse(readFileSync(STUB, "utf8")) : null;

  console.log(`FANER rubric eval — ${stub ? "STUB mode (offline)" : `live model: ${MODEL}`}`);
  console.log(`fixture: ${FIXTURE}  ·  role: ${ctx.role}  ·  terms: ${(ctx.resume_terms || []).join(", ")}\n`);

  let totalExpected = 0;
  let totalMatched = 0;
  let anySilence = false;

  for (const turn of fixture.turns) {
    const expected = turn.expected_captures || [];
    let reply;
    try {
      reply = stub ? JSON.stringify({ captures: stub[turn.id] ?? [] }) : await callModel(turn, ctx);
    } catch (err) {
      console.log(`✗ ${turn.id}: ${err.message}`);
      return process.exit(1);
    }
    const produced = parseCaptures(reply) ?? [];
    const matched = expected.filter((e) => matchCapture(e, produced));
    const missed = expected.filter((e) => !matchCapture(e, produced));
    const sil = silenceViolations(turn.expected_silence, produced);

    totalExpected += expected.length;
    totalMatched += matched.length;
    if (sil.length) anySilence = true;

    const ok = missed.length === 0 && sil.length === 0;
    console.log(`${ok ? "✓" : "✗"} ${turn.id}  (${matched.length}/${expected.length} captures)  "${turn.utterance.slice(0, 58)}…"`);
    for (const m of missed) console.log(`    MISS  ${m.trigger} → ${m.action}(${(m.arguments || []).join(", ")})`);
    for (const s of sil) console.log(`    SILENCE?  surfaced "${(s.capture.arguments || []).join(", ")}" — expected quiet on "${s.silenced}"`);
  }

  const pct = totalExpected ? Math.round((100 * totalMatched) / totalExpected) : 0;
  console.log(`\nrecall: ${totalMatched}/${totalExpected} expected captures produced (${pct}%)`);
  console.log(`silence: ${anySilence ? "review flags above" : "clean"}`);
  process.exit(totalMatched === totalExpected && !anySilence ? 0 : 2);
}

main();
