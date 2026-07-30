/* conva env toolkit — encryption primitives.
   Zero dependencies: Node's built-in crypto only. AES-256-GCM (authenticated).
   The master key never leaves your machine — it's read from the CONVA_ENV_KEY
   environment variable (base64, 32 bytes) or from env/master.key. */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const KEY_FILE = join(HERE, "master.key");
const ALG = "aes-256-gcm";
const VERSION = 1;

/** Load the 32-byte master key from CONVA_ENV_KEY (base64) or env/master.key. */
export function loadKey() {
  let raw = process.env.CONVA_ENV_KEY;
  if (!raw && existsSync(KEY_FILE)) raw = readFileSync(KEY_FILE, "utf8").trim();
  if (!raw) {
    throw new Error(
      "No encryption key. Set CONVA_ENV_KEY (base64, 32 bytes) or run `npm run env -- keygen` to create env/master.key."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`Master key must decode to 32 bytes; got ${key.length}. Regenerate with \`npm run env -- keygen\`.`);
  }
  return key;
}

/** Encrypt UTF-8 plaintext → a committable JSON envelope string (one line + newline). */
export function encrypt(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const env = {
    _: "conva-env-encrypted",
    v: VERSION,
    alg: ALG,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
  };
  return JSON.stringify(env) + "\n";
}

/** Decrypt a JSON envelope string → UTF-8 plaintext. Throws if tampered. */
export function decrypt(envelope, key) {
  let o;
  try {
    o = JSON.parse(envelope);
  } catch {
    throw new Error("Not a valid encrypted envelope (invalid JSON).");
  }
  if (o._ !== "conva-env-encrypted" || o.alg !== ALG) {
    throw new Error("Unrecognized envelope format.");
  }
  const decipher = createDecipheriv(ALG, key, Buffer.from(o.iv, "base64"));
  decipher.setAuthTag(Buffer.from(o.tag, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(o.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Decryption failed — wrong key or the file was tampered with.");
  }
}
