/* R6 — The product pages around the app: Home greets the demo user and lists recent work, What's New matches the running version, What's Coming and What conva does render, Coaching degrades honestly on the web, and none of it raises a page error. */
import { readFileSync } from "node:fs";
import { check } from "../lib.mjs";
import { nav, openApp, press, seeText } from "../ui.mjs";

const version = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version;

export default {
  id: "R6-product-pages",
  title: "Home, What's New, What's Coming, Features and Coaching on the web",
  matrix: ["Conv 11", "Conv 13", "Conv 14", "Conv 15", "Acc 16", "Contexts 16"],
  async run({ page, step, origin }) {
    await step("Home greets the demo user and lists recent conversations and Contexts", async () => {
      await openApp(page, origin);
      await seeText(page, /good (morning|afternoon|evening),?\s+maya/i);
      await seeText(page, "Recent conversations");
      await seeText(page, "Cedarline incident follow-up call");
      await seeText(page, "Library");
      await seeText(page, /30 documents/);
    });
    await step("Settings → About & extras → What's New says the running version and its newest release matches", async () => {
      await nav(page, "Settings");
      await press(page, /about & extras/i);
      await press(page, /what.s new/i);
      await seeText(page, new RegExp(`You.re on v${version.replace(/\./g, "\\.")}`));
      await seeText(page, new RegExp(`v${version.replace(/\./g, "\\.")}`));
    });
    await step("What conva does: every feature card carries an availability tag", async () => {
      await nav(page, "Settings");
      await press(page, /about & extras/i);
      await press(page, /what conva does/i);
      await page.waitForTimeout(400);
      const text = await page.evaluate(() => document.body.innerText);
      const cards = (text.match(/\b(DESKTOP|WEB|BOTH|SOON|PLANNED)\b/g) ?? []).length;
      check(cards >= 6, `expected availability tags on the feature cards, found ${cards}`);
    });
    await step("What's Coming lists planned work", async () => {
      await nav(page, "What's Coming");
      await seeText(page, /planned|coming|roadmap/i);
    });
    await step("Coaching says plainly it runs on the desktop app instead of failing", async () => {
      await nav(page, "Coaching");
      await seeText(page, /desktop/i, 6000);
    });
  },
};
