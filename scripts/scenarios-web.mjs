#!/usr/bin/env node
/* conva — recorded browser scenarios (the "group 1" flows of the app test plan).
 *
 * Runs each scenario in `scripts/scenarios/defs/` in a real browser against the real web
 * build (`dist-web/`), served with the demo dataset planted in the cloud stub. Every
 * scenario is recorded while it runs; the recording (video + trace + screenshots) is
 * KEPT only on a failure, a known failure or an unexpected pass (the large trace only on a failure or an unexpected pass) — a clean pass leaves
 * just a line in the JSON report. `--keep` keeps everything (showcase captures, debugging).
 *
 *   npm run build:web
 *   npm run scenarios:web                         # all scenarios, pre-installed Chromium
 *   npm run scenarios:web -- --only R1,R4         # a subset (id prefixes)
 *   npm run scenarios:web -- --browser chrome     # installed Chrome / msedge (Windows)
 *   options: --out <dir> --keep --headed --executable <path> --width 1440 --height 900
 *
 * Exit 0 when nothing failed unexpectedly. Needs `playwright-core` (never downloads a browser). */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { startGateway } from "./certify/gateway.mjs";
import { createCloudStub } from "./certify/cloud.mjs";
import { synthWav } from "./certify/lib.mjs";
import { DEMO_ACCOUNT, loadDemoDataset } from "./certify/demoDataset.mjs";
import { DEFAULT_CHROMIUM, cliOptions, launchOptions } from "./certify/driver.mjs";
import { runIsGreen, runScenario } from "./scenarios/lib.mjs";
import { renderReport } from "./scenarios/report.mjs";

const require = createRequire(import.meta.url);
const { opt, flag } = cliOptions(process.argv.slice(2));
const browserName = opt("browser", "chromium");
const outDir = resolve(opt("out", "scenario-runs"));
const distDir = resolve(opt("dist", "dist-web"));
const only = opt("only", "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const keepAll = flag("keep");
const size = { width: Number(opt("width", "1440")), height: Number(opt("height", "900")) };
const executable = opt("executable", process.env.CONVA_CERTIFY_CHROMIUM || (browserName === "chromium" ? DEFAULT_CHROMIUM : undefined));
if (!existsSync(join(distDir, "index.html"))) {
  console.error(`No web build at ${distDir}. Run: npm run build:web`);
  process.exit(2);
}
const { chromium } = require("playwright-core");

const defsDir = new URL("./scenarios/defs/", import.meta.url);
const defs = [];
for (const f of readdirSync(defsDir).filter((n) => n.endsWith(".mjs")).sort()) defs.push((await import(pathToFileURL(join(defsDir.pathname, f)).href)).default);
const selected = defs.filter((d) => only.length === 0 || only.some((o) => d.id.toLowerCase().startsWith(o)));
if (selected.length === 0) {
  console.error(`No scenario matches --only ${only.join(",")}. Available: ${defs.map((d) => d.id).join(", ")}`);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const wavPath = join(outDir, ".scenario-mic.wav");
writeFileSync(wavPath, synthWav({ sampleRate: 48_000, seconds: 20 }));
const dataset = loadDemoDataset();
const startedAt = new Date();
const browser = await chromium.launch(launchOptions({ headed: flag("headed"), wavPath, share: false, executable, browserName }));
const results = [];
for (const def of selected) {
  // A fresh stub and gateway per scenario: scenarios change data and must not see each other's.
  const stub = createCloudStub({ dataset });
  const gw = await startGateway({ distDir, cloud: stub, sessionId: `live_${def.id}`, email: DEMO_ACCOUNT.email });
  try {
    const r = await runScenario({ def, browser, origin: gw.origin, stub, outDir, keepAll, size });
    results.push(r);
    const failed = r.steps.filter((s) => !s.ok);
    console.log(`${r.outcome.toUpperCase().padEnd(15)} ${r.id}  (${r.steps.filter((s) => s.ok).length}/${r.steps.length} steps, ${(r.ms / 1000).toFixed(1)}s)${r.recording ? "  recording kept" : ""}`);
    for (const s of failed) console.log(`    ✗ ${s.name}${s.known ? `  [known: ${s.known}]` : ""}${s.error ? `\n        ${s.error}` : ""}`);
  } finally {
    await gw.close();
  }
}
await browser.close().catch(() => {});

const green = runIsGreen(results.map((r) => r.outcome));
const stale = results.filter((r) => r.outcome === "unexpected-pass");
const report = {
  kind: "web-scenarios",
  ran_at: startedAt.toISOString(),
  browser: { requested: browserName, version: browser.version?.() ?? null, headless: !flag("headed") },
  os: { platform: process.platform, release: os.release(), arch: process.arch },
  verdict: green ? "pass" : "fail",
  scenarios: results,
};
const file = join(outDir, `${startedAt.toISOString().slice(0, 10)}-${browserName}-${process.platform}-scenarios.json`);
writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
writeFileSync(join(outDir, "report.html"), renderReport(report, { standalone: true, videoSrc: (r) => (r.recording?.video ? `${r.recording.dir}/${r.recording.video}` : null) }));
const counts = ["pass", "known-failing", "fail", "unexpected-pass"].map((o) => `${results.filter((r) => r.outcome === o).length} ${o}`).join(", ");
console.log(`\n${green ? "PASS" : "FAIL"} — ${counts}\n${file}\nOpen ${join(outDir, "report.html")} in a browser to watch the recordings and read each step.`);
for (const r of stale) console.log(`A known failure now passes in ${r.id}: remove its { known } marker so it is gated from here on.`);
process.exit(green ? 0 : 1);
