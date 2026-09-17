"use client";

import dynamic from "next/dynamic";
const CreateWorkspaceProject = dynamic(() =>
  import("./create-workspace-project").then(
    (module) => module.CreateWorkspaceProject,
  ),
);

import { SITE_NAME, SITE_INITIALS } from "@/lib/site-brand";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NAV_ICONS } from "@/components/nav-icons";
import { ProjectSearch } from "@/components/project-search";
import { SignOutButton } from "@/components/sign-out";
import { cn } from "@/components/ui";
import { initials } from "@/lib/format";

const LINKS = [
  { href: "/projects", label: "Projects", icon: "/projects" },
  { href: "/photos", label: "Photos", icon: "/photos" },
  { href: "/contacts", label: "Customers", icon: "/contacts" },
  { href: "/employees", label: "Team", icon: "/employees" },
  { href: "/labels", label: "Labels", icon: "/labels" },
  { href: "/projects?view=trash", label: "Project Trash", icon: "/trash" },
];

export function Nav({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [resourcesOpen, setResourcesOpen] = useState(true);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ProjectSearch onNavigate={onNavigate} />

      <div className="px-5 pb-2 pt-5 text-xs font-semibold text-[var(--sidebar-text)]">
        ServiceFlow
      </div>

      <nav
        aria-label="Main navigation"
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
      >
        <div className="flex flex-col gap-0.5">
          {LINKS.map((link) => {
            const active = link.href.includes("?")
              ? pathname === "/projects" && params.get("view") === "trash"
              : (pathname.startsWith(link.href) ||
                  (link.href === "/projects" &&
                    pathname.startsWith("/jobs/"))) &&
                !(link.href === "/projects" && params.get("view") === "trash");
            return (
              <div key={link.href}>
                {link.href === "/labels" ? (
                  <button
                    type="button"
                    aria-expanded={resourcesOpen}
                    onClick={() => setResourcesOpen(!resourcesOpen)}
                    className="flex w-full items-center justify-between px-3 pb-2 pt-7 text-xs font-semibold text-[var(--sidebar-muted)] hover:text-white"
                  >
                    Resources{" "}
                    <span aria-hidden="true">{resourcesOpen ? "⌃" : "⌄"}</span>
                  </button>
                ) : null}
                <Link
                  hidden={
                    !resourcesOpen && ["/labels", "/trash"].includes(link.icon)
                  }
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "relative items-center gap-3 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#6ea8ff]",
                    !resourcesOpen && ["/labels", "/trash"].includes(link.icon)
                      ? "hidden"
                      : "flex",
                    active
                      ? "bg-[var(--sidebar-active)] font-semibold text-[var(--sidebar-text)] before:absolute before:-left-3 before:inset-y-2 before:w-1 before:rounded-r-full before:bg-[#6ea8ff]"
                      : "text-[var(--sidebar-muted)] hover:bg-[var(--sidebar-surface)] hover:text-[var(--sidebar-text)]",
                  )}
                >
                  {NAV_ICONS[link.icon]}
                  <span>{link.label}</span>
                </Link>
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function SidebarHeader({
  name,
  role,
  userId,
  onNavigate,
  trailing,
}: {
  name: string;
  role: string;
  userId: string;
  onNavigate?: () => void;
  trailing?: ReactNode;
}) {
  const [menu, setMenu] = useState<"create" | "account" | null>(null);
  const [creating, setCreating] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    panel.current?.querySelector<HTMLElement>("a,button")?.focus();
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setMenu(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenu(null);
      (menu === "create" ? createButton : accountButton).current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    root.current?.addEventListener("keydown", escape);
    const element = root.current;
    return () => {
      document.removeEventListener("pointerdown", outside);
      element?.removeEventListener("keydown", escape);
    };
  }, [menu]);
  return (
    <>
      <div
        ref={root}
        className="relative z-40 flex h-16 shrink-0 items-center gap-3 px-4"
      >
        <Link
          href="/projects"
          aria-label={SITE_NAME}
          onClick={onNavigate}
          className="mr-auto flex h-8 w-8 items-center justify-center rounded-lg bg-[#2979ff] text-xs font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          {SITE_INITIALS}
        </Link>
        {["admin", "manager"].includes(role) && (
          <button
            ref={createButton}
            type="button"
            aria-label="Create"
            title="Create"
            aria-expanded={menu === "create"}
            onClick={() => setMenu(menu === "create" ? null : "create")}
            className="flex h-8 w-8 items-center justify-center rounded text-[var(--sidebar-muted)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <svg
              aria-hidden="true"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v10M7 12h10" />
            </svg>
          </button>
        )}
        <button
          ref={accountButton}
          type="button"
          aria-label={`Account: ${name}`}
          title={name}
          aria-expanded={menu === "account"}
          onClick={() => setMenu(menu === "account" ? null : "account")}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          {initials(name)}
        </button>
        {trailing}
        {menu && (
          <div
            ref={panel}
            className="absolute right-3 top-[54px] w-56 rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800 shadow-xl md:left-[116px] md:right-auto"
          >
            {menu === "create" ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-slate-100 focus-visible:bg-slate-100"
                onClick={() => {
                  setMenu(null);
                  setCreating(true);
                }}
              >
                {NAV_ICONS["/projects"]}Create Project
              </button>
            ) : (
              <>
                <div className="border-b border-slate-100 px-3 py-2">
                  <p className="truncate font-semibold">{name}</p>
                  <p className="mt-1 text-xs capitalize text-slate-500">
                    {role}
                  </p>
                </div>
                <Link
                  href={`/employees/${userId}`}
                  className="mt-1 flex items-center gap-2 rounded px-3 py-2 hover:bg-slate-100 focus-visible:bg-slate-100"
                  onClick={() => {
                    setMenu(null);
                    onNavigate?.();
                  }}
                >
                  {NAV_ICONS["/photos"]}My Photos
                </Link>
                <SignOutButton className="w-full justify-start rounded px-3 py-2 text-slate-800 hover:bg-slate-100" />
              </>
            )}
          </div>
        )}
      </div>
      {creating && (
        <CreateWorkspaceProject
          initiallyOpen
          onClosed={() => {
            setCreating(false);
            createButton.current?.focus();
          }}
        />
      )}
    </>
  );
}

export function MobileNav({
  name,
  role,
  userId,
}: {
  name: string;
  role: string;
  userId: string;
}) {
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
      const activeDialog = (event.target as HTMLElement).closest(
        '[role="dialog"],dialog',
      );
      const drawer = document.getElementById("mobile-navigation-drawer");
      if (activeDialog && activeDialog !== drawer) return;
      if (event.key === "Tab") {
        const controls = Array.from(
          drawer?.querySelectorAll<HTMLElement>(
            "a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled)",
          ) ?? [],
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
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
            {SITE_INITIALS}
          </span>
          <span className="truncate text-sm font-semibold text-[var(--color-heading)]">
            {SITE_NAME}
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
            <div className="flex min-h-0 flex-1 flex-col pb-2">
              <SidebarHeader
                name={name}
                role={role}
                userId={userId}
                onNavigate={() => setOpen(false)}
                trailing={
                  <button
                    ref={closeButtonRef}
                    type="button"
                    aria-label="Close navigation"
                    onClick={() => {
                      setOpen(false);
                      menuButtonRef.current?.focus();
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded text-2xl text-slate-300 hover:text-white"
                  >
                    ×
                  </button>
                }
              />
              <Nav onNavigate={() => setOpen(false)} />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
