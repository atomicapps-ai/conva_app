/* R9 — Voices in a call: the other party's turns can be split into separate voices, each named by the user, each with its own colour, and merged back. Automatic voice detection is not built yet (spec: speaker-aware-conversations.md, Phase A/B), so this proves the manual flow only; "Remember for future conversations" must say it is not available. */
import { check } from "../lib.mjs";
import { nav, openApp, press, seeText } from "../ui.mjs";

const CALL = "Larkspur renewal: negotiation";
/** The clickable voice labels in the transcript: inbound turns only ("You" is never renamable). */
const voices = (page) => page.locator('button[aria-label$="name or correct speaker"]');
const labels = async (page) => voices(page).evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim().toLowerCase()));
const rawColours = (page) => voices(page).evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
/** Labels animate their colour (transition-colors), so read until two reads 120 ms apart agree. */
const colours = async (page) => {
  let prev = await rawColours(page);
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(120);
    const next = await rawColours(page);
    if (JSON.stringify(next) === JSON.stringify(prev)) return next;
    prev = next;
  }
  return prev;
};
const openEditor = async (page, index) => {
  await voices(page).nth(index).click();
  await page.getByRole("dialog", { name: /name this voice/i }).waitFor({ state: "visible", timeout: 4000 });
};
const rename = async (page, index, name) => {
  await openEditor(page, index);
  await page.getByLabel("Voice name").fill(name);
  await page.getByRole("button", { name: /^save$/i }).click();
  await page.getByRole("dialog", { name: /name this voice/i }).waitFor({ state: "hidden", timeout: 4000 });
};
const differentVoiceFromHere = async (page, index) => {
  await openEditor(page, index);
  await page.getByRole("button", { name: /different voice from here/i }).click();
};

export default {
  id: "R9-voices",
  title: "Voices in a call: split, name, colour and merge (manual; automatic detection is not built)",
  matrix: ["Conv 7", "Conv 8"],
  async run({ page, step, shot, origin }) {
    await step("Open a call; every turn from the other party starts as one anonymous voice", async () => {
      await openApp(page, origin);
      await nav(page, "Live Session");
      await press(page, /^history$/i);
      await press(page, `Open ${CALL} in Live`);
      await seeText(page, "Thanks for joining. Tomás is here with me", 8000);
      const l = await labels(page);
      check(l.length >= 6, `expected several other-party turns, found ${l.length}`);
      check(new Set(l).size === 1 && /new voice/.test(l[0]), `expected one "New voice", found ${[...new Set(l)].join(" / ")}`);
      await shot("one-anonymous-voice");
    });
    await step("Naming one turn's voice renames every turn of that voice together", async () => {
      await rename(page, 0, "Priya");
      const l = await labels(page);
      check(l.every((x) => x.startsWith("priya")), `not every turn took the name: ${l.join(" / ")}`);
    });
    await step("\"Different voice from here\" splits a turn off as a new voice with its own colour", async () => {
      const before = await colours(page);
      await differentVoiceFromHere(page, 2);
      const l = await labels(page);
      check(/voice 2/.test(l[2]), `the split turn should be "Voice 2", is "${l[2]}"`);
      const after = await colours(page);
      check(after[2] !== after[0], `the new voice has the same colour as Priya (${after[0]})`);
      check(after[0] === before[0], "Priya's colour changed when another voice appeared");
    });
    await step("A third voice is split off the same way; all three others are different colours", async () => {
      await differentVoiceFromHere(page, 4);
      const l = await labels(page);
      check(/voice 3/.test(l[4]), `the second split should be "Voice 3", is "${l[4]}"`);
      await rename(page, 2, "Tomás");
      await rename(page, 4, "Jun");
      const after = await colours(page);
      const distinct = new Set([after[0], after[2], after[4]]);
      check(distinct.size === 3, `three named voices should have three colours, found ${[...distinct].join(" | ")}`);
      const you = await page.locator("span", { hasText: /^you$/i }).first().evaluate((e) => getComputedStyle(e).color);
      check(!distinct.has(you), "a voice shares the colour of You");
      await shot("three-named-voices");
    });
    await step("Names stay on their own turns, not on the others", async () => {
      const l = await labels(page);
      check(l[0].startsWith("priya") && l[2].startsWith("tomás") && l[4].startsWith("jun"), `unexpected labels: ${l.join(" / ")}`);
    });
    await step("The editor says remembering voices is not available yet and does not offer it", async () => {
      await openEditor(page, 0);
      const box = page.getByRole("dialog", { name: /name this voice/i }).getByRole("checkbox");
      check(await box.isDisabled(), "the Remember checkbox is enabled but voices are not remembered");
      check(!(await box.isChecked()), "the Remember checkbox is checked");
      await seeText(page, /voices aren't remembered across conversations yet/i, 2000);
      await page.keyboard.press("Escape");
    });
    await step("Merging a voice into another gives its turns the other's name and colour", async () => {
      const before = await colours(page);
      await openEditor(page, 4);
      await page.getByRole("button", { name: /merge with/i }).click();
      await page.getByRole("button", { name: /^tomás$/i }).click();
      const l = await labels(page);
      const after = await colours(page);
      check(l[4].startsWith("tomás"), `the merged turn should read Tomás, reads "${l[4]}"`);
      check(after[4] === after[2], `the merged voice kept its own colour: Tomás ${after[2]} vs merged ${after[4]} (before ${before[4]})`);
      check(after[4] !== before[4], "the merged voice's colour did not change");
      await shot("merged");
    });
    await step("Forget returns a named voice to anonymous, keeping its colour", async () => {
      const before = await colours(page);
      await openEditor(page, 0);
      await page.getByRole("button", { name: /^forget/i }).click();
      const l = await labels(page);
      check(/voice|new/.test(l[0]) && !/priya/.test(l[0]), `Priya was not forgotten: "${l[0]}"`);
      const after = await colours(page);
      check(after[0] === before[0], "forgetting the name changed the voice's colour");
    });
  },
};
