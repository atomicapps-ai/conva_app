/* R4 — Conversations: the seven demo calls are listed newest first, search finds a call by what was said, a call opens with its transcript, exports to Markdown, and single and bulk delete persist across a reload. */
import { check } from "../lib.mjs";
import { confirmIfAsked, downloadText, nav, openApp, press, seeText } from "../ui.mjs";

const CALLS = [
  "Cedarline incident follow-up call",
  "Q4 planning sync",
  "Larkspur renewal: negotiation",
  "3.0 launch stream: dry run",
  "Product Designer interview: Elena Voss",
  "Larkspur renewal: discovery call",
  "Marlow Cold Storage: quarterly check-in",
];
const row = (page, title) => page.getByRole("checkbox", { name: `Select ${title}` });
const toHistory = async (page, origin) => {
  await openApp(page, origin);
  await nav(page, "Live Session");
  await press(page, /^history$/i);
  await row(page, CALLS[0]).waitFor({ state: "visible", timeout: 8000 });
};

export default {
  id: "R4-conversations",
  title: "Conversations: list, search, open, export, delete",
  matrix: ["Conv 1", "Conv 5", "Conv 6", "Cap 19", "Cap 20"],
  async run({ page, step, origin }) {
    await step("History lists the seven demo conversations, newest first", async () => {
      await toHistory(page, origin);
      const order = await page.getByRole("checkbox", { name: /^Select / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace(/^Select /, "")));
      check(JSON.stringify(order) === JSON.stringify(CALLS), `unexpected list: ${order.join(" | ")}`);
    });
    await step("Search finds the call where Quill was discussed, and not the others", async () => {
      await press(page, /^search$/i);
      const box = page.getByRole("textbox").first();
      await box.fill("Quill");
      await page.waitForTimeout(500);
      await seeText(page, "Larkspur renewal: negotiation", 5000);
      const text = await page.evaluate(() => document.body.innerText);
      check(!text.includes("Marlow Cold Storage: quarterly check-in"), "search did not narrow the list");
      await box.fill("");
      await press(page, /^all activity$/i);
    });
    await step("Open a call in Live; its transcript shows both sides", async () => {
      await row(page, CALLS[2]).waitFor({ state: "visible", timeout: 5000 });
      await press(page, `Open ${CALLS[2]} in Live`);
      await seeText(page, "Thanks for joining. Tomás is here with me", 8000);
      await seeText(page, "Is the price increase capped", 5000);
    });
    await step("Export the shown transcript to Markdown; the file holds the conversation", async () => {
      await press(page, /^history$/i);
      const { name, text } = await downloadText(page, () => press(page, /export shown transcript/i));
      check(/\.md$/i.test(name), `unexpected file name ${name}`);
      check(text.includes("Is the price increase capped?"), "the export is missing the other party's words");
      check(text.includes("We are not asking for one."), "the export is missing your words");
    });
    await step("Delete one call; it goes and stays gone after a reload", async () => {
      await toHistory(page, origin);
      await press(page, `Delete ${CALLS[6]}`);
      await confirmIfAsked(page);
      await row(page, CALLS[6]).waitFor({ state: "hidden", timeout: 6000 });
      await toHistory(page, origin);
      check((await row(page, CALLS[6]).count()) === 0, "the deleted call came back after a reload");
    });
    await step("Select two and delete them together; four calls remain after a reload", async () => {
      await row(page, CALLS[3]).check();
      await row(page, CALLS[5]).check();
      await press(page, /delete selected/i);
      await confirmIfAsked(page);
      await row(page, CALLS[3]).waitFor({ state: "hidden", timeout: 6000 });
      await toHistory(page, origin);
      const n = await page.getByRole("checkbox", { name: /^Select / }).count();
      check(n === 4, `expected 4 calls, found ${n}`);
    });
  },
};
