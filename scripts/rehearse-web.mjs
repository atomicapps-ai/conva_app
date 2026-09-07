#!/usr/bin/env node
/* conva — first-run rehearsal (M2 checkpoints 19–20).
 *
 * The owner's first end-to-end run on dev follows
 * `conva_core/docs/technical/2026-09-beta-first-run-checklist.md`. This script
 * rehearses its app-side steps in the REAL web build (dist-web/, served at
 * /app/) in a real browser before anyone sits down: the certification
 * gateway carries capture (fake microphone, fixture transcripts) and an
 * in-memory stub of the cloud slice (`scripts/certify/cloud.mjs`, unseeded —
 * the material below is created through the real UI, the way the owner will)
 * carries the rest. Steps rehearsed, numbered as in the checklist:
 *
 *   2  Library → paste text → appears, ingested, no error
 *   3  Library → upload a file → appears with its name; download returns the original
 *   4  Contexts → create a Context, attach both documents → saved; reopening
 *      shows the same fields and attachments
 *   5  activate the Context, Start → hosted-processing notice → microphone
 *   6  finals appear in YOUR column
 *   7  Share call audio → scope notice → chooser (only with --share)
 *   8  Ask box → a streamed answer citing the document
 *   10 End → stop reaches the gateway, telemetry posted
 *   11 Save conversation → listed in History, reopens with its transcript
 *   12 delete it → gone
 *
 * Steps 1, 9, 13–15 need the real deployment (sign-in, /ops, the provider
 * console) and stay the owner's. The result is one content-free row (JSON +
 * a markdown line): step verdicts, timings, counts.
 *
 *   npm run build:web
 *   npm run rehearse:web                      # pre-installed Chromium (Linux/CI)
 *   npm run rehearse:web -- --browser chrome  # installed Google Chrome (Windows/macOS)
 *   options: --executable <path> --headed --duration <s> --out <dir> --share
 *
 * Needs `playwright-core` (devDependency; it never downloads a browser). */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import os from "node:os";
import { startGateway } from "./certify/gateway.mjs";
import { synthWav, EXPECTED_FINALS } from "./certify/lib.mjs";
import { REHEARSAL_CONTEXT, REHEARSAL_DOC, REHEARSAL_FACT, REHEARSAL_QUESTION, REHEARSAL_UPLOAD, createCloudStub } from "./certify/cloud.mjs";
import { DEFAULT_CHROMIUM, acknowledgeNotice, attachListeners, cliOptions, launchOptions, probeEnvironment, summarizeTelemetry, waitFor } from "./certify/driver.mjs";

/** The "Other documents" attach checkbox — exact, so it doesn't also match
 *  the same file's per-slot "Attach <name> to <slot>" checkboxes (a category
 *  with slots, e.g. "interview", shows one of those per slot in addition). */
const attachCheckbox = (scope, name) => scope.getByRole("checkbox", { name: `Attach ${name}`, exact: true });

const require = createRequire(import.meta.url);
const { opt, flag } = cliOptions(process.argv.slice(2));

const browserName = opt("browser", "chromium");
const duration = Number(opt("duration", "14"));
const outDir = resolve(opt("out", "rehearsal"));
const distDir = resolve(opt("dist", "dist-web"));
const headed = flag("headed");
const tryShare = flag("share");
const executable = opt("executable", process.env.CONVA_CERTIFY_CHROMIUM || (browserName === "chromium" ? DEFAULT_CHROMIUM : undefined));
const CONVERSATION_TITLE = "Rehearsal conversation";

if (!existsSync(join(distDir, "index.html"))) {
  console.error(`No web build at ${distDir}. Run: npm run build:web`);
  process.exit(2);
}

const { chromium } = require("playwright-core");

mkdirSync(outDir, { recursive: true });
const wavPath = join(outDir, ".rehearse-mic.wav");
writeFileSync(wavPath, synthWav({ sampleRate: 48_000, seconds: duration + 2 }));

// Unseeded (M2 cp20): steps 2-4 create the Context and its documents through
// the real UI, the way the owner's run will — the same material cp19's
// rehearsal used to get for free from the stub.
const cloud = createCloudStub({ seed: false });
const gw = await startGateway({ distDir, cloud, sessionId: "live_rehearsal" });
const startedAt = new Date();
const steps = [];
/** One checklist step's verdict; `detail` is content-free (timings, counts, what was shown). */
const record = (step, name, ok, detail = {}) => {
  steps.push({ step, name, ok: !!ok, ...detail });
  return !!ok;
};
const bodyText = (page) => page.evaluate(() => document.body.innerText);
let browser;
let row;
let consoleErrors = [];
let pageErrors = [];
let failedRequests = [];
try {
  browser = await chromium.launch(launchOptions({ headed, wavPath, share: tryShare, executable, browserName }));
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["microphone"] });
  const page = await context.newPage();
  ({ consoleErrors, pageErrors, failedRequests } = attachListeners(page));

  await page.goto(`${gw.origin}/app/`, { waitUntil: "load" });
  const env = await probeEnvironment(page);

  const appNav = page.getByRole("navigation", { name: /^app$/i });

  // ── 2: Library → paste text → appears, ingested, no error.
  const libraryRail = appNav.getByRole("button", { name: /^library$/i }).first();
  const libraryOpened = await libraryRail.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  if (libraryOpened) await libraryRail.click();
  const pasteTrigger = page.getByRole("button", { name: /^add a pasted note$/i }).first();
  let pasted = false;
  let pasteError = null;
  if (await pasteTrigger.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false)) {
    await pasteTrigger.click();
    await page.getByPlaceholder(/paste notes, a snippet/i).fill(REHEARSAL_DOC.text);
    await page.getByLabel(/^note title$/i).fill(REHEARSAL_DOC.name);
    await page.getByRole("button", { name: /^save$/i }).click();
    pasted = (await waitFor(page, async () => (await bodyText(page)).includes(REHEARSAL_DOC.name), 6000)) !== null;
    const notice = await page.getByRole("status").innerText().catch(() => "");
    if (/couldn't|error|failed/i.test(notice)) pasteError = notice;
  }
  record(2, "Library → paste text → ingested", libraryOpened && pasted && !pasteError, { library_opened: libraryOpened, ingested: pasted, error: pasteError, documents: cloud.snapshot().documents });

  // ── 3: Library → upload a file → appears with its name.
  const fileInput = page.locator('input[type="file"]');
  let uploaded = false;
  const uploadVisible = await fileInput.count().then((n) => n > 0).catch(() => false);
  if (uploadVisible) {
    await fileInput.setInputFiles({ name: REHEARSAL_UPLOAD.name, mimeType: "text/markdown", buffer: Buffer.from(REHEARSAL_UPLOAD.text, "utf8") });
    uploaded = (await waitFor(page, async () => (await bodyText(page)).includes(REHEARSAL_UPLOAD.name), 6000)) !== null;
  }
  // Download returns the original: the row's "…" menu → Download, captured as a real browser download.
  let downloadIntact = false;
  if (uploaded) {
    await page.getByRole("button", { name: `More actions for ${REHEARSAL_UPLOAD.name}` }).first().click();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 6000 }).catch(() => null),
      page.getByRole("menuitem", { name: /^download$/i }).click(),
    ]);
    if (download) {
      const savedPath = join(outDir, ".rehearse-download");
      await download.saveAs(savedPath);
      downloadIntact = readFileSync(savedPath, "utf8") === REHEARSAL_UPLOAD.text;
    }
  }
  record(3, "Library → upload a file → appears; download returns the original", uploadVisible && uploaded && downloadIntact, { upload_input: uploadVisible, appeared: uploaded, download_intact: downloadIntact, documents: cloud.snapshot().documents });

  // ── 4: Contexts → create a Context, attach both documents → saved; reopening shows the same fields and attachments.
  const contextsRail = appNav.getByRole("button", { name: /^contexts$/i }).first();
  const contextsOpened = await contextsRail.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  if (contextsOpened) await contextsRail.click();
  const newContext = page.getByRole("button", { name: /^new context$/i }).first();
  let contextSaved = false;
  let attachedBoth = false;
  let reopenedSame = false;
  if (await newContext.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false)) {
    await newContext.click();
    await page.getByLabel(/^name$/i).fill(REHEARSAL_CONTEXT.title);
    await page.getByLabel(/^goal/i).fill(REHEARSAL_CONTEXT.purpose);
    await page.getByRole("button", { name: /^next$/i }).click();
    // Step 2: attach the two documents just created above, and the key terms.
    await attachCheckbox(page, REHEARSAL_DOC.name).check();
    await attachCheckbox(page, REHEARSAL_UPLOAD.name).check();
    attachedBoth = (await attachCheckbox(page, REHEARSAL_DOC.name).isChecked()) && (await attachCheckbox(page, REHEARSAL_UPLOAD.name).isChecked());
    await page.getByPlaceholder(/pensive theory/).fill(REHEARSAL_CONTEXT.key_terms.join("\n"));
    await page.getByRole("button", { name: /^next$/i }).click();
    // Step 3: Finish. On web this awaits `context.prepare` (M2 cp20 — a
    // no-op that marks the record ready; before this checkpoint it always
    // rejected and no Context could ever be created through the web wizard).
    await page.getByRole("button", { name: /^finish$/i }).click();
    contextSaved = (await waitFor(page, async () => (await bodyText(page)).includes(REHEARSAL_CONTEXT.title), 8000)) !== null;
    if (contextSaved) {
      // Reopen: the same fields and attachments come back.
      await page.getByRole("button", { name: `Edit setup for ${REHEARSAL_CONTEXT.title}` }).first().click();
      const nameBack = await page.getByLabel(/^name$/i).inputValue();
      const goalBack = await page.getByLabel(/^goal/i).inputValue();
      await page.getByRole("button", { name: /^next$/i }).click();
      const docsAttached = (await attachCheckbox(page, REHEARSAL_DOC.name).isChecked()) && (await attachCheckbox(page, REHEARSAL_UPLOAD.name).isChecked());
      reopenedSame = nameBack === REHEARSAL_CONTEXT.title && goalBack === REHEARSAL_CONTEXT.purpose && docsAttached;
      await page.getByRole("button", { name: /^back$/i }).first().click().catch(() => page.keyboard.press("Escape"));
    }
  }
  record(4, "Contexts → create + attach both documents → saved; reopens the same", contextsOpened && attachedBoth && contextSaved && reopenedSame, { attached_both: attachedBoth, saved: contextSaved, reopened_same: reopenedSame, contexts: cloud.snapshot().contexts });

  // ── 5a: activate the Context just created, from the Live view's grounding picker.
  // The picker's trigger is the active-Context chip ("General" on a fresh web
  // session, titled "Change what Ally is grounded on") or, with nothing
  // active, the "Select context" button — the title attribute names both.
  const liveRail = page.getByRole("button", { name: /^live session$/i }).first();
  if (await liveRail.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) await liveRail.click();
  // Wait for the boot-time default grounding to land (the chip appears) before
  // opening the picker: activating before it resolves races the boot's own
  // "General" activation and the title flips back — an automation-speed race,
  // not a step a person can reach.
  const groundingChip = page.getByTitle(/change what ally is grounded on/i).first();
  const chipShown = await groundingChip.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  const selectContext = page.getByTitle(/change what ally is grounded on|select what ally is grounded in/i).first();
  let contextActivated = false;
  let includeShown = false;
  let pickerClosed = false;
  if (await selectContext.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) {
    await selectContext.click();
    const picker = page.getByRole("dialog", { name: /select context/i });
    const include = picker.getByRole("checkbox", { name: `Include ${REHEARSAL_CONTEXT.title}` });
    includeShown = await include.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
    if (includeShown) {
      await include.check();
      await picker.getByRole("button", { name: /^select$/i }).click();
      pickerClosed = (await waitFor(page, async () => !(await picker.isVisible().catch(() => false)), 5000)) !== null;
      contextActivated = (await waitFor(page, async () => (await bodyText(page)).includes(REHEARSAL_CONTEXT.title), 5000)) !== null;
    }
  }
  record("5a", "Context activated (grounding picker)", contextActivated, { chip_shown: chipShown, include_shown: includeShown, picker_closed: pickerClosed, title_shown: contextActivated });

  // ── 5: Start → hosted-processing notice → microphone (first audio at the gateway).
  const startButton = page.getByRole("button", { name: /start (listening|session)|^start$|listen/i }).first();
  await startButton.waitFor({ state: "visible", timeout: 20_000 });
  const t0 = Date.now();
  await startButton.click();
  const noticeAck = await acknowledgeNotice(page, /start listening/i);
  const firstAudioMs = await waitFor(page, async () => [...gw.stats.sources.values()].some((s) => s.frames > 0), 15_000);
  record(5, "Start → notice → microphone", noticeAck !== null && firstAudioMs !== null, { notice: noticeAck, first_audio_ms: firstAudioMs });

  // ── 7: Share call audio → scope notice → chooser (auto-accepted by the launch flags).
  let shareAck = null;
  if (tryShare) {
    const share = page.getByRole("button", { name: /share call audio/i }).first();
    const visible = await share.isVisible().catch(() => false);
    if (visible) {
      await share.click().catch(() => {});
      shareAck = await acknowledgeNotice(page, /share call audio/i);
    }
    const remoteAttached = await waitFor(page, async () => [...gw.stats.sources.values()].some((s) => s.channel === "remote_mix"), 8000);
    record(7, "Share call audio → notice → chooser", visible && shareAck !== null && remoteAttached !== null, { notice: shareAck, remote_attached_ms: remoteAttached });
  }

  // ── 6: the fixture plays out; the finals must be on the page.
  await page.waitForTimeout(duration * 1000);
  const attachedChannels = new Set([...gw.stats.sources.values()].map((s) => s.channel));
  const expected = EXPECTED_FINALS.filter((f) => attachedChannels.has(f.channel));
  const afterFixture = await bodyText(page);
  const seen = expected.map((f) => ({ channel: f.channel, shown: afterFixture.includes(f.text) }));
  record(6, "Finals shown per attached channel", expected.length > 0 && seen.every((s) => s.shown), { expected: expected.length, shown: seen.filter((s) => s.shown).length, channels: [...attachedChannels] });

  // ── 8: Ask box → streamed answer citing the document.
  const ask = page.getByRole("textbox", { name: /^ask ally$/i }).first();
  const askVisible = await ask.isVisible().catch(() => false);
  let answerMs = null;
  let cited = false;
  if (askVisible) {
    await ask.fill(REHEARSAL_QUESTION);
    await ask.press("Enter");
    answerMs = await waitFor(page, async () => (await bodyText(page)).includes(REHEARSAL_FACT), 15_000);
    cited = (await waitFor(page, async () => (await bodyText(page)).includes(`Grounded in ${REHEARSAL_DOC.name}`), 5000)) !== null;
  }
  const allyReq = cloud.stats.ally[0] ?? null;
  // A stream that ended badly shows on the card as "(stream_truncated)" / "(stream_interrupted)".
  const cardError = /stream_truncated|stream_interrupted|\(network\)/.test(await bodyText(page));
  record(8, "Ask → streamed, cited answer", askVisible && answerMs !== null && cited && !cardError && allyReq !== null && allyReq.sources > 0 && (!contextActivated || allyReq.context_id), { ask_box: askVisible, answer_ms: answerMs, citation_shown: cited, card_error: cardError, request: allyReq });

  // ── 10: End → stop reaches the gateway, telemetry posted.
  const stop = page.getByRole("button", { name: /^end\b/i }).first();
  const stopVisible = await stop.isVisible().catch(() => false);
  if (stopVisible) await stop.click().catch(() => {});
  const ended = await waitFor(page, async () => gw.stats.bye_sent && gw.stats.telemetry.length > 0, 8000);
  record(10, "End → bye + telemetry", stopVisible && ended !== null, { end_control: stopVisible, settle_ms: ended, telemetry_posts: gw.stats.telemetry.length });

  // ── 11: Save conversation → listed in History → reopens with its transcript.
  const saveHeading = page.getByRole("heading", { name: /save this conversation\?/i });
  const saveOffered = await saveHeading.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
  let saved = false;
  let listed = false;
  let reopened = false;
  if (saveOffered) {
    await page.getByLabel(/^title$/i).fill(CONVERSATION_TITLE);
    await page.getByRole("button", { name: /^save$/i }).click();
    saved = (await waitFor(page, async () => cloud.snapshot().conversations === 1, 5000)) !== null;
    const history = page.getByRole("button", { name: /^history$/i }).first();
    if (await history.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
      await history.click();
      const rowButton = page.getByRole("button", { name: CONVERSATION_TITLE, exact: true }).first();
      listed = await rowButton.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
      if (listed) {
        // Reopen in Live: the stored finals come back on the page.
        await page.getByRole("button", { name: `Open ${CONVERSATION_TITLE} in Live` }).first().click();
        const selfFinal = EXPECTED_FINALS.find((f) => f.channel === "self").text;
        reopened = (await waitFor(page, async () => (await bodyText(page)).includes(selfFinal), 6000)) !== null;
        await page.getByRole("button", { name: /^history$/i }).first().click();
        await rowButton.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
      }
    }
  }
  record(11, "Save conversation → in History → reopens", saveOffered && saved && listed && reopened, { save_offered: saveOffered, saved, listed, reopened });

  // ── 12: delete it → gone from the list and from the store.
  let deleted = false;
  if (listed) {
    const del = page.getByRole("button", { name: `Delete ${CONVERSATION_TITLE}` }).first();
    if (await del.isVisible().catch(() => false)) {
      await del.click();
      deleted = (await waitFor(page, async () => cloud.snapshot().conversations === 0 && !(await page.getByRole("button", { name: CONVERSATION_TITLE, exact: true }).first().isVisible().catch(() => false)), 6000)) !== null;
    }
  }
  record(12, "Delete conversation → gone", deleted, { deleted });

  const summary = gw.summary();
  const reasons = steps.filter((s) => !s.ok).map((s) => `step ${s.step} failed: ${s.name}`);
  if (pageErrors.length) reasons.push(`${pageErrors.length} page errors`);
  if (summary.protocol_errors.length) reasons.push(...summary.protocol_errors);

  row = {
    kind: "first-run-rehearsal",
    ran_at: startedAt.toISOString(),
    browser: { requested: browserName, version: browser.version(), executable: executable || null, channel: executable ? null : browserName, headless: !headed, ua: env.ua },
    os: { platform: process.platform, release: os.release(), arch: process.arch },
    capabilities: { secureContext: env.secureContext, getUserMedia: env.getUserMedia, getDisplayMedia: env.getDisplayMedia, audioWorklet: env.audioWorklet, webSocket: env.webSocket },
    capture_mode: attachedChannels.has("remote_mix") ? "mic+share" : "mic",
    steps,
    hello: summary.hello,
    consent: summary.consent,
    sources: summary.sources,
    ally: cloud.stats.ally,
    cloud: summary.cloud,
    telemetry: summarizeTelemetry(summary.telemetry),
    bye_sent: summary.bye_sent,
    console_errors: consoleErrors,
    page_errors: pageErrors,
    // Chromium reports the Ally stream's normal end as `net::ERR_ABORTED` on the
    // fetch (the reader drains the last line and the body closes); the card's own
    // terminal line is the truth for step 8, so that one entry is informational.
    failed_requests: failedRequests.filter((r) => !(r.includes("/api/live/ally") && r.includes("ERR_ABORTED"))),
    failed_requests_informational: failedRequests.filter((r) => r.includes("/api/live/ally") && r.includes("ERR_ABORTED")),
    verdict: reasons.length ? "fail" : "pass",
    reasons,
  };
} finally {
  await browser?.close().catch(() => {});
  await gw.close();
}

const stamp = startedAt.toISOString().slice(0, 10);
const safe = (s) => String(s).replace(/[^A-Za-z0-9.-]+/g, "_");
const file = join(outDir, `${stamp}-${safe(row.browser.requested)}-${safe(row.os.platform)}-${row.capture_mode}-rehearsal.json`);
writeFileSync(file, JSON.stringify(row, null, 2) + "\n");
const passed = row.steps.filter((s) => s.ok).length;
const stepList = row.steps.map((s) => `${s.step}${s.ok ? "✓" : "✗"}`).join(" ");
const md = `| ${stamp} | ${row.browser.requested} ${row.browser.version} | ${row.os.platform} ${row.os.arch} | ${row.capture_mode}${row.browser.headless ? " (headless)" : ""} | ${passed}/${row.steps.length} (${stepList}) | ${row.verdict.toUpperCase()}${row.reasons.length ? ` — ${row.reasons.join("; ")}` : ""} |`;
console.log(`\n${row.verdict.toUpperCase()} — ${file}\n${md}\n`);
if (row.console_errors.length) console.log("console errors:", row.console_errors.slice(0, 5));
process.exit(row.verdict === "pass" ? 0 : 1);
