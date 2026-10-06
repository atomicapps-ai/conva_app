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
});
