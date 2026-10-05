/* The demo dataset loader — turns `demo/` (documents, contexts, conversations,
 * canned answers) into one plain object the cloud stub can plant
 * (`createCloudStub({ dataset })` in `cloud.mjs`). The only I/O in the demo path;
 * everything else is pure so it is unit-tested without a browser. Everything in
 * `demo/` is fictional — see `demo/README.md`. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEMO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../demo");
/** The signed-in demo user the preview and showcase present (reserved example domain). */
export const DEMO_ACCOUNT = { email: "maya@example.com" };
export const SIDE = { you: "outbound", them: "inbound" };

const wordCount = (s) => (s.match(/\S+/g) ?? []).length;

/** Turns → transcript segments with believable timing: speaking time from word count, a short deterministic gap between turns. */
export function turnsToSegments(turns) {
  const seqBySide = { inbound: 0, outbound: 0 };
  let clock = 1500;
  return turns.map(([who, text], i) => {
    const side = SIDE[who];
    if (!side) throw new Error(`unknown speaker "${who}" (use you or them)`);
    const start = clock;
    const end = start + 700 + wordCount(text) * 360;
    clock = end + 450 + ((i * 7) % 5) * 220;
    seqBySide[side] += 1;
    return {
      side,
      seq: seqBySide[side],
      text,
      is_final: true,
      start_ms: start,
      end_ms: end,
      confidence: Math.round((0.88 + ((i * 7) % 10) / 100) * 100) / 100,
      latency_ms: 160 + ((i * 13) % 60),
    };
  });
}

/** Load `demo/` from disk. Pure data out; throws on a missing file so a broken dataset fails loudly. */
export function loadDemoDataset(dir = DEMO_DIR) {
  const readJson = (name) => JSON.parse(readFileSync(join(dir, name), "utf8"));
  const names = readdirSync(join(dir, "library")).filter((n) => !n.startsWith(".")).sort();
  const documents = names.map((name) => ({ name, text: readFileSync(join(dir, "library", name), "utf8") }));
  const contexts = readJson("contexts.json").contexts;
  const conversations = readJson("conversations.json").conversations.map((c) => ({ ...c, segments: turnsToSegments(c.turns) }));
  const answers = readJson("answers.json").answers;
  return { documents, contexts, conversations, answers };
}
