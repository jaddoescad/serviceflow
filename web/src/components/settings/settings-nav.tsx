"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Select, cn } from "@/components/ui";
import { SETTINGS_PAGES } from "@/lib/settings-pages";

/** The pages of Settings: a list beside the page on wide screens, a menu above it on phones. */
export function SettingsNav() {
  const pathname = usePathname();
  const router = useRouter();
  const active = SETTINGS_PAGES.find((page) => pathname === `/settings/${page.id}`)?.id;

  // Arriving from another page, the route's loading screen uses up Next's own
  // scroll to the hash.
  useEffect(() => {
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [pathname]);

  return (
    <nav aria-label="Settings">
      <Select
        aria-label="Settings page"
        className="w-full lg:hidden"
        value={active ?? ""}
        onChange={(event) => router.push(`/settings/${event.target.value}`)}
      >
        {SETTINGS_PAGES.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </Select>
      <ul className="sticky top-6 hidden space-y-0.5 lg:block">
        {SETTINGS_PAGES.map(({ id, label }) => (
          <li key={id}>
            <Link
              href={`/settings/${id}`}
              aria-current={active === id ? "page" : undefined}
              className={cn(
                "flex h-8 items-center rounded-[var(--radius-control)] px-2 text-[13px] transition-colors",
                active === id
                  ? "bg-[var(--color-selected)] font-medium text-[var(--color-heading)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]",
              )}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
