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
import { ReportPending, usePendingHref } from "@/components/navigation-pending";
import { ProjectSearch } from "@/components/project-search";
import { SignOutButton } from "@/components/sign-out";
import { NotificationBell } from "@/components/notification-bell";
import { cn } from "@/components/ui";
import { useUnreadInbox } from "@/components/unread-inbox";
import { initials } from "@/lib/format";

type NavLink = { href: string; label: string };

const TRASH_HREF = "/projects?view=trash";

// Grouped like DripJobs. The first group has no heading; Resources collapses.
const GROUPS: { title?: string; links: NavLink[] }[] = [
  {
    links: [
      { href: "/", label: "Today" },
      { href: "/inbox", label: "Inbox" },
    ],
  },
  {
    title: "Sales",
    links: [
      { href: "/contacts", label: "Customers" },
      { href: "/pipeline/sales", label: "Sales Pipeline" },
      { href: "/appointments", label: "Appointments" },
      { href: "/proposals", label: "Proposals" },
    ],
  },
  {
    title: "Jobs",
    links: [
      { href: "/pipeline/jobs", label: "Jobs Pipeline" },
      { href: "/schedule", label: "Job Schedule" },
      { href: "/projects", label: "Projects" },
      { href: "/change-orders", label: "Change Orders" },
      { href: "/work-orders", label: "Work Orders" },
      { href: "/jobs", label: "Labour" },
    ],
  },
  {
    title: "Daily Operations",
    links: [
      { href: "/photos", label: "Photos" },
      { href: "/employees", label: "Team" },
    ],
  },
  {
    title: "Financials",
    links: [
      { href: "/invoices", label: "Invoices" },
      { href: "/job-costing", label: "Job Costing" },
      { href: "/metrics", label: "Metrics" },
      { href: "/reports", label: "Reports" },
    ],
  },
  { title: "Marketing", links: [{ href: "/drips", label: "Drips" }] },
  { title: "Company", links: [{ href: "/settings", label: "Settings" }] },
  {
    title: "Resources",
    links: [
      { href: "/labels", label: "Labels" },
      { href: TRASH_HREF, label: "Project Trash" },
    ],
  },
];

const within = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

/** Which link owns the current page. A job's pages (/jobs/[id]/…) belong to
 * Projects; /jobs alone is the Labour list. */
function isActive(href: string, pathname: string, trash: boolean): boolean {
  switch (href) {
    case TRASH_HREF:
      return pathname === "/projects" && trash;
    case "/projects":
      return (
        !trash &&
        (within(pathname, "/projects") ||
          (pathname.startsWith("/jobs/") &&
            !/^\/jobs\/[^/]+\/(proposals|invoices|change-orders)(\/|$)/.test(pathname)))
      );
    case "/invoices":
      return within(pathname, href) || /^\/jobs\/[^/]+\/invoices(\/|$)/.test(pathname);
    case "/change-orders":
      return within(pathname, href) || /^\/jobs\/[^/]+\/change-orders(\/|$)/.test(pathname);
    case "/jobs":
    case "/":
      return pathname === href;
    case "/pipeline/sales":
      return within(pathname, href) || within(pathname, "/deals");
    case "/proposals":
      return within(pathname, href) || /^\/jobs\/[^/]+\/proposals(\/|$)/.test(pathname);
    default:
      return within(pathname, href);
  }
}

export function Nav({ onNavigate }: { onNavigate?: () => void } = {}) {
  const unreadInbox = useUnreadInbox();
  // A clicked item shows as selected while its page loads.
  const pending = usePendingHref();
  const currentPath = usePathname();
  const currentTrash = useSearchParams().get("view") === "trash";
  const pathname = pending?.split("?")[0] ?? currentPath;
  const trash = pending ? pending.includes("view=trash") : currentTrash;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ProjectSearch onNavigate={onNavigate} />

      <nav
        aria-label="Main navigation"
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-20 pt-2"
      >
        {GROUPS.map((group) => {
          const closed = group.title ? collapsed[group.title] : false;
          return (
            <div key={group.title ?? "home"} className={group.title ? "mt-3" : undefined}>
              {group.title ? (
                <button
                  type="button"
                  aria-expanded={!closed}
                  onClick={() =>
                    setCollapsed((current) => ({ ...current, [group.title!]: !closed }))
                  }
                  className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-[11px] font-medium text-[var(--color-faint)] outline-none hover:text-[var(--color-muted)] focus-visible:shadow-[var(--focus-ring)]"
                >
                  {group.title}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={cn("h-3 w-3 transition-transform", closed && "-rotate-90")}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              ) : null}
              {closed ? null : (
                <div className="flex flex-col gap-px">
                  {group.links.map((link) => {
                    const active = isActive(link.href, pathname, trash);
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        onClick={onNavigate}
                        className={cn(
                          "flex h-8 items-center gap-2 rounded-md px-2 text-[13px] outline-none transition-colors focus-visible:shadow-[var(--focus-ring)]",
                          active
                            ? "bg-[var(--sidebar-active)] font-medium text-[var(--color-heading)]"
                            : "text-[var(--sidebar-text)] hover:bg-[var(--sidebar-surface)]",
                        )}
                      >
                        <span className={active ? "text-[var(--color-heading)]" : "text-[var(--sidebar-muted)]"}>
                          {NAV_ICONS[link.href]}
                        </span>
                        <span className="truncate">{link.label}</span>
                        <ReportPending href={link.href} />
                        {link.href === "/inbox" && unreadInbox > 0 ? (
                          <span className="ml-auto rounded-full bg-[var(--color-brand)] px-1.5 text-[11px] font-semibold leading-[18px] text-white tabular-nums">
                            {unreadInbox > 99 ? "99+" : unreadInbox}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
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
  const menuItem =
    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-[var(--color-text)] outline-none hover:bg-[var(--color-hover)] focus-visible:bg-[var(--color-hover)]";
  const iconButton =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-muted)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]";
  return (
    <>
      <div
        ref={root}
        className="relative z-40 flex h-14 shrink-0 items-center gap-1 px-3"
      >
        <Link
          href="/projects"
          onClick={onNavigate}
          className="mr-auto flex min-w-0 items-center gap-2 rounded-md px-1 py-1 outline-none hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)]"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-[var(--color-primary)] text-[9px] font-bold text-[var(--color-primary-ink)]">
            {SITE_INITIALS}
          </span>
          <span className="truncate text-[13px] font-semibold text-[var(--color-heading)]">
            {SITE_NAME}
          </span>
        </Link>
        <NotificationBell userId={userId} />
        {["admin", "manager"].includes(role) && (
          <button
            ref={createButton}
            type="button"
            aria-label="Create"
            title="Create"
            aria-expanded={menu === "create"}
            onClick={() => setMenu(menu === "create" ? null : "create")}
            className={iconButton}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-4 w-4"
            >
              <path d="M12 5v14M5 12h14" />
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
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--tag-gray-bg)] text-[10px] font-semibold text-[var(--tag-gray-text)] outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          {initials(name)}
        </button>
        {trailing}
        {menu && (
          <div
            ref={panel}
            className="absolute right-3 top-12 w-56 rounded-[var(--radius)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-pop)] md:left-3 md:right-auto"
          >
            {menu === "create" ? (
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  setMenu(null);
                  setCreating(true);
                }}
              >
                <span className="text-[var(--color-muted)]">{NAV_ICONS["/projects"]}</span>
                Create Project
              </button>
            ) : (
              <>
                <div className="mb-1 border-b border-[var(--color-border)] px-2 pb-2 pt-1.5">
                  <p className="truncate text-[13px] font-semibold text-[var(--color-heading)]">{name}</p>
                  <p className="text-xs capitalize text-[var(--color-muted)]">{role}</p>
                </div>
                <Link
                  href={`/employees/${userId}`}
                  className={menuItem}
                  onClick={() => {
                    setMenu(null);
                    onNavigate?.();
                  }}
                >
                  <span className="text-[var(--color-muted)]">{NAV_ICONS["/photos"]}</span>
                  My Photos
                </Link>
                <SignOutButton className="w-full justify-start px-2 text-[13px] text-[var(--color-text)]" />
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
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 md:hidden print:hidden">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)] text-[10px] font-bold text-[var(--color-primary-ink)]">
            {SITE_INITIALS}
          </span>
          <span className="truncate text-[13px] font-semibold text-[var(--color-heading)]">
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
          className="-mr-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-[var(--color-heading)] hover:bg-[var(--color-hover)]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            className="h-5 w-5"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/30"
          />
          <section
            id="mobile-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="absolute inset-y-0 right-0 flex w-[min(88vw,20rem)] flex-col border-l border-[var(--color-border)] bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] shadow-[var(--shadow-pop)]"
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
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)]"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      className="h-4 w-4"
                    >
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
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
