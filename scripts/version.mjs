// scripts/version.mjs — conva's single version writer (zero-dep, Node ≥ 18).
//
// The **git tag `vX.Y.Z` is the release source of truth** (SDLC §2.3, §3.1);
// `package.json` "version" is its checked-in mirror and the value the build
// injects into the UI. This script is the ONLY thing that writes a version, so
// the three carriers can never drift by hand:
//
//   package.json           ← canonical mirror (also feeds vite → __APP_VERSION__)
//   Cargo.toml [workspace.package] version   ← Rust crate version (env!("CARGO_PKG_VERSION"))
//   src-tauri/tauri.conf.json "version"       ← Tauri app version (getVersion, installer, updater)
//   src-tauri/tauri.conf.json bundle.windows.wix.version  ← the MSI's numeric
//       ProductVersion, derived from a `-beta.N` prerelease (see msiVersion below)
//
// Once `tauri.conf.json` points its "version" at "../package.json" (a Tauri 2
// feature), that carrier derives automatically and this script leaves it alone.
// Until then, `set`/`stamp` keep the literal in sync too, so the script is
// correct in both states.
//
// Subcommands:
//   set   <x.y.z[-beta.N]>   Local: write package.json + Cargo.toml (+ tauri.conf
//                            if still a literal), then `cargo update -w`. The only
//                            way a version changes on a branch (npm run version:set).
//   stamp [x.y.z | vX.Y.Z]   CI: resolve the version from the arg, the tag
//                            (GITHUB_REF_NAME / git describe), or a VERSION file,
//                            then write every carrier. Used on the release tag.
//   check [--tag vX.Y.Z]     Exit non-zero if the carriers disagree; with --tag,
//                            also assert the tag equals package.json. The PR /
//                            release guard (SDLC §3.1, §5.1).
//   get                      Print the current package.json version (for CI).
//
// Web (`conva_web`) keeps an INDEPENDENT version line (SDLC §2.6 "independent
// clocks"); its build stamps its own package.json — this script governs the app.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_PKG = resolve(ROOT, "package.json");
const WS_CARGO = resolve(ROOT, "Cargo.toml");
const TAURI_CONF = resolve(ROOT, "src-tauri", "tauri.conf.json");
const VERSION_FILE = resolve(ROOT, "VERSION");

// Semver we accept: MAJOR.MINOR.PATCH with an optional -alpha/-beta/-rc.N
// prerelease (SDLC §3.2). Deliberately strict — the version is a contract.
const SEMVER = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/;

const die = (msg) => {
  console.error(`version.mjs: ${msg}`);
  process.exit(1);
};

/** Strip a leading `v` and surrounding whitespace from a tag/version string. */
const normalize = (v) => String(v).trim().replace(/^v/, "");

// ── carriers: read ────────────────────────────────────────────────────────
const readAppVersion = () => JSON.parse(readFileSync(APP_PKG, "utf8")).version;

// Scoped so we only ever touch the version under [workspace.package] and never
// cross into another TOML section (the `[^\[]*?` stops at the next `[`).
const CARGO_VERSION_RE =
  /(\[workspace\.package\][^[]*?\bversion\s*=\s*")([^"]*)(")/;
const readCargoVersion = () => {
  const m = readFileSync(WS_CARGO, "utf8").match(CARGO_VERSION_RE);
  return m ? m[2] : null;
};

// tauri.conf "version" may be a literal ("0.1.1") or a package.json reference
// ("../package.json"). Only the literal form participates in drift checks.
const readTauriVersionRaw = () =>
  JSON.parse(readFileSync(TAURI_CONF, "utf8")).version ?? null;
const isTauriLiteral = (v) => typeof v === "string" && SEMVER.test(v);

// ── carriers: write ───────────────────────────────────────────────────────
const writeAppVersion = (version) => {
  const pkg = JSON.parse(readFileSync(APP_PKG, "utf8"));
  pkg.version = version;
  writeFileSync(APP_PKG, JSON.stringify(pkg, null, 2) + "\n");
};

const writeCargoVersion = (version) => {
  const src = readFileSync(WS_CARGO, "utf8");
  if (!CARGO_VERSION_RE.test(src))
    die(`could not find [workspace.package] version in ${WS_CARGO}`);
  writeFileSync(
    WS_CARGO,
    src.replace(CARGO_VERSION_RE, (_all, pre, _old, post) => pre + version + post),
  );
};

/** Only writes if tauri.conf still carries a literal; a reference is left as-is. */
const writeTauriVersionIfLiteral = (version) => {
  const conf = JSON.parse(readFileSync(TAURI_CONF, "utf8"));
  if (!isTauriLiteral(conf.version)) return false;
  conf.version = version;
  writeFileSync(TAURI_CONF, JSON.stringify(conf, null, 2) + "\n");
  return true;
};

// ── MSI version (Windows / WiX) ───────────────────────────────────────────
// WiX's ProductVersion is four NUMERIC fields, so tauri-bundler refuses any
// pre-release identifier it cannot read as a number <= 65535:
//
//   failed to bundle project: `optional pre-release identifier in app version
//   must be numeric-only and cannot be greater than 65535 for msi target`
//
// Our contract (SDLC §3.2) is `-beta.N`, which is exactly the shape it
// rejects — so every dev beta died at the MSI bundle step, AFTER a full ~16
// minute release compile. That is why `dev-build.yml`'s Windows row had never
// once gone green (21/21 runs red) while macOS passed: dmg has no such rule,
// and NSIS only warns and pads to `.0`. MSI is the single target that hard-fails.
//
// tauri-bundler's escape hatch is `bundle.windows.wix.version`, which bypasses
// that conversion entirely — so map `X.Y.Z-beta.N` → `X.Y.Z.N` and set it
// there, and the version contract itself stays `-beta.N` everywhere else
// (package.json, the updater, What's New). Fix the installer, not the contract.

/** `X.Y.Z-beta.N` → `X.Y.Z.N` for WiX; `null` for a plain release (no override needed). */
export const msiVersion = (version) => {
  const m = /^(\d+)\.(\d+)\.(\d+)-(?:alpha|beta|rc)\.(\d+)$/.exec(version);
  if (!m) return null;
  const [, major, minor, patch, n] = m;
  if (Number(n) > 65535)
    throw new RangeError(
      `version.mjs: prerelease number ${n} in "${version}" exceeds the WiX limit of 65535`,
    );
  return `${major}.${minor}.${patch}.${n}`;
};

/**
 * Write (or clear) `bundle.windows.wix.version` in tauri.conf.json.
 *
 * Done as a surgical TEXT patch, not `JSON.stringify(conf)`: re-serializing
 * would reflow unrelated parts of the committed file (it collapses/expands
 * inline arrays such as `"schemes": ["conva"]`), so a local `version:set`
 * would leave a dirty tree that has nothing to do with the version.
 *
 * Clearing matters as much as writing: a release stamped over a previous beta
 * would otherwise ship that beta's stale MSI ProductVersion. Because the block
 * is written as one canonical line, adding and removing it is an exact
 * round-trip that leaves the rest of the file byte-identical.
 *
 * Returns the value written, or null when there is no override.
 */
// Both the managed line and the anchor tolerate CRLF: Windows runners check
// out with `core.autocrlf`, so tauri.conf.json arrives with \r\n there and LF
// everywhere else. Matching only \n made the stamp step fail on the Windows
// beta build (and ONLY there) — the post-condition below is what caught it.
const WIX_LINE_RE = /^ {4}"windows": \{ "wix": \{ "version": "[^"]*" \} \},\r?\n/m;
const BUNDLE_ANCHOR_RE = /^ {2}"bundle": \{\r?\n/m;

/**
 * Pure transform: tauri.conf.json source + desired MSI version -> new source.
 * `msi` of null removes the override. Exported so the round-trip is unit-tested
 * against both line endings rather than only on whichever CI runner runs first.
 */
export const patchWixVersion = (src, msi) => {
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  const stripped = src.replace(WIX_LINE_RE, "");
  if (msi === null) return stripped;
  const line = `    "windows": { "wix": { "version": "${msi}" } },${nl}`;
  return stripped.replace(BUNDLE_ANCHOR_RE, (m) => m + line);
};

const writeMsiVersion = (version) => {
  const msi = msiVersion(version);
  const src = readFileSync(TAURI_CONF, "utf8");

  // Only this script's own one-line form is managed. Anything else under
  // bundle.windows was put there by hand, and patching around it blindly would
  // either drop those settings or emit a duplicate key — fail loudly instead.
  if (JSON.parse(src).bundle?.windows !== undefined && !WIX_LINE_RE.test(src))
    die(
      `${TAURI_CONF} has a hand-written bundle.windows — fold the wix.version override into this script before stamping`,
    );

  const next = patchWixVersion(src, msi);

  // Post-condition: whatever the patch did, the parsed result must say exactly
  // what we intended — this catches an anchor that stopped matching after an
  // unrelated edit to tauri.conf.json, instead of silently building a wrong MSI.
  if ((JSON.parse(next).bundle?.windows?.wix?.version ?? null) !== msi)
    die(`could not set bundle.windows.wix.version in ${TAURI_CONF}`);

  if (next !== src) writeFileSync(TAURI_CONF, next);
  return msi;
};

// ── operations ────────────────────────────────────────────────────────────
function writeAll(version) {
  if (!SEMVER.test(version))
    die(`"${version}" is not a valid version (want MAJOR.MINOR.PATCH[-beta.N])`);

  writeAppVersion(version);
  writeCargoVersion(version);
  const touchedTauri = writeTauriVersionIfLiteral(version);
  const msi = writeMsiVersion(version);

  // Refresh Cargo.lock so the workspace crates record the new version. Best
  // effort: CI/dev have cargo; if it's missing we warn rather than fail (the
  // lockfile can be regenerated in the build job).
  const cargo = spawnSync("cargo", ["update", "-w"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (cargo.error)
    console.warn(
      "version.mjs: cargo not found — skipped `cargo update -w` (run it before building)",
    );

  console.log(`version.mjs: set ${version}`);
  console.log(`  package.json           → ${version}`);
  console.log(`  Cargo.toml             → ${version}`);
  console.log(
    `  src-tauri/tauri.conf   → ${touchedTauri ? version : "(references package.json — untouched)"}`,
  );
  console.log(
    `  tauri.conf wix.version → ${msi ?? "(release version — no MSI override)"}`,
  );
}

/** Resolve the version for `stamp`: explicit arg → tag env → git → VERSION. */
function resolveStampVersion(arg) {
  if (arg) return normalize(arg);

  // CI: the tag that triggered the run.
  const refName = process.env.GITHUB_REF_NAME; // e.g. "v0.2.0"
  if (refName && SEMVER.test(normalize(refName))) return normalize(refName);
  const ref = process.env.GITHUB_REF; // e.g. "refs/tags/v0.2.0"
  const fromRef = ref?.match(/refs\/tags\/(.+)$/)?.[1];
  if (fromRef && SEMVER.test(normalize(fromRef))) return normalize(fromRef);

  // Local: the exact tag on HEAD.
  const git = spawnSync("git", ["describe", "--tags", "--exact-match"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const gitTag = git.status === 0 ? normalize(git.stdout.toString()) : null;
  if (gitTag && SEMVER.test(gitTag)) return gitTag;

  // Fallback: a committed VERSION file.
  if (existsSync(VERSION_FILE)) {
    const fromFile = normalize(readFileSync(VERSION_FILE, "utf8"));
    if (SEMVER.test(fromFile)) return fromFile;
  }

  die("stamp: no version found (pass one, or run on a vX.Y.Z tag, or add a VERSION file)");
}

function check(tagArg) {
  const app = readAppVersion();
  const cargo = readCargoVersion();
  const tauriRaw = readTauriVersionRaw();
  const problems = [];

  if (cargo !== app)
    problems.push(`Cargo.toml (${cargo}) ≠ package.json (${app})`);

  if (isTauriLiteral(tauriRaw)) {
    if (tauriRaw !== app)
      problems.push(`tauri.conf.json (${tauriRaw}) ≠ package.json (${app})`);
  } else {
    console.log(
      `version.mjs: tauri.conf.json references package.json (${tauriRaw}) — derived, OK`,
    );
  }

  // The WiX override is derived, so it must agree with package.json — a
  // hand-edited or stale value would silently ship a wrong MSI ProductVersion.
  const wix = JSON.parse(readFileSync(TAURI_CONF, "utf8")).bundle?.windows?.wix?.version ?? null;
  const wantWix = msiVersion(app);
  if (wix !== wantWix)
    problems.push(
      `tauri.conf.json bundle.windows.wix.version (${wix ?? "unset"}) ≠ the value derived from package.json (${wantWix ?? "unset"}) — re-run \`version.mjs set ${app}\``,
    );

  if (tagArg) {
    const tag = normalize(tagArg);
    if (tag !== app)
      problems.push(`git tag (${tag}) ≠ package.json (${app}) — the tag must equal the version`);
  }

  if (problems.length) {
    console.error("version.mjs: version carriers disagree —");
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log(`version.mjs: OK — all carriers at ${app}${tagArg ? ` (matches tag)` : ""}`);
}

// ── CLI ───────────────────────────────────────────────────────────────────
// Entry guard: this file is also imported by version.test.mjs for the pure
// helpers above, and without the guard that import would run the CLI and
// process.exit() out of the test runner.
const isEntry =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const [cmd, ...rest] = process.argv.slice(2);
if (isEntry) {
  switch (cmd) {
    case "set": {
      const v = rest[0];
      if (!v) die("usage: version.mjs set <x.y.z[-beta.N]>");
      writeAll(normalize(v));
      break;
    }
    case "stamp":
      writeAll(resolveStampVersion(rest[0]));
      break;
    case "check": {
      const i = rest.indexOf("--tag");
      check(i >= 0 ? rest[i + 1] : null);
      break;
    }
    case "get":
      console.log(readAppVersion());
      break;
    default:
      console.error(
        "usage: version.mjs <set <x.y.z> | stamp [x.y.z|vX.Y.Z] | check [--tag vX.Y.Z] | get>",
      );
      process.exit(1);
  }
}
