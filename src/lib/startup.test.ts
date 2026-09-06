import { describe, expect, it, vi } from "vitest";

import { runStartup } from "@/lib/startup";

describe("runStartup", () => {
  it("waits for AppState before init and finishes last", async () => {
    const calls: string[] = [];
    await runStartup({
      wait: async () => { calls.push("wait"); },
      ready: () => { calls.push("ready"); },
      init: async () => { calls.push("init"); },
      finish: async () => { calls.push("finish"); },
    });
    expect(calls).toEqual(["wait", "ready", "init", "finish"]);
  });

  it("does not initialize or close the splash after startup failure", async () => {
    const init = vi.fn(async () => {});
    const finish = vi.fn(async () => {});
    await expect(runStartup({
      wait: async () => { throw new Error("library failed"); },
      ready: vi.fn(),
      init,
      finish,
    })).rejects.toThrow("library failed");
    expect(init).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });
});
