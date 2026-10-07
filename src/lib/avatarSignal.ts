/**
 * A tiny "the profile photo changed" signal. The photo is uploaded or removed on
 * the Profile page, but it is shown in other places too (the rail's account
 * block, Home, Settings), each of which reads it independently. Upload and
 * delete call [`notifyAvatarChanged`]; every reader that cares subscribes with
 * [`onAvatarChanged`] and reloads. No payload: the photo itself is always
 * re-read from the backend, never passed around.
 */
const EVENT = "conva:avatar-changed";

export function notifyAvatarChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function onAvatarChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
