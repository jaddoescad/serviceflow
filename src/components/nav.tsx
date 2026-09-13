"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NAV_ICONS, SearchNavIcon } from "@/components/nav-icons";
import { SignOutButton } from "@/components/sign-out";
import { cn } from "@/components/ui";
import { initials } from "@/lib/format";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/contacts", label: "Contacts" },
  { href: "/leads", label: "Deals" },
  { href: "/jobs", label: "Jobs & Budgets" },
  { href: "/photos", label: "Photos" },
  { href: "/financials", label: "Financials" },
  { href: "/invoices", label: "Labour invoices" },
  { href: "/timesheets", label: "Timesheets" },
  { href: "/employees", label: "Crew" },
];

export function Nav({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("en-CA");
  const filteredLinks = normalizedQuery
    ? LINKS.filter((link) => link.label.toLocaleLowerCase("en-CA").includes(normalizedQuery))
    : LINKS;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4">
        <div className="relative">
          <SearchNavIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--sidebar-muted)]" />
          <input
            type="search"
            aria-label="Filter navigation"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            className="h-11 w-full rounded-xl border border-[var(--sidebar-border)] bg-[var(--sidebar-surface)] pl-10 pr-3 text-sm text-[var(--sidebar-text)] outline-none placeholder:text-[var(--sidebar-muted)] focus:border-[#6ea8ff] focus:ring-2 focus:ring-[#6ea8ff]/25"
          />
          {normalizedQuery ? (
            <span className="sr-only" aria-live="polite">
              {filteredLinks.length} of {LINKS.length} pages
            </span>
          ) : null}
        </div>
      </div>

      <div className="px-6 pb-2 pt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--sidebar-muted)]">
        Operations
      </div>

      <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="flex flex-col gap-1">
          {filteredLinks.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#6ea8ff]",
                  active
                    ? "bg-[var(--sidebar-active)] font-semibold text-[var(--sidebar-text)] before:absolute before:-left-3 before:inset-y-2 before:w-1 before:rounded-r-full before:bg-[#6ea8ff]"
                    : "text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-surface)] hover:text-[var(--sidebar-text)]",
                )}
              >
                {NAV_ICONS[link.href]}
                <span>{link.label}</span>
              </Link>
            );
          })}
          {filteredLinks.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--sidebar-muted)]">
              No pages match
            </div>
          ) : null}
        </div>
      </nav>
    </div>
  );
}

export function SidebarAccount({ name, role }: { name: string; role: string }) {
  return (
    <div className="border-t border-[var(--sidebar-border)] px-4 py-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dfe7f2] text-xs font-bold text-[#435169]">
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-semibold text-[var(--sidebar-text)]">{name}</div>
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sidebar-muted)]">
            {role}
          </div>
        </div>
      </div>
      <SignOutButton className="mt-3 w-full justify-start px-3 py-2 text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-surface)] hover:text-[var(--sidebar-text)]" />
    </div>
  );
}

export function MobileNav({ name, role }: { name: string; role: string }) {
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
            data-sidebar
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="absolute inset-y-0 right-0 flex w-[min(88vw,22rem)] flex-col bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] shadow-2xl"
          >
            <div className="flex h-[76px] shrink-0 items-center justify-between px-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="font-display inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2979ff] text-sm font-bold text-white shadow-[0_8px_24px_rgba(41,121,255,0.3)]">
                  OP
                </span>
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-sm font-semibold text-[var(--sidebar-text)]">Ottawa Painters</div>
                  <div className="mt-0.5 text-[11px] text-[var(--sidebar-muted)]">Admin dashboard</div>
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close navigation"
                onClick={() => {
                  setOpen(false);
                  menuButtonRef.current?.focus();
                }}
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-2xl text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-surface)] hover:text-[var(--sidebar-text)]"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col pb-2">
              <Nav onNavigate={() => setOpen(false)} />
            </div>
            <SidebarAccount name={name} role={role} />
          </section>
        </div>
      ) : null}
    </>
  );
}
