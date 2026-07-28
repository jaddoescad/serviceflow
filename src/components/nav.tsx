"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";

const LINKS = [
  { href: "/", label: "Overview", icon: "▤" },
  { href: "/timesheets", label: "Timesheets", icon: "🕑" },
  { href: "/leads", label: "Leads & Estimates", icon: "◎" },
  { href: "/projects", label: "Jobs & Budgets", icon: "🏗" },
  { href: "/invoices", label: "Labour Invoices", icon: "🧾" },
  { href: "/employees", label: "Crew", icon: "👥" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 px-3">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
                : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
            )}
          >
            <span className="text-base leading-none">{link.icon}</span>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
