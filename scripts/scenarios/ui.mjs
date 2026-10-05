/* Small UI helpers shared by the scenario definitions: navigation by the app's own accessible names, text waits, and downloads. */
import { readFileSync } from "node:fs";
import { check, waitUntil } from "./lib.mjs";

/** A string is a literal, case-insensitive match; a RegExp is made case-insensitive too (CSS text-transform changes innerText casing). */
const toRegExp = (text) => (text instanceof RegExp ? new RegExp(text.source, text.flags.includes("i") ? text.flags : `${text.flags}i`) : new RegExp(String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

export const bodyText = (page) => page.evaluate(() => document.body.innerText);

/** Open the app and wait for it to settle. */
export async function openApp(page, origin) {
  await page.goto(`${origin}/app/`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
}

/** Click a rail button (Home, Live Session, Contexts, Library, Coaching, What's Coming, Settings). */
export async function nav(page, label) {
  const b = page.getByRole("button", { name: label, exact: true }).first();
  await b.waitFor({ state: "visible", timeout: 8000 });
  await b.click();
  await page.waitForTimeout(350);
}

/** Wait for visible page text (case-insensitive substring or RegExp). */
export async function seeText(page, text, timeout = 8000) {
  const re = toRegExp(text);
  const hit = await waitUntil(async () => re.test(await bodyText(page)), timeout);
  check(hit, `expected to see ${re}`);
}

/** Wait until text is NOT on the page. */
export async function loseText(page, text, timeout = 8000) {
  const re = toRegExp(text);
  const gone = await waitUntil(async () => !re.test(await bodyText(page)), timeout);
  check(gone, `expected ${re} to be gone`);
}

export const button = (page, name, opts = {}) => page.getByRole("button", { name, ...opts }).first();

/** Click a button by accessible name once it is visible. */
export async function press(page, name, opts = {}) {
  const b = button(page, name, opts);
  await b.waitFor({ state: "visible", timeout: 8000 });
  await b.click();
}

/** Click something that opens a download and return its text content. */
export async function downloadText(page, click) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), text: readFileSync(path, "utf8") };
}

/** Open a Library row's "⋮" menu by the document's name; retries once because the menu toggles. Returns once any menu item is visible. */
export async function openRowMenu(page, name) {
  const more = button(page, new RegExp(`More actions for ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
  await more.scrollIntoViewIfNeeded();
  const anyItem = page.getByRole("menuitem").first();
  for (let i = 0; i < 2; i += 1) {
    await more.click();
    if (await anyItem.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) return;
  }
  throw new Error(`the ⋮ menu for ${name} did not open`);
}

/** A "⋮" menu entry (these are role=menuitem, not buttons). */
export const menuItem = (page, name) => page.getByRole("menuitem", { name }).first();

/** After a destructive click: confirm in an in-page dialog if one appeared (native confirms are accepted by the runner). */
export async function confirmIfAsked(page) {
  const ok = page.getByRole("dialog").getByRole("button", { name: /^(delete|confirm|yes|ok|remove)/i }).first();
  if (await ok.waitFor({ state: "visible", timeout: 700 }).then(() => true).catch(() => false)) await ok.click();
}

/** Wait for a locator to be visible; on timeout say WHICH thing was missing (Playwright's own message names only the selector). */
export async function waitVisible(locator, what, timeout = 6000) {
  const ok = await locator.waitFor({ state: "visible", timeout }).then(() => true).catch(() => false);
  check(ok, `${what} is not visible`);
}
