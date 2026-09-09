import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

const ROOT = process.cwd();

test("the app and Tauri master keep the owner-approved mark byte-identical", () => {
  const appMark = readFileSync(
    join(ROOT, "src", "assets", "brand", "conva-mark-cutout-white.svg"),
    "utf8",
  );
  const tauriMark = readFileSync(
    join(ROOT, "src-tauri", "icons", "masters", "conva-mark-cutout-white.svg"),
    "utf8",
  );

  assert.equal(tauriMark, appMark);
  assert.match(appMark, /M500\.89,337\.75/);
  assert.doesNotMatch(appMark, /M489\.65 333\.91/);
});
