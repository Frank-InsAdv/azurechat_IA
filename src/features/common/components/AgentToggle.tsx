"use client";

import React from "react";

type AgentToggleProps = {
  /** Optional initial value. If omitted, component uses localStorage → env default. */
  initialEnabled?: boolean;
  /** Callback invoked on each toggle (true = use Agent route; false = use Model route). */
  onToggle?: (enabled: boolean) => void;
  /** Optional label text (UI copy). */
  label?: string;
  /** Optional helper text (UI copy). */
  helperText?: string;
  /** Change this if you want a different localStorage key. */
  storageKey?: string;
  /** Optional className for container. */
  className?: string;
};

const DEFAULT_STORAGE_KEY = "ia-agent-toggle";

/** Resolve default enabled state: localStorage → prop → env → false. */
function resolveDefaultEnabled(
  storageKey: string,
  initialEnabled?: boolean
): boolean {
  if (typeof window !== "undefined") {
    const persisted = window.localStorage.getItem(storageKey);
    if (persisted === "true" || persisted === "false") {
      return persisted === "true";
    }
  }
  if (typeof initialEnabled === "boolean") return initialEnabled;

  // Prefer NEXT_PUBLIC_* (available on client); fallback to FEATURE_AGENT_SEARCH if injected at build.
  const envDefault =
    (process.env.NEXT_PUBLIC_FEATURE_AGENT_SEARCH ??
      process.env.FEATURE_AGENT_SEARCH ??
      "false")
      .toString()
      .toLowerCase() === "true";

  return envDefault;
}

export default function AgentToggle({
  initialEnabled,
  onToggle,
  label = "Use Agent (Web Search)",
  helperText = "When enabled, messages go via the Foundry Agent and can use live web data. Turn off to use the standard model path.",
  storageKey = DEFAULT_STORAGE_KEY,
  className = "",
}: AgentToggleProps) {
  const [enabled, setEnabled] = React.useState<boolean>(() =>
    resolveDefaultEnabled(storageKey, initialEnabled)
  );

  React.useEffect(() => {
    onToggle?.(enabled);
  }, [enabled, onToggle]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    setEnabled(next);
    try {
      window.localStorage.setItem(storageKey, String(next));
    } catch {
      // ignore storage errors (private mode, etc.)
    }
  };

  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <label className="flex items-center gap-3 cursor-pointer select-none">
        {/* Visually styled switch using Tailwind (no external UI deps) */}
        <input
          type="checkbox"
          role="switch"
          aria-checked={enabled}
          aria-label={label}
          checked={enabled}
          onChange={handleChange}
          className="sr-only peer"
        />
        <span
          className={[
            "inline-flex h-6 w-11 items-center rounded-full transition-colors",
            enabled ? "bg-emerald-500" : "bg-gray-400",
          ].join(" ")}
        >
          <span
            className={[
              "h-5 w-5 rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-5" : "translate-x-1",
            ].join(" ")}
          />
        </span>

        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {label}
          </span>
          <span className="text-xs text-gray-600 dark:text-gray-400 max-w-prose">
            {helperText}
          </span>
        </div>
      </label>
    </div>
  );
}
