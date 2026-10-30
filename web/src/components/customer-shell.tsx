"use client";

import { useEffect, useState } from "react";
import { documentAssetUrl } from "@/lib/document-assets";
import { cn } from "./ui";

// The frame every customer page shares, after DripJobs' customer portal: a
// white top bar with the company and phone, a sidebar with the logo and the
// portal's sections (a drawer on phones), and a gray page with a 720px column.
// The portal (/portal) and the document pages (/p, /co, /i) both use it.

export type ShellCompany = {
  name: string;
  phone: string | null;
  logoPath: string | null;
  brandColor: string | null;
};

export type ShellLanguage = "en" | "fr";

export type ShellNavIcon = keyof typeof NAV_ICONS;

export type ShellNavItem = {
  key: string;
  label: string;
  icon: ShellNavIcon;
  active: boolean;
  /** A link to another page, or… */
  href?: string;
  /** …a view of this page. */
  onSelect?: () => void;
};

const NAV_ICONS = {
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h5",
  swap: "M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16",
  receipt: "M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2ZM8 8h8M8 12h8M8 16h5",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  calendarPlus:
    "M8 2v4M16 2v4M3 10h18M12 14v4M10 16h4M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM22 6l-10 7L2 6",
} as const;

const PHONE =
  "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z";

function Glyph({ d, className }: { d: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
    >
      <path d={d} />
    </svg>
  );
}

/** A section's icon, the same one its sidebar entry shows. */
export function NavIcon({ icon, className }: { icon: ShellNavIcon; className?: string }) {
  return <Glyph d={NAV_ICONS[icon]} className={className} />;
}

/** The company's colour drives the icons and accents; navy when it has none. */
function accentStyle(color: string | null): React.CSSProperties {
  const accent = color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#1e3a5f";
  return { "--brand-accent": accent, "--color-brand": accent } as React.CSSProperties;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

/** The company's logo, or its initials on a tile when it has none. */
export function CompanyLogo({ company, className }: { company: ShellCompany; className?: string }) {
  return company.logoPath ? (
    <img src={documentAssetUrl(company.logoPath)} alt={company.name} className={cn("object-contain", className)} />
  ) : (
    <span
      aria-label={company.name}
      className={cn("flex items-center justify-center font-bold text-[var(--brand-accent)]", className)}
    >
      {initials(company.name)}
    </span>
  );
}

/** Horizontal gutters shared by the top bar and the page, so both line up with the 720px column. */
const COLUMN_GUTTER = "px-4 sm:px-6 lg:pl-[288px]";

export function CustomerShell({
  company,
  language,
  languageLabel,
  onLanguage,
  callLabel,
  menuLabel,
  nav,
  sidebarExtra,
  className,
  mainClassName,
  children,
}: {
  company: ShellCompany;
  language: ShellLanguage;
  languageLabel: string;
  onLanguage: (language: ShellLanguage) => void;
  callLabel: string;
  menuLabel: string;
  nav: ShellNavItem[];
  /** Under the nav: the document's files and the company's insurance. */
  sidebarExtra?: React.ReactNode;
  className?: string;
  mainClassName?: string;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);

  const item =
    "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] font-medium leading-5 outline-none transition-colors focus-visible:shadow-[var(--focus-ring)]";

  return (
    <div style={accentStyle(company.brandColor)} className={cn("min-h-screen bg-[#f3f4f6]", className)}>
      <header className="fixed inset-x-0 top-0 z-30 h-16 border-b border-[var(--color-border)] bg-white print:hidden">
        <div className={cn("flex h-full", COLUMN_GUTTER)}>
          <div className="mx-auto flex w-full max-w-[720px] items-center gap-2">
            <button
              type="button"
              aria-label={menuLabel}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-heading)] outline-none hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)] lg:hidden"
            >
              <Glyph d="M4 6h16M4 12h16M4 18h16" className="h-5 w-5" />
            </button>
            <span className="min-w-0 flex-1 truncate text-[17px] font-semibold text-[var(--brand-accent)]">
              {company.name}
            </span>
            {company.phone ? (
              <a
                href={`tel:${company.phone}`}
                aria-label={`${callLabel} ${company.phone}`}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[var(--color-text)] outline-none hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)]"
              >
                <Glyph d={PHONE} className="h-3.5 w-3.5 text-[var(--brand-accent)]" />
                <span className="hidden sm:inline">{company.phone}</span>
              </a>
            ) : null}
            <div role="group" aria-label={languageLabel} className="flex shrink-0 rounded-lg bg-[#f1f5f9] p-0.5">
              {(["en", "fr"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  lang={option}
                  aria-pressed={language === option}
                  onClick={() => option !== language && onLanguage(option)}
                  className={cn(
                    "h-7 rounded-md px-2.5 text-xs font-semibold uppercase outline-none focus-visible:shadow-[var(--focus-ring)]",
                    language === option
                      ? "bg-white text-[var(--color-heading)] shadow-[var(--shadow-pop-lite)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-heading)]",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div aria-hidden="true" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 bg-black/30 lg:hidden" />
      ) : null}
      <aside
        className={cn(
          "fixed bottom-0 left-0 w-[264px] overflow-y-auto border-r border-[var(--color-border)] bg-white px-4 py-6 print:hidden",
          menuOpen ? "top-0 z-50 shadow-xl lg:top-16 lg:z-20 lg:shadow-none" : "top-16 z-20 hidden lg:block",
        )}
      >
        <div className="mb-6 flex justify-center">
          {company.logoPath ? (
            <CompanyLogo company={company} className="h-16 w-auto max-w-[176px]" />
          ) : (
            <CompanyLogo company={company} className="h-14 w-14 rounded-2xl bg-[#f1f5f9] text-lg" />
          )}
        </div>
        <nav className="space-y-1">
          {nav.map((entry) => {
            const classes = cn(
              item,
              entry.active
                ? "bg-[var(--brand-accent)] text-white"
                : "text-[var(--color-text)] hover:bg-[var(--color-hover)]",
            );
            const content = (
              <>
                <NavIcon icon={entry.icon} className={entry.active ? undefined : "text-[var(--color-muted)]"} />
                <span className="min-w-0">{entry.label}</span>
              </>
            );
            return entry.href ? (
              <a key={entry.key} href={entry.href} aria-current={entry.active ? "page" : undefined} className={classes}>
                {content}
              </a>
            ) : (
              <button
                key={entry.key}
                type="button"
                aria-current={entry.active ? "page" : undefined}
                onClick={() => {
                  setMenuOpen(false);
                  entry.onSelect?.();
                }}
                className={classes}
              >
                {content}
              </button>
            );
          })}
        </nav>
        {sidebarExtra ? <div className="mt-6 border-t border-[var(--color-border)] pt-4">{sidebarExtra}</div> : null}
      </aside>

      <main className={cn("pb-12 pt-16", COLUMN_GUTTER, mainClassName)}>
        <div className="mx-auto max-w-[720px] space-y-4">{children}</div>
      </main>
    </div>
  );
}
