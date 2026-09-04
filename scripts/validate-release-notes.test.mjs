import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseNotes } from "./validate-release-notes.mjs";

test("accepts versioned notes with a real change", () => {
  const notes = "## [0.4.0] — 2026-09-04\n\n### Features\n- Adds automatic updates with a safe live-session delay.";
  assert.equal(validateReleaseNotes(notes), notes);
});

for (const [name, notes] of [
  ["empty notes", ""],
  ["an unversioned placeholder", "Release notes coming soon. Nothing else yet."],
  ["an unreleased heading", "## [Unreleased]\n\n### Features\n- A change that is not assigned to a release."],
  ["a release with no changes", "## [0.4.0] — 2026-09-04\n\nNothing to report for this version."],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => validateReleaseNotes(notes));
  });
}
