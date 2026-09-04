#!/usr/bin/env node

import { pathToFileURL } from "node:url";

/** Fail a release before packaging if its public notes are empty or generic. */
export function validateReleaseNotes(notes) {
  const text = String(notes ?? "").trim();
  const visible = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (visible.length < 40) {
    throw new Error("Release notes must contain a meaningful user-facing summary.");
  }
  if (!/^##\s+\[(?!Unreleased\])/m.test(visible)) {
    throw new Error("Release notes must start with a versioned release heading.");
  }
  if (!/^-\s+\S/m.test(visible)) {
    throw new Error("Release notes must contain at least one user-facing change.");
  }
  return text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateReleaseNotes(process.env.RELEASE_NOTES);
    console.log("Release notes are present and substantive.");
  } catch (error) {
    console.error(`Release blocked: ${error.message}`);
    process.exit(1);
  }
}
