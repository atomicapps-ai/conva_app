/* R3 — Contexts on the web: the five demo Contexts are listed and open with their documents and vocabulary; a new Context goes through the three-step wizard and survives a reload; deleting it persists. Finishing a Context on the web is a known failure until the web path is built. */
import { check } from "../lib.mjs";
import { nav, openApp, press, seeText, waitVisible } from "../ui.mjs";

const NAME = "Harbor Foods pilot";
const GOAL = "Win the pilot and agree the next step with the operations lead.";
const TERMS = ["pilot scope", "success criteria", "go-live date"];
const DEMO = ["Larkspur Foods renewal", "Senior Product Designer interview", "Q4 planning sync", "Brightwater Flow 3.0 launch stream", "Cedarline outage follow-up"];

const toContexts = async (page, origin) => {
  await openApp(page, origin);
  await nav(page, "Contexts");
};
const listRow = (page, title) => page.getByText(title, { exact: false }).first();

export default {
  id: "R3-contexts",
  title: "Contexts: browse, create with the wizard, reload, delete",
  matrix: ["Contexts 1", "Contexts 2", "Contexts 3", "Contexts 4", "Contexts 19", "Contexts 21", "Contexts 22"],
  async run({ page, step, origin }) {
    await step("The five demo Contexts are listed", async () => {
      await toContexts(page, origin);
      for (const t of DEMO) await seeText(page, t.length > 24 ? t.slice(0, 20) : t, 6000);
    });
    await step("Opening Larkspur shows its purpose, documents, vocabulary and counterparty", async () => {
      await listRow(page, "Larkspur Foods renewal").click();
      await seeText(page, "Renew Larkspur's 300 seats", 5000);
      await seeText(page, /7 sources/i, 5000);
      await seeText(page, "mis-pick rate", 5000);
      await seeText(page, "The cost-focused buyer", 5000);
    });
    await step("New Context: pick Sales call, name it and give it a goal", async () => {
      await press(page, /new context/i);
      await press(page, /^sales call$/i);
      await page.getByLabel(/^name/i).first().fill(NAME);
      await page.getByLabel(/^goal/i).first().fill(GOAL);
      await press(page, /^next/i);
    });
    await step("Step 2: add key terms and continue", async () => {
      await page.locator("textarea").first().fill(TERMS.join("\n"));
      await press(page, /^next/i);
      await waitVisible(page.getByRole("button", { name: /^finish/i }).first(), "the Finish button");
    });
    await step("Finish completes without an error on the web", async () => {
      await press(page, /^finish/i);
      await page.waitForTimeout(1200);
      const text = await page.evaluate(() => document.body.innerText);
      check(!/couldn.t save|runs on the desktop/i.test(text), "Finish reported that it could not save (Context runs on the desktop app)");
    }, { known: "PR 249: web Finish saves the Context and then reports a failure; the fix is open draft PR 249" });
    await step("After a reload the new Context is listed with its name, goal and key terms", async () => {
      await toContexts(page, origin);
      await seeText(page, NAME, 6000);
      await listRow(page, NAME).click();
      await seeText(page, GOAL, 5000);
      for (const t of TERMS) await seeText(page, t, 5000);
    });
    await step("Delete it; it is gone, and stays gone after a reload", async () => {
      await page.getByRole("button", { name: `More actions for ${NAME}` }).click();
      await page.getByRole("menuitem", { name: /delete/i }).first().click();
      await page.getByRole("button", { name: /^delete context$/i }).click();
      await page.waitForTimeout(800);
      await toContexts(page, origin);
      const text = await page.evaluate(() => document.body.innerText);
      check(!text.includes(NAME), "the deleted Context came back after a reload");
    });
  },
};
