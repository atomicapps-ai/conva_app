/**
 * Settings' left sub-nav — AppUI V5.0 §8.
 *
 * > Settings is not a rail row — it opens from the **gear** in the account
 * > utility row below [the user]. No nav row is active while on Settings.
 * > …Account, devices, transcription, Ally, privacy.
 *
 * Seven groups, in that order (Usage and Subscription split out of Ally,
 * 2026-09-03). Every pre-V5 Settings section is mapped onto one of them —
 * nothing was dropped in the reorganisation, and this table is the record
 * of where each went, so a future section has an obvious home:
 *
 * | Group         | Sections it owns                                          |
 * | ------------- | --------------------------------------------------------- |
 * | Account       | sign-in, display name + role                              |
 * | Devices       | microphone + system-audio device pickers                  |
 * | Transcription | engine, whisper model, noise filter                       |
 * | Ally          | providers & models, web research key                      |
 * | Usage         | usage counters (LLM tokens, searches, time listening)      |
 * | Subscription  | plan + billing (mocked — see SubscriptionSettings.tsx)    |
 * | Privacy       | portable secrets, settings file, about & extras           |
 */

export type SettingsGroup =
  | "account"
  | "devices"
  | "transcription"
  | "ally"
  | "usage"
  | "subscription"
  | "privacy";

export const SETTINGS_GROUPS: { id: SettingsGroup; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "devices", label: "Devices" },
  { id: "transcription", label: "Transcription" },
  { id: "ally", label: "Ally" },
  { id: "usage", label: "Usage" },
  { id: "subscription", label: "Subscription" },
  { id: "privacy", label: "Privacy" },
];

export const DEFAULT_SETTINGS_GROUP: SettingsGroup = "account";

/** Narrow an arbitrary string (e.g. a stored pref) to a real group. */
export function toSettingsGroup(value: string | null | undefined): SettingsGroup {
  return SETTINGS_GROUPS.some((g) => g.id === value)
    ? (value as SettingsGroup)
    : DEFAULT_SETTINGS_GROUP;
}

/**
 * Roving arrow-key movement down the sub-nav (same interaction contract as the
 * Context tabs, §12). Up/Down wrap; Home/End jump to the ends.
 */
export function groupForKey(current: SettingsGroup, key: string): SettingsGroup {
  const ids = SETTINGS_GROUPS.map((g) => g.id);
  const i = ids.indexOf(current);
  if (i < 0) return current;
  switch (key) {
    case "ArrowDown":
      return ids[(i + 1) % ids.length] as SettingsGroup;
    case "ArrowUp":
      return ids[(i - 1 + ids.length) % ids.length] as SettingsGroup;
    case "Home":
      return ids[0] as SettingsGroup;
    case "End":
      return ids[ids.length - 1] as SettingsGroup;
    default:
      return current;
  }
}
