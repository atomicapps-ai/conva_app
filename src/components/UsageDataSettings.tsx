import { useCallback, useEffect, useState } from "react";

import { useBackend } from "@/lib/backend";
import type { TelemetryStatus } from "@/lib/ipc";
import { useAppStore } from "@/state/app";

/**
 * Settings → Privacy → Usage data. The switch for the content-free usage
 * events the desktop app queues locally and, while signed in, sends to Conva.
 * Off stops collection and deletes the unsent queue. For an invited beta
 * participant the server says usage data is required (beta terms), so the box
 * is locked on and says why. Desktop only: the web build has no local queue.
 */
export function UsageDataSettings() {
  const backend = useBackend();
  const config = useAppStore((s) => s.config);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const [status, setStatus] = useState<TelemetryStatus | null>(null);

  const refresh = useCallback(() => {
    void backend.usage.telemetryStatus().then(setStatus).catch(() => setStatus(null));
  }, [backend]);

  useEffect(refresh, [refresh]);

  if (!config || !status) return null;

  const locked = status.required;
  const on = locked || config.telemetry_enabled;

  return (
    <div className="flex flex-col gap-2.5" data-testid="usage-data-setting">
      <label className="flex items-start gap-2 text-xs text-fg">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={on}
          disabled={locked}
          onChange={(e) => {
            if (locked) return;
            void updateConfig({ telemetry_enabled: e.target.checked }).then(refresh);
          }}
        />
        <span className="font-medium">
          Send usage data to Conva while I&apos;m signed in
        </span>
      </label>
      {locked && (
        <p className="text-[11px] text-fg-muted" data-testid="usage-data-locked">
          Required for your beta account. Usage data is part of the beta terms,
          so this stays on while you take part.
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-fg-muted">
        The app records counts and feature use: which features you use, how long
        a session ran, token counts and error codes. It never records audio,
        transcripts, document names or document contents. The record is a plain
        file on this computer that you can open
        {status.log_path ? (
          <>
            : <code className="font-mono">{status.log_path}</code>
          </>
        ) : null}
        . While you&apos;re signed in it is sent to Conva about once a minute.
        {!locked && (
          <>
            {" "}
            Switching this off stops the recording and deletes anything not yet
            sent.
          </>
        )}{" "}
        It does not cover signing in, update checks or speech-model downloads.
      </p>
    </div>
  );
}
