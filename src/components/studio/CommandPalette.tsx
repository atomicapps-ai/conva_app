import { useEffect, useMemo, useRef, useState } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { isTauri } from "@/lib/ipc";
import { useAppStore } from "@/state/app";
import { useNavStore, type View } from "@/state/nav";
import { useTranscriptStore } from "@/state/transcript";

/**
 * ⌘K command palette (UI overhaul M2). A floating, filterable action list over
 * the whole Studio: jump to any view and drive the session (start/stop, record,
 * compact) without hunting for a control. The global ⌘K/Ctrl+K binding lives in
 * StudioShell; this component owns the open UI, filtering, and keyboard nav.
 */

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

export function CommandPalette() {
  const open = useNavStore((s) => s.paletteOpen);
  const close = useNavStore((s) => s.closePalette);
  const setView = useNavStore((s) => s.setView);

  const listening =
    useTranscriptStore((s) => s.session.state) === "listening";
  const recording = useAppStore((s) => s.recording);
  const compact = useAppStore((s) => s.compact);
  const start = useAppStore((s) => s.start);
  const stop = useAppStore((s) => s.stop);
  const startRecording = useAppStore((s) => s.startRecording);
  const stopRecording = useAppStore((s) => s.stopRecording);
  const toggleCompact = useAppStore((s) => s.toggleCompact);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (view: View, label: string, icon: IconName): Command => ({
      id: `go:${view}`,
      label,
      hint: "View",
      icon,
      run: () => setView(view),
    });
    const nav: Command[] = [
      go("live", "Go to Live", "live"),
      go("conversations", "Go to Conversations", "conversations"),
      go("sessions", "Go to Sessions", "sessions"),
      go("library", "Go to Library", "library"),
      go("settings", "Go to Settings", "settings"),
    ];
    if (!isTauri()) return nav;

    const session: Command[] = [
      listening
        ? {
            id: "session:stop",
            label: "Stop listening",
            hint: "Session",
            icon: "live",
            run: () => void stop(),
          }
        : {
            id: "session:start",
            label: "Start listening",
            hint: "Session",
            icon: "live",
            run: () => void start(),
          },
      recording
        ? {
            id: "rec:stop",
            label: "Stop recording",
            hint: "Session",
            icon: "record",
            run: () => void stopRecording(),
          }
        : {
            id: "rec:start",
            label: "Record the call",
            hint: "Session",
            icon: "record",
            run: () => void startRecording(),
          },
      {
        id: "compact:toggle",
        label: compact ? "Exit compact mode" : "Enter compact mode",
        hint: "Window",
        icon: "compact",
        run: () => void toggleCompact(),
      },
    ];
    return [...nav, ...session];
  }, [
    listening,
    recording,
    compact,
    setView,
    start,
    stop,
    startRecording,
    stopRecording,
    toggleCompact,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  // Reset query + selection and focus the field whenever the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Focus after the element mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep the active row in range as the filtered list changes.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    cmd.run();
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[active]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 cursor-default bg-bg/60 backdrop-blur-sm"
        onClick={close}
      />

      <div
        className="glass-raised animate-rise relative w-[min(34rem,92vw)] overflow-hidden rounded-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Icon name="search" size={18} className="text-fg-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands…"
            className="w-full bg-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none"
            aria-label="Search commands"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-fg-faint">
            Esc
          </kbd>
        </div>

        <ul className="max-h-[min(24rem,52vh)] overflow-y-auto p-2">
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-fg-faint">
              No matching commands
            </li>
          )}
          {filtered.map((cmd, i) => (
            <li key={cmd.id}>
              <button
                type="button"
                onMouseMove={() => setActive(i)}
                onClick={() => run(cmd)}
                aria-selected={i === active}
                className={[
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition",
                  i === active
                    ? "bg-panel-raised text-fg"
                    : "text-fg-muted hover:text-fg",
                ].join(" ")}
              >
                <Icon
                  name={cmd.icon}
                  size={17}
                  className={i === active ? "text-inbound" : "text-fg-faint"}
                />
                <span className="flex-1">{cmd.label}</span>
                {cmd.hint && (
                  <span className="text-[10px] uppercase tracking-wider text-fg-faint">
                    {cmd.hint}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
