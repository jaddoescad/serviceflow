"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SignOutButton } from "@/components/sign-out";
import { cn } from "@/components/ui";

const LINKS = [
  { href: "/", label: "Overview", icon: "▤" },
  { href: "/timesheets", label: "Timesheets", icon: "🕑" },
  { href: "/leads", label: "Leads & Estimates", icon: "◎" },
  { href: "/jobs", label: "Jobs & Budgets", icon: "🏗" },
  { href: "/financials", label: "Financials", icon: "＄" },
  { href: "/marketing", label: "Marketing", icon: "↗" },
  { href: "/invoices", label: "Labour invoices", icon: "🧾" },
  { href: "/material-invoices", label: "Material invoices", icon: "▧" },
  { href: "/employees", label: "Crew", icon: "👥" },
];

export function Nav({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 px-3">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
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

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      menuButtonRef.current?.focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 md:hidden">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <span className="font-display inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand)] text-sm font-bold text-[var(--color-brand-ink)]">
            OP
          </span>
          <span className="truncate text-sm font-semibold text-[var(--color-heading)]">
            Ottawa Painters
          </span>
        </Link>
        <button
          ref={menuButtonRef}
          type="button"
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="mobile-navigation-drawer"
          onClick={() => setOpen(true)}
          className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xl text-[var(--color-heading)]"
        >
          <span aria-hidden="true">☰</span>
        </button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/45"
          />
          <section
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="absolute inset-y-0 right-0 flex w-[min(88vw,22rem)] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4">
              <div>
                <div className="text-sm font-semibold text-[var(--color-heading)]">Menu</div>
                <div className="text-xs text-[var(--color-muted)]">Ottawa Painters admin</div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close navigation"
                onClick={() => {
                  setOpen(false);
                  menuButtonRef.current?.focus();
                }}
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-2xl text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-4">
              <Nav onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-[var(--color-border)] px-4 py-4">
              <SignOutButton />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
