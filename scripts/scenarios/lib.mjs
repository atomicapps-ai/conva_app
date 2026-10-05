/* Scenario runner for the recorded browser flows (`scripts/scenarios-web.mjs`).
 *
 * A scenario is a named list of steps run in a real browser against the real web
 * build, served with the demo dataset planted in the cloud stub. Every scenario
 * is recorded (video + trace) while it runs, but the recording is KEPT only when
 * it is useful: on a failure, on a known failure (documents the problem), or when
 * a known failure unexpectedly passes. A passing scenario leaves only a few KB of
 * JSON, so CI and disk stay small; `--keep` overrides that for debugging or for
 * showcase captures. See conva_core/docs/technical/2026-10-windows-manual-verification-runbook.md
 * and the verification matrix for the rows each scenario covers.
 *
 * Pure logic (outcome and keep policy, step bookkeeping) is exported so it is unit-tested. */
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

/** pass | fail | known-failing | unexpected-pass, from the steps. A step marked `known` is expected to fail until its blocker is fixed. */
export function outcomeOf(steps, pageErrors = []) {
  const unknownFail = steps.some((s) => !s.ok && !s.known) || pageErrors.length > 0;
  if (unknownFail) return "fail";
  const known = steps.filter((s) => s.known);
  if (known.length === 0) return "pass";
  if (known.every((s) => !s.ok)) return "known-failing";
  if (known.every((s) => s.ok)) return "unexpected-pass";
  return "known-failing"; // some of several known steps now pass: still not fully fixed
}

/** Keep the recording when it explains something: any outcome except a clean pass, or always with `keepAll`. */
export function keepRecording(outcome, keepAll = false) {
  return keepAll || outcome !== "pass";
}

/** The trace is the big file (about 14 MB). Keep it only when someone has to debug: an unexpected failure or a stale known marker. A known failure keeps the video and screenshots, which show the problem. */
export function keepTrace(outcome, keepAll = false) {
  return keepAll || outcome === "fail" || outcome === "unexpected-pass";
}

/** A run is green when nothing failed unexpectedly. An unexpected pass is also a failure: it means a known marker is stale and must be removed. */
export function runIsGreen(outcomes) {
  return outcomes.every((o) => o === "pass" || o === "known-failing");
}

const safe = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const firstLine = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 300);

/** Poll until `fn` returns truthy (or throws nothing and returns a value); false after the timeout. */
export async function waitUntil(fn, timeout = 8000, every = 150) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* keep polling */
    }
    if (Date.now() - t0 > timeout) return false;
    await new Promise((r) => setTimeout(r, every));
  }
}

/** Throw with a message unless `cond` holds — the scenarios' only assertion. */
export function check(cond, message) {
  if (!cond) throw new Error(message);
}

/**
 * Run one scenario in a fresh browser context. `def.run({ page, step, origin, stub, size })` calls `step(name, fn, { known })` for each step.
 * Returns the content-free result row and, when kept, where the recording went.
 */
export async function runScenario({ def, browser, origin, stub, outDir, keepAll = false, size = { width: 1440, height: 900 } }) {
  const base = join(outDir, safe(def.id));
  const tmp = join(base, ".video-tmp");
  mkdirSync(tmp, { recursive: true });
  const context = await browser.newContext({ viewport: size, acceptDownloads: true, permissions: ["microphone"], recordVideo: { dir: tmp, size } });
  context.setDefaultTimeout(8000);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const dialogs = [];
  page.on("dialog", (d) => {
    dialogs.push(`${d.type()}: ${d.message().slice(0, 120)}`);
    void d.accept(); // Playwright would otherwise dismiss native confirms and silently cancel the action under test
  });
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => pageErrors.push(firstLine(e)));
  page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ""}`));
  const steps = [];
  let stopped = false;
  let shots = 0;
  const shot = async (label) => {
    shots += 1;
    await page.screenshot({ path: join(base, `${String(shots).padStart(2, "0")}-${safe(label)}.png`) }).catch(() => {});
  };
  const step = async (name, fn, { known = null } = {}) => {
    if (stopped) {
      steps.push({ name, ok: false, skipped: true, ms: 0, known: known ?? undefined });
      return;
    }
    const t0 = Date.now();
    try {
      await fn();
      steps.push({ name, ok: true, ms: Date.now() - t0, ...(known ? { known } : {}) });
    } catch (e) {
      steps.push({ name, ok: false, ms: Date.now() - t0, error: firstLine(e), ...(known ? { known } : {}) });
      await shot(`FAIL-${name}`);
      if (!known) stopped = true;
    }
  };
  const started = Date.now();
  try {
    await def.run({ page, step, shot, origin, stub, size });
  } catch (e) {
    steps.push({ name: "scenario setup", ok: false, ms: 0, error: firstLine(e) });
  }
  const outcome = outcomeOf(steps, pageErrors);
  const keep = keepRecording(outcome, keepAll);
  const video = page.video();
  const trace = keepTrace(outcome, keepAll);
  await context.tracing.stop(trace ? { path: join(base, "trace.zip") } : undefined).catch(() => {});
  await context.close().catch(() => {});
  let videoPath = null;
  if (keep && video) {
    const src = await video.path().catch(() => null);
    if (src) {
      videoPath = join(base, "session.webm");
      renameSync(src, videoPath);
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  if (!keep) rmSync(base, { recursive: true, force: true });
  return {
    id: def.id,
    title: def.title,
    matrix: def.matrix,
    outcome,
    ms: Date.now() - started,
    steps,
    dialogs,
    page_errors: pageErrors,
    console_errors: consoleErrors.filter((m) => !/Failed to load resource: the server responded with a status of 404/.test(m)),
    failed_requests: failedRequests,
    recording: keep ? { dir: safe(def.id), video: videoPath ? "session.webm" : null, trace: trace ? "trace.zip" : null } : null,
  };
}
