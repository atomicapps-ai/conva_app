#!/usr/bin/env node
/* conva — demo workspace preview. Loads the demo dataset (`demo/`) into the
 * cloud stub, serves the real web build against it and screenshots the main
 * pages, so the dataset can be judged by how it looks, not only by its tests.
 *
 *   npm run build:web
 *   npm run demo:preview                 # writes demo-preview/*.png (git-ignored)
 *   options: --out <dir> --browser chrome|msedge --executable <path> --width 1440 --height 900 --list
 *
 * `--list` prints the rail's button names instead of screenshotting (to find a label). */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startGateway } from "./certify/gateway.mjs";
import { synthWav } from "./certify/lib.mjs";
import { createCloudStub } from "./certify/cloud.mjs";
import { DEMO_ACCOUNT, loadDemoDataset } from "./certify/demoDataset.mjs";
import { DEFAULT_CHROMIUM, cliOptions, launchOptions } from "./certify/driver.mjs";

const require = createRequire(import.meta.url);
const { opt, flag } = cliOptions(process.argv.slice(2));
const browserName = opt("browser", "chromium");
const outDir = resolve(opt("out", "demo-preview"));
const distDir = resolve(opt("dist", "dist-web"));
const width = Number(opt("width", "1440"));
const height = Number(opt("height", "900"));
const executable = opt("executable", process.env.CONVA_CERTIFY_CHROMIUM || (browserName === "chromium" ? DEFAULT_CHROMIUM : undefined));
if (!existsSync(join(distDir, "index.html"))) {
  console.error(`No web build at ${distDir}. Run: npm run build:web`);
  process.exit(2);
}
const { chromium } = require("playwright-core");
mkdirSync(outDir, { recursive: true });
const wavPath = join(outDir, ".preview-mic.wav");
writeFileSync(wavPath, synthWav({ sampleRate: 48_000, seconds: 6 }));

const cloud = createCloudStub({ dataset: loadDemoDataset() });
const gw = await startGateway({ distDir, cloud, sessionId: "live_demo_preview", email: DEMO_ACCOUNT.email });
let browser;
try {
  browser = await chromium.launch(launchOptions({ headed: false, wavPath, share: false, executable, browserName }));
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${gw.origin}/app/`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  if (flag("list")) {
    const names = await page.getByRole("button").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") || e.getAttribute("title") || e.textContent || "").trim()).filter(Boolean));
    console.log([...new Set(names)].join("\n"));
  } else {
    const shot = async (name) => {
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(outDir, `${name}.png`) });
      console.log(`wrote ${name}.png`);
    };
    const go = async (label) => {
      const b = page.getByRole("button", { name: label }).first();
      if (await b.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) await b.click();
      else console.warn(`no control named ${label}`);
    };
    await shot("01-home");
    await go(/^contexts$/i);
    await shot("02-contexts");
    await go(/^larkspur foods renewal/i);
    await shot("03-context-detail");
    await go(/^library$/i);
    await shot("04-library");
    await go(/^live session$/i);
    await go(/^history$/i);
    await shot("05-history");
    await go(/^open larkspur renewal: negotiation in live$/i);
    await shot("06-conversation-open");
  }
} finally {
  await browser?.close().catch(() => {});
  await gw.close();
}
