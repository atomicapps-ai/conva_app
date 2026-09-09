/**
 * base64 (no `data:` prefix) -> `Blob`. The decode half of the wire format
 * `blobToBase64` (`src/lib/screenshot.ts`) encodes — used wherever a Tauri
 * command hands back base64 bytes to render as an image (`avatar_download`,
 * `src-tauri/src/avatar.rs`'s `AvatarBytes`).
 */
export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
