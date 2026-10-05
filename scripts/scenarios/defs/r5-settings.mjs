/* R5 — Settings on the web: honest about what arrives later, the build identity, and the read-only Compare models page (no way to change the hosted model from the browser). */
import { readFileSync } from "node:fs";
import { check } from "../lib.mjs";
import { button, nav, openApp, press, seeText } from "../ui.mjs";

const version = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version;

export default {
  id: "R5-settings",
  title: "Settings, About and Compare models on the web",
  matrix: ["Models 1", "Models 9", "Acc 16"],
  async run({ page, step, origin }) {
    await step("Settings says app settings arrive with the hosted backend", async () => {
      await openApp(page, origin);
      await nav(page, "Settings");
      await seeText(page, /settings arrive with the hosted backend/i);
    });
    await step("About shows the running version, build and build time", async () => {
      await seeText(page, new RegExp(`v${version.replace(/\./g, "\\.")}`));
      await seeText(page, /Build\s+[0-9a-z]{6,}/i);
      await seeText(page, /Built\s+20\d\d-\d\d-\d\dT/);
    });
    await step("Compare models opens with the benchmark models and both views", async () => {
      await press(page, /^compare models/i);
      for (const m of ["Claude Haiku 4.5", "Claude Sonnet 5.5", "Claude Opus 5.5", "gpt-5.5"]) await seeText(page, m, 6000);
      await page.getByText("Conva call types", { exact: true }).first().click();
      await seeText(page, /call type/i, 4000);
      await page.getByText("Technical answers", { exact: true }).first().click();
      await seeText(page, /24 questions/i, 4000);
    });
    await step("It is read-only here: no control sets the fast or quality model", async () => {
      const text = await page.evaluate(() => document.body.innerText);
      check(!/use for (fast|quality)/i.test(text), "a Use-for-slot control is visible on the web");
      await press(page, /^back$/i);
    });
    await step("About & extras lists the three product pages and each opens (the rail is the way out)", async () => {
      for (const [entry, heading] of [[/what conva does/i, /what conva does|features/i], [/what.s coming/i, /coming/i], [/what.s new/i, /you.re on/i]]) {
        await nav(page, "Settings");
        await press(page, /about & extras/i);
        await press(page, entry);
        await seeText(page, heading, 5000);
      }
    });
  },
};
