/* R2 — Library on the web says plainly what it cannot do: spreadsheets and images are refused with a reason, and nothing half-ingests. */
import { check } from "../lib.mjs";
import { nav, openApp, seeText } from "../ui.mjs";

const upload = (page, name, mimeType, bytes) => page.setInputFiles("input[type=file]", { name, mimeType, buffer: Buffer.from(bytes) });

export default {
  id: "R2-library-honesty",
  title: "Library on the web: spreadsheets and images are refused honestly",
  matrix: ["Lib 6", "Lib 5", "Lib 32"],
  async run({ page, step, origin }) {
    await step("Open the Library", async () => {
      await openApp(page, origin);
      await nav(page, "Library");
      await seeText(page, "30 documents");
    });
    await step("A spreadsheet is refused with a reason", async () => {
      await upload(page, "price-list.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PK\u0003\u0004fake");
      await seeText(page, /Browser upload currently supports pdf, docx, md, txt, and html/, 6000);
    });
    await step("An image is refused with a reason", async () => {
      await upload(page, "site-photo.png", "image/png", "\u0089PNG\r\n\u001a\nfake");
      await seeText(page, /Browser upload currently supports pdf, docx, md, txt, and html/, 6000);
    });
    await step("Nothing was added: after a reload the Library still holds the 30 demo documents", async () => {
      await openApp(page, origin);
      await nav(page, "Library");
      await seeText(page, "30 documents");
      const text = await page.evaluate(() => document.body.innerText);
      check(!/price-list|site-photo/.test(text), "a refused file was listed anyway");
    });
  },
};
