/* Test recording for the browser harnesses (`rehearse-web.mjs`).
 *
 * `--record` turns a run into evidence a person can watch: a video of the whole
 * session, a Playwright trace (DOM snapshots + network, opens in the trace
 * viewer: `npx playwright show-trace <file>`), and one screenshot per step with
 * its pass/fail in the file name. All of it is written next to the JSON row.
 *
 * Content safety: the harness drives a stubbed cloud with synthetic fixtures
 * (a made-up Context, a synthetic microphone), so a recording holds no customer
 * data. Never point this at a real account — the check is the stub, not the
 * recorder. Without `--record` every method is a no-op and nothing is written. */
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const safe = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function createRecorder({ enabled, dir, name, size = { width: 1280, height: 860 } }) {
  if (!enabled) {
    return { enabled: false, contextOptions: {}, start: async () => {}, shot: async () => {}, finish: async () => null };
  }
  const base = join(dir, name);
  const tmp = join(base, ".video-tmp");
  mkdirSync(tmp, { recursive: true });
  let n = 0;
  let page = null;
  return {
    enabled: true,
    /** Spread into `browser.newContext({...})` — Playwright records video per page. */
    contextOptions: { recordVideo: { dir: tmp, size } },
    async start(context, p) {
      page = p;
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    },
    /** One PNG per step: `01-5a-context-activated-pass.png`. Never throws — evidence must not fail the run. */
    async shot(step, label, ok) {
      if (!page) return;
      n += 1;
      const file = join(base, `${String(n).padStart(2, "0")}-${safe(step)}-${safe(label)}-${ok ? "pass" : "FAIL"}.png`);
      await page.screenshot({ path: file }).catch(() => {});
    },
    /** Close the context (finalises the video), write trace.zip + video.webm; returns their paths. */
    async finish(context) {
      const video = page?.video() ?? null;
      const trace = join(base, "trace.zip");
      await context.tracing.stop({ path: trace }).catch(() => {});
      await context.close().catch(() => {});
      let videoPath = null;
      if (video) {
        videoPath = join(base, "session.webm");
        const src = await video.path().catch(() => null);
        if (src) renameSync(src, videoPath);
        else videoPath = null;
      }
      rmSync(tmp, { recursive: true, force: true });
      return { dir: base, trace, video: videoPath, screenshots: n };
    },
  };
}
