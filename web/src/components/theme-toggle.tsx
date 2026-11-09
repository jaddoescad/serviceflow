"use client";

import { useState } from "react";
import { Switch } from "./pipeline-ui";

// Lives in the account menu, which only renders after a click, so reading the
// theme the root layout's script set is safe here.
export function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.dataset.theme === "dark",
  );
  function change(next: boolean) {
    const theme = next ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {}
    setDark(next);
  }
  return (
    <div className="flex h-8 items-center gap-2 px-2 text-[13px] text-[var(--color-text)]">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 shrink-0 text-[var(--color-muted)]"
      >
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
      Dark mode
      <span className="ml-auto flex">
        <Switch label="Dark mode" checked={dark} onChange={change} />
      </span>
    </div>
  );
}
