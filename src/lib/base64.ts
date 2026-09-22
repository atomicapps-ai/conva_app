/**
 * base64 (no `data:` prefix) -> `Blob`. The decode half of the wire format
 * `blobToBase64` (below) encodes — used wherever a Tauri
 * command hands back base64 bytes to render as an image (`avatar_download`,
 * `src-tauri/src/avatar.rs`'s `AvatarBytes`).
 */
export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** `Blob` -> base64 (no `data:` prefix) — the encode half of
 *  {@link base64ToBlob}, and what every Tauri command taking a plain base64
 *  string expects (`save_screenshot`'s `png_base64`, `avatar_upload`'s
 *  `bytes_base64`, `context_store_doc_bytes`'). `File` is a `Blob`, so a
 *  dropped or pasted document can be passed straight in. FileReader handles
 *  multi-MB inputs without the argument-limit problem a `fromCharCode` spread
 *  would hit. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("failed to read blob"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("unexpected FileReader result type"));
        return;
      }
      // "data:image/png;base64,AAAA..." -> "AAAA..."
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}
