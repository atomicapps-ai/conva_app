# Desktop env toolkit

Encrypted, git-committed environment config for the desktop app. Same crypto and
file model as `conva_web/env` — but **each repo has its own master key**. They are
independent: `conva_app/env/master.key` and `conva_web/env/master.key` are
different keys, and neither opens the other repo's `.enc` files. This repo's
`CONVA_ENV_KEY` GitHub secret must therefore hold *this* repo's key.

> A `✗ Decryption failed — wrong key or the file was tampered with.` almost always
> means one of two things, not a corrupt file: the key from the other repo was
> pasted in, or the `.enc` was encrypted with an older key that has since been
> regenerated (`keygen` overwrites, and any `.enc` older than `master.key` is
> orphaned). Re-encrypt with the current key — `npm run env:encrypt:<env>` — and
> commit the result.

## Model

Per environment (`dev`, `prod`) two plaintext files live at the repo root and
**stay local** (gitignored):

| File | Holds |
|---|---|
| `.env.<env>` | config vars — `CONVA_SUPABASE_URL`, `CONVA_SUPABASE_ANON_KEY`, … |
| `.env.<env>.sec` | secrets — `TAURI_SIGNING_PRIVATE_KEY`, … |

Their encrypted twins **are committed**: `.env.<env>.enc`, `.env.<env>.sec.enc`
(AES-256-GCM). The 32-byte master key lives only in `env/master.key` (gitignored)
or the `CONVA_ENV_KEY` env var — **never committed**; share it out-of-band.

## First-time setup

```
node env/cli.mjs keygen                 # once — creates env/master.key (back it up + share CONVA_ENV_KEY)
cp .env.dev.example .env.dev            # fill in the <…> placeholders
cp .env.dev.sec.example .env.dev.sec    # fill in secrets
npm run env:encrypt:dev                 # → .env.dev.enc + .env.dev.sec.enc  (commit these)
```

Repeat with `prod`.

## Everyday use

```
npm run env:decrypt:dev                 # restore .env.dev[.sec] locally from the committed .enc
node env/cli.mjs print dev              # dump KEY=VALUE (used by CI → $GITHUB_ENV)
```

## How the values reach the app

- **Local dev** — decrypt, `source .env.dev`, then `npm run tauri:gpu`.
  `src-tauri/src/auth.rs` reads `CONVA_SUPABASE_*` from the runtime env.
- **CI dev build** — `.github/workflows/dev-build.yml` decrypts with the
  `CONVA_ENV_KEY` secret and exports the vars; the Rust build **bakes** them via
  `option_env!` so a distributed dev installer points at `conva-core-dev`, and
  the `TAURI_SIGNING_PRIVATE_KEY` signs the updater artifacts.

## Commands

| Command | Does |
|---|---|
| `keygen [--force]` | create `env/master.key` |
| `encrypt <env>` | plaintext → committed `.enc` |
| `decrypt <env> [--force]` | `.enc` → local plaintext |
| `print <env> [--mask]` | decrypt to stdout as `KEY=VALUE` |
