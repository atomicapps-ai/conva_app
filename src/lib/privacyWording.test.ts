import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for the published privacy promises that live in code. The policy says
// conversation content is local by default, but with an AI key stored the live
// passes send transcript text to the provider (owner decision 2026-10-06, E9 in
// conva_core docs/technical/2026-10-public-release-go-no-go.md). Wording that
// claims "all on your machine" would be false, so it must not come back.
// Vitest runs from the repository root.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("privacy wording in shipped strings", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json")) as {
    bundle: { longDescription: string };
  };

  it("the installer description does not claim everything stays on the machine", () => {
    expect(conf.bundle.longDescription).not.toMatch(/all on your machine/i);
    expect(conf.bundle.longDescription).toMatch(/AI key/i);
    expect(conf.bundle.longDescription).toMatch(/AI provider/i);
  });

  it("no shipped UI string says conversation content never leaves the computer", () => {
    for (const f of [
      "src/components/ConsentGate.tsx",
      "src/components/FirstRunAiGate.tsx",
      "src/components/AllySettings.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/all on your machine|never leaves your computer|stays on your machine/i);
    }
  });

  it("the first-run key card says the conversation text goes to the provider", () => {
    expect(read("src/components/FirstRunAiGate.tsx")).toMatch(/conversation text from both sides is\s+sent to that provider/i);
  });

  it("the offline switch is worded the same in Settings and the consent notice", () => {
    expect(read("src/components/AllySettings.tsx")).toMatch(/Send nothing to an AI provider/);
    expect(read("src/components/ConsentGate.tsx")).toMatch(/Send nothing to an AI provider/);
  });

  it("every remote path checks offline mode (so a new caller can't skip it)", () => {
    // The choke points named in src-tauri/src/offline.rs.
    expect(read("src-tauri/src/llm.rs")).toMatch(/remote_call_allowed\(crate::offline::is_offline\(\)/);
    expect(read("src-tauri/src/session.rs")).toMatch(/offline::remote_allowed\(\)/);
    expect(read("src-tauri/src/tts.rs")).toMatch(/offline::guard_remote\(\)/);
    expect(read("src-tauri/src/web.rs")).toMatch(/offline::guard_remote\(\)/);
    expect(read("src-tauri/src/asr_deepgram.rs")).toMatch(/offline::guard_remote\(\)/);
    expect(read("src-tauri/src/research/mod.rs")).toMatch(/offline::remote_allowed\(\)/);
  });

  it("usage events are only queued and sent through the collection gate", () => {
    expect(read("src-tauri/src/telemetry_events.rs")).toMatch(/pub fn append[\s\S]{0,200}if !collecting\(app\)/);
    expect(read("src-tauri/src/events_flush.rs")).toMatch(/fn flush_once[\s\S]{0,300}telemetry_events::collecting\(app\)/);
  });

  it("the local-data erase only runs at the next start, marker first, so a stuck marker can never wipe data every launch", () => {
    const ld = read("src-tauri/src/local_data.rs");
    expect(ld).toMatch(/fs::remove_file\(&marker_path\)[\s\S]{0,200}not erasing/);
    expect(read("src-tauri/src/lib.rs")).toMatch(/local_data::run_pending_erase\(&handle\);[\s\S]{0,400}trace::init/);
  });
});
