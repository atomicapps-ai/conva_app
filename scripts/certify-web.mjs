#!/usr/bin/env node
/* conva — browser certification run (M2 checkpoint 13).
 *
 * Drives the REAL web build (dist-web/, served at /app/) in a real browser
 * against a fake live gateway: Chromium's fake microphone plays a synthetic
 * WAV timed to the two-channel fixture, the app's capture pipeline (getUserMedia
 * → AudioWorklet → PCM16 batcher → live socket) runs unmodified, the gateway
 * counts the frames it receives and answers with the fixture's transcript
 * events, and the page is checked for the expected finals. The result is one
 * support-matrix row (JSON + a markdown line) — content-free statistics only.
 *
 *   npm run build:web
 *   npm run certify:web                      # pre-installed Chromium (Linux/CI)
 *   npm run certify:web -- --browser chrome  # installed Google Chrome (Windows/macOS)
 *   npm run certify:web -- --browser msedge  # installed Microsoft Edge
 *   options: --executable <path> --headed --duration <s> --out <dir> --share
 *
 * Needs `playwright-core` (devDependency; it never downloads a browser). */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import os from "node:os";
import { startGateway } from "./certify/gateway.mjs";
import { synthWav, EXPECTED_FINALS } from "./certify/lib.mjs";
import { DEFAULT_CHROMIUM, acknowledgeNotice, attachListeners, cliOptions, launchOptions, probeEnvironment, summarizeTelemetry } from "./certify/driver.mjs";

const require = createRequire(import.meta.url);
const { opt, flag } = cliOptions(process.argv.slice(2));

const browserName = opt("browser", "chromium");
const duration = Number(opt("duration", "14"));
const outDir = resolve(opt("out", "certification"));
const distDir = resolve(opt("dist", "dist-web"));
const headed = flag("headed");
const tryShare = flag("share");
const executable = opt("executable", process.env.CONVA_CERTIFY_CHROMIUM || (browserName === "chromium" ? DEFAULT_CHROMIUM : undefined));

if (!existsSync(join(distDir, "index.html"))) {
  console.error(`No web build at ${distDir}. Run: npm run build:web`);
  process.exit(2);
}

const { chromium } = require("playwright-core");

mkdirSync(outDir, { recursive: true });
const wavPath = join(outDir, ".certify-mic.wav");
writeFileSync(wavPath, synthWav({ sampleRate: 48_000, seconds: duration + 2 }));

const gw = await startGateway({ distDir });
const startedAt = new Date();
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

  // Start listening from wherever the app landed (Home tile or Live control bar).
  const startButton = page.getByRole("button", { name: /start (listening|session)|^start$|listen/i }).first();
  await startButton.waitFor({ state: "visible", timeout: 20_000 });
  const t0 = Date.now();
  await startButton.click();
  // cp16: the hosted-processing notice comes before the mic prompt — its
  // confirm button is the click that starts. A pre-cp16 artifact shows none.
  const noticeAck = await acknowledgeNotice(page, /start listening/i);

  // Wait for the first audio to reach the gateway (the real pipeline is live).
  const firstAudioDeadline = Date.now() + 15_000;
  while (Date.now() < firstAudioDeadline && ![...gw.stats.sources.values()].some((s) => s.frames > 0)) await page.waitForTimeout(100);
  const firstAudioMs = [...gw.stats.sources.values()].some((s) => s.frames > 0) ? Date.now() - t0 : null;

  let shareAck = null;
  if (tryShare) {
    const share = page.getByRole("button", { name: /share call audio/i }).first();
    if (await share.isVisible().catch(() => false)) {
      await share.click().catch(() => {});
      // Scope expansion has its own notice; its confirm is the gesture the chooser needs.
      shareAck = await acknowledgeNotice(page, /share call audio/i);
    }
  }

  // Let the fixture play out, then check the finals the page shows.
  await page.waitForTimeout(duration * 1000);
  const text = await page.evaluate(() => document.body.innerText);
  const attachedChannels = new Set([...gw.stats.sources.values()].map((s) => s.channel));
  const expected = EXPECTED_FINALS.filter((f) => attachedChannels.has(f.channel));
  const seen = expected.map((f) => ({ ...f, shown: text.includes(f.text) }));

  // The session's End control ("End 00:13" while listening) — never the share
  // source's "Stop sharing" or the recorder's "Stop recording".
  const stop = page.getByRole("button", { name: /^end\b/i }).first();
  const stopVisible = await stop.isVisible().catch(() => false);
  if (stopVisible) await stop.click().catch(() => {});
  // Give the client time to flush audio, send `stop`, receive `bye` and post its telemetry aggregate.
  const stopDeadline = Date.now() + 6000;
  while (Date.now() < stopDeadline && !(gw.stats.bye_sent && gw.stats.telemetry.length > 0)) await page.waitForTimeout(100);

  const summary = gw.summary();
  const mic = summary.sources.find((s) => s.channel === "self");
  const reasons = [];
  if (!summary.hello) reasons.push("no hello frame reached the gateway");
  if (!mic) reasons.push("no self (mic) source attached");
  else {
    if (mic.frames < 10) reasons.push(`only ${mic.frames} mic frames`);
    if (mic.mean_frame_ms < 80 || mic.mean_frame_ms > 300) reasons.push(`mic frame size ${mic.mean_frame_ms} ms outside 80–300 ms`);
    if (mic.voiced_frames === 0) reasons.push("mic audio is silent (fake capture not wired?)");
    if (mic.seq_gaps > 0) reasons.push(`${mic.seq_gaps} audio seq gaps`);
  }
  for (const f of seen) if (!f.shown) reasons.push(`final not shown: ${f.channel}`);
  if (!stopVisible) reasons.push("End control not found — session never stopped");
  else if (!summary.bye_sent) reasons.push("stop did not reach the gateway");
  if (summary.telemetry.length === 0) reasons.push("no telemetry aggregate posted");
  if (pageErrors.length) reasons.push(`${pageErrors.length} page errors`);
  if (summary.protocol_errors.length) reasons.push(...summary.protocol_errors);

  row = {
    ran_at: startedAt.toISOString(),
    browser: { requested: browserName, version: browser.version(), executable: executable || null, channel: executable ? null : browserName, headless: !headed, ua: env.ua },
    os: { platform: process.platform, release: os.release(), arch: process.arch },
    capabilities: { secureContext: env.secureContext, getUserMedia: env.getUserMedia, getDisplayMedia: env.getDisplayMedia, audioWorklet: env.audioWorklet, webSocket: env.webSocket },
    capture_mode: attachedChannels.has("remote_mix") ? "mic+share" : "mic",
    hello: summary.hello,
    sessions_created: summary.sessions_created,
    // cp16: the notice the build showed before capture and on scope expansion, and what it sent.
    notice: { start: noticeAck, share: shareAck, consent: summary.consent },
    first_audio_ms: firstAudioMs,
    sources: summary.sources,
    transcript: { expected: expected.length, shown: seen.filter((s) => s.shown).length, finals: seen },
    telemetry_posts: summary.telemetry.length,
    // The client's own content-free measurement of the run (what it would post to the real gateway).
    telemetry: summarizeTelemetry(summary.telemetry),
    bye_sent: summary.bye_sent,
    console_errors: consoleErrors,
    page_errors: pageErrors,
    failed_requests: failedRequests.filter((r) => !r.includes("/api/live/ally")),
    verdict: reasons.length ? "fail" : "pass",
    reasons,
  };
} finally {
  await browser?.close().catch(() => {});
  await gw.close();
}

const stamp = startedAt.toISOString().slice(0, 10);
const safe = (s) => String(s).replace(/[^A-Za-z0-9.-]+/g, "_");
const file = join(outDir, `${stamp}-${safe(row.browser.requested)}-${safe(row.os.platform)}-${row.capture_mode}.json`);
writeFileSync(file, JSON.stringify(row, null, 2) + "\n");
const mic = row.sources.find((s) => s.channel === "self");
const lat = Object.entries(row.telemetry.final_latency_ms).map(([ch, l]) => `${ch} p50 ${l.p50} / p95 ${l.p95}`).join(", ") || "–";
const md = `| ${stamp} | ${row.browser.requested} ${row.browser.version} | ${row.os.platform} ${row.os.arch} | ${row.capture_mode}${row.browser.headless ? " (headless)" : ""} | ${row.first_audio_ms ?? "–"} ms | ${mic ? `${mic.frames} × ${mic.mean_frame_ms} ms, ${mic.rms_dbfs ?? "–"} dBFS, ${mic.seq_gaps} gaps` : "no mic source"} | ${row.transcript.shown}/${row.transcript.expected} | ${lat} | ${row.verdict.toUpperCase()}${row.reasons.length ? ` — ${row.reasons.join("; ")}` : ""} |`;
console.log(`\n${row.verdict.toUpperCase()} — ${file}\n${md}\n`);
if (row.console_errors.length) console.log("console errors:", row.console_errors.slice(0, 5));
process.exit(row.verdict === "pass" ? 0 : 1);
