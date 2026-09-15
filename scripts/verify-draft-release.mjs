#!/usr/bin/env node

import { validateReleaseNotes } from "./validate-release-notes.mjs";

const token = process.env.RELEASES_REPO_TOKEN;
const tag = process.env.RELEASE_TAG;
const repository = process.env.RELEASES_REPOSITORY ?? "atomicapps-ai/conva_releases";

if (!token || !tag) {
  throw new Error("RELEASES_REPO_TOKEN and RELEASE_TAG are required.");
}

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function github(path, accept = headers.Accept) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { ...headers, Accept: accept },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response;
}

// GET /repos/{repo}/releases/tags/{tag} does not return draft releases —
// GitHub's docs note this explicitly, and a freshly-published-draft tag isn't
// even a real ref yet. That 404'd here on every release (v0.4.0 included)
// right after tauri-action had already uploaded the artifacts successfully.
// List releases instead (drafts included there) and match by tag_name.
async function findReleaseByTag(repo, tagName) {
  for (let page = 1; page <= 10; page++) {
    const releases = await (await github(`/repos/${repo}/releases?per_page=100&page=${page}`)).json();
    const match = releases.find((release) => release.tag_name === tagName);
    if (match) return match;
    if (releases.length < 100) break;
  }
  throw new Error(`No release with tag ${tagName} found in ${repo} (checked draft + published).`);
}

const release = await findReleaseByTag(repository, tag);
if (!release.draft) throw new Error(`${tag} must remain a draft until owner review.`);
validateReleaseNotes(release.body);

const assets = release.assets.filter((asset) => asset.size > 0);
const names = assets.map((asset) => asset.name);
for (const suffix of [".msi", ".exe", ".dmg", ".app.tar.gz", ".exe.sig", ".app.tar.gz.sig"]) {
  if (!names.some((name) => name.endsWith(suffix))) {
    throw new Error(`Draft ${tag} is missing a non-empty ${suffix} asset.`);
  }
}

const manifestAsset = assets.find((asset) => asset.name === "latest.json");
if (!manifestAsset) throw new Error(`Draft ${tag} is missing latest.json.`);
const manifest = await (
  await github(`/repos/${repository}/releases/assets/${manifestAsset.id}`, "application/octet-stream")
).json();
const platformKeys = Object.keys(manifest.platforms ?? {});
if (!platformKeys.some((key) => key.startsWith("windows-"))) {
  throw new Error("latest.json has no Windows updater entry.");
}
if (!platformKeys.some((key) => key.startsWith("darwin-"))) {
  throw new Error("latest.json has no macOS updater entry.");
}

console.log(`Verified draft ${tag}: ${names.join(", ")}`);
