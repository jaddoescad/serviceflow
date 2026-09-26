"use client";

import { useEffect, useState } from "react";
import { cn } from "@/components/ui";

export const SETTINGS_SECTIONS = [
  { id: "company", label: "Company" },
  { id: "labour", label: "Labour budget" },
  { id: "team", label: "Team & access" },
  { id: "integrations", label: "Integrations" },
  { id: "account", label: "Your account" },
];

/** Section list that highlights the section currently in view. */
export function SettingsNav() {
  const [active, setActive] = useState(SETTINGS_SECTIONS[0].id);

  useEffect(() => {
    // The section whose top has scrolled past the top of the screen; the last
    // one once the page is scrolled to the bottom.
    function update() {
      const sections = SETTINGS_SECTIONS.map(({ id }) => document.getElementById(id)).filter(
        (section): section is HTMLElement => section != null,
      );
      if (!sections.length) return;
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      const current = atBottom
        ? sections[sections.length - 1]
        : [...sections].reverse().find((section) => section.getBoundingClientRect().top <= 120) ??
          sections[0];
      setActive(current.id);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <nav aria-label="Settings sections" className="sticky top-6">
      <ul className="space-y-0.5">
        {SETTINGS_SECTIONS.map(({ id, label }) => (
          <li key={id}>
            <a
              href={`#${id}`}
              onClick={() => setActive(id)}
              aria-current={active === id ? "true" : undefined}
              className={cn(
                "block rounded-md px-3 py-1.5 text-sm transition-colors",
                active === id
                  ? "bg-[var(--color-surface-2)] font-medium text-[var(--color-heading)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-text)]",
              )}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
