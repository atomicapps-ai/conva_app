/* R7 — The live cockpit with a grounded question at several window widths: ground on a demo Context, start listening, ask, and check the answer pane, its buttons and the conversation column all stay inside the window; below 640 px the Ally panel moves into a drawer. Guards the clipped-View regression (conva_app#389). */
import { check } from "../lib.mjs";
import { acknowledgeNotice } from "../../certify/driver.mjs";
import { nav, openApp, press, seeText } from "../ui.mjs";

const QUESTION = "How much notice do we need before renewal?";

/** Box of the embedded View region and its Elaborate button, plus the conversation column. */
async function measure(page) {
  const width = page.viewportSize().width;
  const view = await page.getByRole("region", { name: "View", exact: true }).first().boundingBox();
  const elaborate = await page.getByRole("region", { name: "View", exact: true }).first().getByRole("button", { name: /^elaborate$/i }).first().boundingBox();
  const convo = await page.locator('[data-col="conversation"], main').first().boundingBox();
  return { width, view, elaborate, convo };
}

export default {
  id: "R7-cockpit-layout",
  title: "Live cockpit: grounded answer fits at every window width",
  matrix: ["Ally 3", "Ally 5", "Ally 16", "Ally 17", "Ally 18", "Cap 11"],
  async run({ page, step, shot, origin }) {
    await step("Ground the session on the Larkspur Context", async () => {
      await openApp(page, origin);
      await nav(page, "Live Session");
      await page.getByTitle(/change what ally is grounded on|select what ally is grounded in/i).first().click();
      const picker = page.getByRole("dialog", { name: /select context/i });
      await picker.getByRole("checkbox", { name: "Include Larkspur Foods renewal" }).check();
      await picker.getByRole("button", { name: /^select$/i }).click();
      await seeText(page, "Larkspur Foods renewal", 5000);
    });
    await step("Start listening: the hosted-processing notice appears first, then the microphone starts", async () => {
      await press(page, /^start listening$/i);
      const notice = await acknowledgeNotice(page, /start listening/i);
      check(notice !== null, "no hosted-processing notice was shown before capture");
      await page.getByRole("button", { name: /^end\b/i }).first().waitFor({ state: "visible", timeout: 10000 });
    });
    await step("Ask a question: a streamed answer cites the master services terms", async () => {
      const ask = page.getByPlaceholder(/ask ally/i).first();
      await ask.fill(QUESTION);
      await ask.press("Enter");
      await seeText(page, "The deadline is 1 October", 12000);
      await seeText(page, "master-services-terms.md", 6000);
    });
    for (const w of [1440, 1280, 1100]) {
      await step(`At ${w}px the answer pane, its buttons and the conversation all fit`, async () => {
        await page.setViewportSize({ width: w, height: 860 });
        await page.waitForTimeout(500);
        const m = await measure(page);
        check(m.view !== null, "the View region is not on the page");
        check(m.view.x >= 0 && m.view.x + m.view.width <= w + 0.5, `View spans ${Math.round(m.view.x)}–${Math.round(m.view.x + m.view.width)}px in a ${w}px window`);
        check(m.elaborate !== null && m.elaborate.x + m.elaborate.width <= m.view.x + m.view.width + 0.5, "the Elaborate button is clipped by the View pane");
        check(m.convo === null || m.convo.width >= 300, `the conversation column is only ${Math.round(m.convo?.width ?? 0)}px wide`);
      });
    }
    await step("At 600px the Ally panel moves into a drawer that opens from one button and fits the window", async () => {
      await page.setViewportSize({ width: 600, height: 860 });
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /^open ally panel$/i }).click();
      const panel = page.getByRole("button", { name: /^questions/i }).first();
      await panel.waitFor({ state: "visible", timeout: 5000 });
      await shot("narrow-600-drawer-open");
      const box = await panel.boundingBox();
      check(box && box.x >= 0 && box.x + box.width <= 600.5, `the drawer's Questions header spans ${box ? Math.round(box.x) : "?"}–${box ? Math.round(box.x + box.width) : "?"}px in a 600px window`);
      await page.keyboard.press("Escape");
    });
    await step("End the session", async () => {
      await page.setViewportSize({ width: 1440, height: 860 });
      await press(page, /^end\b/i);
      await page.getByRole("button", { name: /^start listening$/i }).waitFor({ state: "visible", timeout: 8000 });
    });
  },
};
