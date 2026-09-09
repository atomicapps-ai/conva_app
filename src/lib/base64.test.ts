import { describe, expect, it } from "vitest";

import { base64ToBlob } from "@/lib/base64";
import { blobToBase64 } from "@/lib/screenshot";

// jsdom's Blob shim has no `.arrayBuffer()` — read it the same way
// blobToBase64 itself does (FileReader), which jsdom does implement fully.
function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

describe("base64ToBlob", () => {
  it("round-trips with blobToBase64", async () => {
    const original = new Blob([new Uint8Array([0, 1, 2, 253, 254, 255])], { type: "image/jpeg" });
    const encoded = await blobToBase64(original);
    const decoded = base64ToBlob(encoded, "image/jpeg");
    expect(decoded.type).toBe("image/jpeg");
    expect(decoded.size).toBe(6);
    const bytes = await readBlob(decoded);
    expect([...bytes]).toEqual([0, 1, 2, 253, 254, 255]);
  });

  it("produces an empty blob for empty input", () => {
    const decoded = base64ToBlob("", "image/png");
    expect(decoded.size).toBe(0);
  });
});
