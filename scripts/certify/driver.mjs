/* Shared browser-driving helpers for the certification run (`certify-web.mjs`)
 * and the first-run rehearsal (`rehearse-web.mjs`): the CLI option reader, the
 * Chromium launch (fake microphone fed from a WAV, optional auto-accepted tab
 * capture), the page's error/failed-request listeners, and the hosted-processing
 * notice click-through. Both scripts must launch the same way — a row is only
 * comparable to another row if the browser was set up identically. */
import { existsSync } from "node:fs";

export function cliOptions(argv) {
  const opt = (name, def) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
  };
  const flag = (name) => argv.includes(`--${name}`);
  return { opt, flag };
}

export const DEFAULT_CHROMIUM = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find((p) => existsSync(p));

/** Playwright launch options: Chromium's fake media devices, the WAV as the microphone, tab capture auto-accepted when `share`. */
export function launchOptions({ headed, wavPath, share, executable, browserName }) {
  const launch = {
    headless: !headed,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${wavPath}`,
      "--autoplay-policy=no-user-gesture-required",
      "--no-sandbox",
      ...(share ? ["--auto-accept-this-tab-capture", "--auto-select-desktop-capture-source=Entire screen"] : []),
    ],
  };
  if (executable) launch.executablePath = executable;
  else if (browserName !== "chromium") launch.channel = browserName;
  return launch;
}

/** Collect console errors, page errors and failed requests (paths only — never bodies). */
export function attachListeners(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ""}`));
  return { consoleErrors, pageErrors, failedRequests };
}

/** The browser-side capability probe recorded on every row. */
export function probeEnvironment(page) {
  return page.evaluate(() => ({
    ua: navigator.userAgent,
    secureContext: window.isSecureContext,
    getUserMedia: !!navigator.mediaDevices?.getUserMedia,
    getDisplayMedia: !!navigator.mediaDevices?.getDisplayMedia,
    audioWorklet: typeof AudioWorkletNode === "function",
    webSocket: typeof WebSocket === "function",
    hardwareConcurrency: navigator.hardwareConcurrency,
  }));
}

/**
 * The hosted-processing notice (M2 cp16) renders as a dialog whose confirm
 * button carries the action ("Start listening" / "Share call audio"). Click it
 * when it appears; report what was shown so the row records that the build
 * asked. Returns null when no dialog appeared within the wait (older artifact).
 */
export async function acknowledgeNotice(page, confirmName) {
  const dialog = page.getByRole("dialog");
  const appeared = await dialog.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
  if (!appeared) return null;
  const title = await dialog.getByRole("heading").first().innerText().catch(() => "");
  const confirm = dialog.getByRole("button", { name: confirmName }).first();
  await confirm.click();
  await dialog.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  return { title };
}

/** Poll `cond` every 100 ms until it holds or `ms` elapse; resolves the elapsed time or null on timeout. */
export async function waitFor(page, cond, ms) {
  const t0 = Date.now();
  const deadline = t0 + ms;
  while (Date.now() < deadline) {
    if (await cond()) return Date.now() - t0;
    await page.waitForTimeout(100);
  }
  return (await cond()) ? Date.now() - t0 : null;
}

/** Latency figures from the client's telemetry aggregates: per-channel final/partial p50/p95 and the source health counts. */
export function summarizeTelemetry(aggregates) {
  const out = { final_latency_ms: {}, partial_latency_ms: {}, source: null, ally: null };
  for (const a of aggregates) {
    const t = a && a.transcript ? a.transcript : {};
    for (const [ch, h] of Object.entries(t.final_by_channel || {})) if (h && typeof h.p50_ms === "number") out.final_latency_ms[ch] = { p50: h.p50_ms, p95: h.p95_ms, count: h.count };
    for (const [ch, h] of Object.entries(t.partial_by_channel || {})) if (h && typeof h.p50_ms === "number") out.partial_latency_ms[ch] = { p50: h.p50_ms, p95: h.p95_ms, count: h.count };
    if (a && a.source) out.source = a.source;
    // The client's own verdict on its Ally requests (ok / error / refused + codes) — the
    // signal for "the answer stream completed", independent of how the browser reports
    // the connection's end.
    if (a && a.ally && a.ally.by_outcome) out.ally = { by_outcome: a.ally.by_outcome, by_code: a.ally.by_code ?? {}, first_token_ms: a.ally.first_token_ms?.p50_ms ?? null };
  }
  return out;
}
