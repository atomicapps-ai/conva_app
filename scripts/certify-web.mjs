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

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const browserName = opt("browser", "chromium");
const duration = Number(opt("duration", "14"));
const outDir = resolve(opt("out", "certification"));
const distDir = resolve(opt("dist", "dist-web"));
const headed = flag("headed");
const tryShare = flag("share");
const DEFAULT_CHROMIUM = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find((p) => existsSync(p));
const executable = opt("executable", process.env.CONVA_CERTIFY_CHROMIUM || (browserName === "chromium" ? DEFAULT_CHROMIUM : undefined));

if (!existsSync(join(distDir, "index.html"))) {
  console.error(`No web build at ${distDir}. Run: npm run build:web`);
  process.exit(2);
}

const { chromium } = require("playwright-core");

/** Pull the latency figures out of the client's aggregates: per-channel final p50/p95 and the source health counts. */
/**
 * The hosted-processing notice (M2 cp16) renders as a dialog whose confirm
 * button carries the action ("Start listening" / "Share call audio"). Click it
 * when it appears; report what was shown so the row records that the build
 * asked. Returns null when no dialog appeared within the wait (older artifact).
 */
async function acknowledgeNotice(page, confirmName) {
  const dialog = page.getByRole("dialog");
  const appeared = await dialog.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
  if (!appeared) return null;
  const title = await dialog.getByRole("heading").first().innerText().catch(() => "");
  const confirm = dialog.getByRole("button", { name: confirmName }).first();
  await confirm.click();
  await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  return { title };
}

function summarizeTelemetry(aggregates) {
  const out = { final_latency_ms: {}, partial_latency_ms: {}, source: null };
  for (const a of aggregates) {
    const t = a && a.transcript ? a.transcript : {};
    for (const [ch, h] of Object.entries(t.final_by_channel || {})) if (h && typeof h.p50_ms === "number") out.final_latency_ms[ch] = { p50: h.p50_ms, p95: h.p95_ms, count: h.count };
    for (const [ch, h] of Object.entries(t.partial_by_channel || {})) if (h && typeof h.p50_ms === "number") out.partial_latency_ms[ch] = { p50: h.p50_ms, p95: h.p95_ms, count: h.count };
    if (a && a.source) out.source = a.source;
  }
  return out;
}
mkdirSync(outDir, { recursive: true });
const wavPath = join(outDir, ".certify-mic.wav");
writeFileSync(wavPath, synthWav({ sampleRate: 48_000, seconds: duration + 2 }));

const gw = await startGateway({ distDir });
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const startedAt = new Date();
let browser;
let row;
try {
  const launch = {
    headless: !headed,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${wavPath}`,
      "--autoplay-policy=no-user-gesture-required",
      "--no-sandbox",
      ...(tryShare ? ["--auto-accept-this-tab-capture", "--auto-select-desktop-capture-source=Entire screen"] : []),
    ],
  };
  if (executable) launch.executablePath = executable;
  else if (browserName !== "chromium") launch.channel = browserName;
  browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["microphone"] });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ""}`));

  await page.goto(`${gw.origin}/app/`, { waitUntil: "load" });
  const env = await page.evaluate(() => ({
    ua: navigator.userAgent,
    secureContext: window.isSecureContext,
    getUserMedia: !!navigator.mediaDevices?.getUserMedia,
    getDisplayMedia: !!navigator.mediaDevices?.getDisplayMedia,
    audioWorklet: typeof AudioWorkletNode === "function",
    webSocket: typeof WebSocket === "function",
    hardwareConcurrency: navigator.hardwareConcurrency,
  }));

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
