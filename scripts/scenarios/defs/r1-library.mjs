/* R1 — Library: paste a note, filter, include and exclude it from search, delete it; upload a Markdown file and download the original back; reload to prove the changes persisted. */
import { check } from "../lib.mjs";
import { button, confirmIfAsked, downloadText, menuItem, nav, openApp, openRowMenu, press, seeText } from "../ui.mjs";

const NOTE = "Renewal call notes";
const FACT = "Priya wants the Spokane rollout plan before the thirtieth.";
const FILE = "spokane-rollout-plan.md";
const FILE_TEXT = "# Spokane rollout plan\n\nWeek 1: site survey.\nWeek 2: handoff templates configured.\nWeek 3: shift leads trained.\n";

const rowFor = (page, name) => button(page, new RegExp(`More actions for ${name}`, "i"));
const toLibrary = async (page, origin) => {
  await openApp(page, origin);
  await nav(page, "Library");
};

export default {
  id: "R1-library",
  title: "Library: paste, filter, toggle search, upload, download, delete",
  matrix: ["Lib 1", "Lib 4", "Lib 7", "Lib 17", "Lib 18", "Lib 30"],
  async run({ page, step, origin }) {
    await step("Open the Library; it lists the 30 demo documents", async () => {
      await toLibrary(page, origin);
      await seeText(page, "30 documents");
    });
    await step("Add a pasted note; it appears in the list", async () => {
      await press(page, "Add a pasted note");
      const body = page.getByPlaceholder(/Paste notes/);
      await body.locator("xpath=preceding::input[1]").fill(NOTE);
      await body.fill(FACT);
      await press(page, /^save$/i);
      await rowFor(page, NOTE).waitFor({ state: "visible", timeout: 8000 });
    });
    await step("The header count rises to 31 without leaving the page", () => seeText(page, "31 documents", 3000), {
      known: "#393: LibraryView does not reload its count when the pane adds or deletes a document",
    });
    await step("The Pasted filter shows the note", async () => {
      await press(page, /^pasted$/i);
      await rowFor(page, NOTE).waitFor({ state: "visible", timeout: 5000 });
      await press(page, /^all$/i);
    });
    await step("After a reload the note is still there and the count is 31", async () => {
      await toLibrary(page, origin);
      await rowFor(page, NOTE).waitFor({ state: "visible", timeout: 8000 });
      await seeText(page, "31 documents");
    });
    await step("Exclude the note from general search, then include it again", async () => {
      await openRowMenu(page, NOTE);
      const state = (await menuItem(page, /(include|exclude) (in|from) general retrieval/i).innerText()).toLowerCase();
      const first = state.startsWith("exclude") ? /exclude from general retrieval/i : /include in general retrieval/i;
      const second = state.startsWith("exclude") ? /include in general retrieval/i : /exclude from general retrieval/i;
      await menuItem(page, first).click();
      await page.waitForTimeout(400);
      await openRowMenu(page, NOTE);
      await menuItem(page, second).waitFor({ state: "visible", timeout: 5000 });
      await menuItem(page, second).click();
      await page.waitForTimeout(400);
    });
    await step("Delete the note; it disappears", async () => {
      await openRowMenu(page, NOTE);
      await menuItem(page, /^delete$/i).click();
      await confirmIfAsked(page);
      await rowFor(page, NOTE).waitFor({ state: "hidden", timeout: 8000 });
    });
    await step("Upload a Markdown file; it appears as a file", async () => {
      await page.setInputFiles("input[type=file]", { name: FILE, mimeType: "text/markdown", buffer: Buffer.from(FILE_TEXT) });
      await rowFor(page, FILE).waitFor({ state: "visible", timeout: 8000 });
      await press(page, /^files$/i);
      await rowFor(page, FILE).waitFor({ state: "visible", timeout: 5000 });
      await press(page, /^all$/i);
    });
    await step("The last row's ⋮ menu fits inside the window", async () => {
      await openRowMenu(page, FILE);
      const last = await menuItem(page, /^delete$/i).boundingBox();
      const height = page.viewportSize().height;
      await page.keyboard.press("Escape");
      check(last && last.y + last.height <= height, `the menu's last item ends at ${last ? Math.round(last.y + last.height) : "?"}px in a ${height}px window`);
    }, { known: "#394: the row menu opens downward and is cut off at the bottom of the window for the last rows" });
    await step("Narrow the list to the file so its menu is fully on screen", async () => {
      await page.getByPlaceholder(/search files/i).fill("spokane");
      await rowFor(page, FILE).waitFor({ state: "visible", timeout: 5000 });
    });
    await step("Download the original: the file holds the uploaded text", async () => {
      await openRowMenu(page, FILE);
      const { name, text } = await downloadText(page, () => menuItem(page, /^download$/i).click());
      check(name === FILE, `unexpected file name ${name}`);
      check(text === FILE_TEXT, "downloaded file differs from what was uploaded");
    });
    await step("Delete the file; after a reload the Library is back to 30 documents", async () => {
      await openRowMenu(page, FILE);
      await menuItem(page, /^delete$/i).click();
      await confirmIfAsked(page);
      await rowFor(page, FILE).waitFor({ state: "hidden", timeout: 8000 });
      await toLibrary(page, origin);
      await seeText(page, "30 documents");
    });
  },
};
