/* R8 — The live controls on the web say honestly what is and is not available: controls that do not exist yet are disabled and labelled, recording and system audio are not faked, Pause and Share-call-audio behave, and the hosted-processing notices appear before capture. */
import { check } from "../lib.mjs";
import { acknowledgeNotice } from "../../certify/driver.mjs";
import { nav, openApp, press, seeText, waitVisible } from "../ui.mjs";

/** A control-bar button by its accessible name (aria-label, else its visible label). */
const control = (page, name) => page.getByRole("button", { name }).first();
/** The Record button's accessible name is its tooltip-driven state; address it by the title it carries in each state. */
const recordButton = (page) => page.locator('button[title^="Record the call"], button[title^="Start listening first"], button[title^="Stop recording"]').first();

export default {
  id: "R8-live-web-fallbacks",
  title: "Live controls on the web: honest fallbacks for pause, recording and call audio",
  matrix: ["Cap 11", "Cap 12", "Cap 14", "Cap 15", "Cap 25", "Cap 26"],
  async run({ page, step, shot, origin }) {
    await step("Before listening, controls that are not built yet are disabled and say so", async () => {
      await openApp(page, origin);
      await nav(page, "Live Session");
      for (const name of [/^mute microphone \(not yet available\)$/i, /^silence ally \(not yet available\)$/i]) {
        const b = control(page, name);
        await waitVisible(b, `the ${name} control`);
        check(await b.isDisabled(), `${name} should be disabled`);
      }
      const rec = recordButton(page);
      await waitVisible(rec, "the Record button");
      check(await rec.isDisabled(), "Record should be disabled until listening");
      check(/start listening first/i.test((await rec.getAttribute("title")) ?? ""), "Record does not say why it is disabled");
    });
    await step("Start listening: the hosted-processing notice comes first, then the strip says you only", async () => {
      await press(page, /^start listening$/i);
      const notice = await acknowledgeNotice(page, /start listening/i);
      check(notice !== null, "no hosted-processing notice before capture");
      await control(page, /^end\b/i).waitFor({ state: "visible", timeout: 10000 });
      await seeText(page, /you only/i, 5000);
    });
    await step("Pause either works or is not offered; it never shows a raw internal error", async () => {
      const pause = control(page, /^pause$/i);
      await waitVisible(pause, "the Pause button");
      if (await pause.isEnabled()) await pause.click();
      await page.waitForTimeout(600);
      await shot("after-pause");
      const text = await page.evaluate(() => document.body.innerText);
      check(!/UnsupportedOnWebError|session\.pause/i.test(text), "a raw UnsupportedOnWebError is shown in the control bar after Pause");
    }, { known: "#395: Pause is enabled on the web, and clicking it shows `UnsupportedOnWebError: session.pause…` in the control bar" });
    await step("Share call audio opens its own scope notice before anything is shared", async () => {
      await press(page, /share call audio/i);
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      await shot("share-notice");
      const cancel = dialog.getByRole("button", { name: /cancel|not now|close/i }).first();
      await cancel.click();
      await seeText(page, /you only/i, 3000);
    });
    await step("The Record control does not promise a recording the web cannot make", async () => {
      const rec = recordButton(page);
      const title = (await rec.getAttribute("title")) ?? "";
      const disabled = await rec.isDisabled().catch(() => false);
      await shot("record-control");
      check(disabled || /desktop|not (yet )?available|unsupported/i.test(title), `Record is enabled on the web and says "${title}" although recording is desktop-only`);
    }, { known: "#396: the Record button is enabled on the web with desktop wording; recording.start is unsupported there" });
    await step("End the session; the control bar returns to Start listening", async () => {
      await control(page, /^end\b/i).click();
      await page.getByRole("button", { name: /^start listening$/i }).waitFor({ state: "visible", timeout: 8000 });
    });
  },
};
