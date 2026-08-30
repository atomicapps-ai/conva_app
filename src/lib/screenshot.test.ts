import { describe, expect, it } from "vitest";

import { blobToBase64 } from "@/lib/screenshot";

describe("blobToBase64", () => {
  it("strips the data: URL prefix, leaving only the base64 payload", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const b64 = await blobToBase64(blob);
    // "hello" -> base64 "aGVsbG8=", with no "data:...;base64," prefix left.
    expect(b64).toBe("aGVsbG8=");
    expect(b64.startsWith("data:")).toBe(false);
  });

  it("round-trips through atob back to the original bytes", async () => {
    const blob = new Blob(["conva screenshot"], { type: "image/png" });
    const b64 = await blobToBase64(blob);
    expect(atob(b64)).toBe("conva screenshot");
  });
});
