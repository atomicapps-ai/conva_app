#!/usr/bin/env node
/* conva (desktop) env toolkit — encrypt / decrypt / print environment config.

   Shares the exact crypto + file model as conva_web/env, so one shared
   CONVA_ENV_KEY unlocks both repos. Cloudflare-specific deploy commands are
   omitted here — the desktop app consumes these values differently:
     • local dev  →  `npm run env:decrypt:dev` then source .env.dev before
                     `npm run tauri:gpu`  (auth.rs reads CONVA_SUPABASE_* at runtime)
     • CI build   →  .github/workflows/dev-build.yml decrypts with CONVA_ENV_KEY
                     and exports the vars, which get BAKED into the binary via
                     option_env! (see src-tauri/src/auth.rs) + used for updater signing

   Model
   -----
   Per environment (dev, prod) two plaintext files at the repo root:
     .env.<env>       config vars   (CONVA_SUPABASE_URL, CONVA_SUPABASE_ANON_KEY, …)
     .env.<env>.sec   secrets       (TAURI_SIGNING_PRIVATE_KEY, …)
   Plaintext stays LOCAL (gitignored). Encrypted twins are committed:
     .env.<env>.enc   .env.<env>.sec.enc
   The 32-byte master key lives only in env/master.key or CONVA_ENV_KEY —
   never committed; share it out-of-band across machines/CI.

   Commands
   --------
   keygen [--force]           create env/master.key (32-byte AES key)
   encrypt <env>              .env.<env>[.sec]     → .env.<env>[.sec].enc   (commit these)
   decrypt <env> [--force]    .env.<env>[.sec].enc → .env.<env>[.sec]       (restore locally)
   print   <env> [--mask]     decrypt to stdout as KEY=VALUE (feed CI $GITHUB_ENV)
*/
import { encrypt, decrypt, loadKey, KEY_FILE } from "./crypto.mjs";
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

const ENVS = ["dev", "prod"];
const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const args = rest.filter((a) => !a.startsWith("--"));

function reqEnv() {
  const env = args[0];
  if (!env || !ENVS.includes(env)) {
    throw new Error(`Specify an environment: ${ENVS.join(" | ")}  (e.g. \`node env/cli.mjs ${cmd || "encrypt"} dev\`)`);
  }
  return env;
}

const files = (env) => ({
  vars: `.env.${env}`,
  secrets: `.env.${env}.sec`,
  varsEnc: `.env.${env}.enc`,
  secretsEnc: `.env.${env}.sec.enc`,
});

function parseEnv(text) {
  const out = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const mask = (v) => (v.length <= 8 ? "••••" : v.slice(0, 4) + "…" + v.slice(-4));

function keygen() {
  if (existsSync(KEY_FILE) && !flags.has("--force")) {
    throw new Error(`${KEY_FILE} already exists. Refusing to overwrite (pass --force — this invalidates every existing .enc file).`);
  }
  mkdirSync(dirname(KEY_FILE), { recursive: true });
  const key = randomBytes(32).toString("base64");
  writeFileSync(KEY_FILE, key + "\n", { mode: 0o600 });
  try { chmodSync(KEY_FILE, 0o600); } catch {}
  console.log(`✓ Wrote a new 32-byte master key → ${KEY_FILE} (gitignored, chmod 600)`);
  console.log("  Back this up. Anyone with it can decrypt the committed .enc files.");
  console.log("  Share it across machines/CI as an env var:  CONVA_ENV_KEY=" + key);
}

function cmdEncrypt(env) {
  const key = loadKey();
  const f = files(env);
  let n = 0;
  for (const [src, dst, label] of [[f.vars, f.varsEnc, "vars"], [f.secrets, f.secretsEnc, "secrets"]]) {
    if (!existsSync(src)) { console.log(`· ${src} not found — skipping ${label}`); continue; }
    writeFileSync(dst, encrypt(readFileSync(src, "utf8"), key));
    const count = Object.keys(parseEnv(readFileSync(src, "utf8"))).length;
    console.log(`✓ ${src} → ${dst}  (${count} ${label})`);
    n++;
  }
  if (!n) throw new Error(`No .env.${env}[.sec] files to encrypt.`);
  console.log(`\nCommit the .enc file(s). The plaintext .env.${env}* stays local (gitignored).`);
}

function cmdDecrypt(env) {
  const key = loadKey();
  const f = files(env);
  let n = 0;
  for (const [enc, dst] of [[f.varsEnc, f.vars], [f.secretsEnc, f.secrets]]) {
    if (!existsSync(enc)) continue;
    if (existsSync(dst) && !flags.has("--force")) {
      throw new Error(`${dst} already exists. Pass --force to overwrite it with the decrypted contents.`);
    }
    writeFileSync(dst, decrypt(readFileSync(enc, "utf8"), key));
    console.log(`✓ ${enc} → ${dst}`);
    n++;
  }
  if (!n) throw new Error(`No .env.${env}[.sec].enc files to decrypt.`);
}

function cmdPrint(env) {
  const key = loadKey();
  const f = files(env);
  for (const [enc, secret] of [[f.varsEnc, false], [f.secretsEnc, true]]) {
    if (!existsSync(enc)) continue;
    const kv = parseEnv(decrypt(readFileSync(enc, "utf8"), key));
    for (const [k, v] of Object.entries(kv)) {
      console.log(`${k}=${secret && flags.has("--mask") ? mask(v) : v}`);
    }
  }
}

function usage() {
  console.log("Usage: node env/cli.mjs <keygen|encrypt|decrypt|print> [dev|prod] [--force] [--mask]");
}

try {
  switch (cmd) {
    case "keygen": keygen(); break;
    case "encrypt": cmdEncrypt(reqEnv()); break;
    case "decrypt": cmdDecrypt(reqEnv()); break;
    case "print": cmdPrint(reqEnv()); break;
    default: usage();
  }
} catch (e) {
  console.error("✗ " + (e?.message || e));
  process.exit(1);
}
