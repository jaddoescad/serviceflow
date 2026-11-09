"use client";

import { useEffect, useState } from "react";
import { documentAssetUrl } from "@/lib/document-assets";
import type { CompanyLinks, SocialLink } from "@/lib/proposal-types";
import { cn } from "./ui";

// The frame every customer page shares: a white top bar with the company and
// its phone number, and a sidebar (a drawer on phones) with the logo, the
// customer's sections, the company's own links and its social pages. The
// company's colour (Settings › Branding) drives every accent. The portal
// (/portal) and the document pages (/p, /co, /i) both use it.

export type ShellCompany = {
  name: string;
  phone: string | null;
  logoPath: string | null;
  brandColor: string | null;
};

export type ShellNavIcon = keyof typeof NAV_ICONS;

export type ShellNavItem = {
  key: string;
  label: string;
  icon: ShellNavIcon;
  active: boolean;
  /** A link to another page, or… */
  href?: string;
  /** …a view of this page. Neither: shown, but not clickable (staff previews). */
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
const GLOBE = "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20";
const STAR = "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1Z";
const EXTERNAL = "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5";

/** Each social page's mark; `line` ones are drawn with a stroke, the rest filled. */
const SOCIAL: Record<SocialLink, { name: string; d: string; line?: boolean }> = {
  facebook: {
    name: "Facebook",
    d: "M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.3c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.4H7.5V14h2.7v8Z",
  },
  instagram: {
    name: "Instagram",
    line: true,
    d: "M7.5 3h9A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 16.5v-9A4.5 4.5 0 0 1 7.5 3ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM17.3 6.7h.01",
  },
  linkedin: {
    name: "LinkedIn",
    d: "M5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM3.3 9.2h3.4V21H3.3ZM9 9.2h3.2v1.6h.1c.5-.9 1.6-1.9 3.3-1.9 3.5 0 4.2 2.3 4.2 5.3V21h-3.4v-6c0-1.4 0-3.2-2-3.2s-2.2 1.5-2.2 3.1V21H9Z",
  },
  x: {
    name: "X",
    d: "M17.8 3h3L14 10.7 22 21h-6.2l-4.8-6.3L5.5 21h-3l7.2-8.2L2 3h6.3l4.4 5.8ZM16.7 19.2h1.7L7.4 4.7H5.6Z",
  },
};

function Glyph({ d, className, filled }: { d: string; className?: string; filled?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
    >
      <path d={d} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}

/** A section's icon, the same one its sidebar entry shows. */
export function NavIcon({ icon, className }: { icon: ShellNavIcon; className?: string }) {
  return <Glyph d={NAV_ICONS[icon]} className={className} />;
}

/** Used until the company picks its colour in Settings › Branding. */
const DEFAULT_ACCENT = "#1e3a5f";

/**
 * The company's colour as the page's accents: the colour itself for fills,
 * a readable ink to set on it, a text shade that stays legible on white, and
 * a faint tint for backgrounds.
 */
function accentStyle(color: string | null): React.CSSProperties {
  const accent = color && /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_ACCENT;
  const [red, green, blue] = [1, 3, 5].map((at) => parseInt(accent.slice(at, at + 2), 16));
  const light = (red * 299 + green * 587 + blue * 114) / 1000 > 160;
  return {
    "--brand-accent": accent,
    "--brand-ink": light ? "#111113" : "#ffffff",
    "--brand-text": light ? `color-mix(in srgb, ${accent} 50%, #111113)` : accent,
    "--brand-tint": `color-mix(in srgb, ${accent} 8%, white)`,
    "--color-brand": accent,
    "--page-bg": "#f5f6f8",
  } as React.CSSProperties;
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
      className={cn("flex items-center justify-center font-bold text-[var(--brand-text)]", className)}
    >
      {initials(company.name)}
    </span>
  );
}

/** The small heading over a group of sidebar entries. */
export const SIDEBAR_GROUP_LABEL = "px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]";
const ITEM =
  "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] font-medium leading-5 outline-none transition-colors focus-visible:shadow-[var(--focus-ring)]";

export function CustomerShell({
  company,
  callLabel,
  menuLabel,
  nav,
  links,
  linkLabels,
  sidebarExtra,
  wide = false,
  className,
  mainClassName,
  children,
}: {
  company: ShellCompany;
  callLabel: string;
  menuLabel: string;
  nav: ShellNavItem[];
  /** The company's website, review page and social pages (Settings). */
  links: CompanyLinks;
  linkLabels: { website: string; reviews: string; followUs: string };
  /** Under the nav: the document's files and the company's insurance. */
  sidebarExtra?: React.ReactNode;
  /** Room beside the 720px column for a second one (a proposal's price card). */
  wide?: boolean;
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

  /** Horizontal gutters and width shared by the top bar and the page, so both line up. */
  const gutter = "px-4 sm:px-6 lg:pl-[288px]";
  const column = cn("mx-auto w-full max-w-[720px]", wide && "xl:max-w-[1048px]");
  const external = [
    links.website ? { key: "website", label: linkLabels.website, href: links.website, d: GLOBE } : null,
    links.reviews ? { key: "reviews", label: linkLabels.reviews, href: links.reviews, d: STAR } : null,
  ].filter((entry) => entry != null);

  return (
    <div style={accentStyle(company.brandColor)} className={cn("min-h-screen bg-[var(--page-bg)]", className)}>
      <header className="fixed inset-x-0 top-0 z-30 h-16 border-b border-[var(--color-border)] bg-white print:hidden">
        <div className={cn("flex h-full", gutter)}>
          <div className={cn("flex items-center gap-2", column)}>
            <button
              type="button"
              aria-label={menuLabel}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-heading)] outline-none hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)] lg:hidden"
            >
              <Glyph d="M4 6h16M4 12h16M4 18h16" className="h-5 w-5" />
            </button>
            <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-[var(--color-heading)]">
              {company.name}
            </span>
            {company.phone ? (
              <a
                href={`tel:${company.phone}`}
                aria-label={`${callLabel} ${company.phone}`}
                className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-[var(--color-border-strong)] px-3.5 text-[13px] font-semibold text-[var(--color-heading)] outline-none hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)]"
              >
                <Glyph d={PHONE} className="h-3.5 w-3.5 text-[var(--brand-text)]" />
                <span className="hidden sm:inline">{company.phone}</span>
                <span className="sm:hidden">{callLabel}</span>
              </a>
            ) : null}
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div aria-hidden="true" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 bg-black/30 lg:hidden" />
      ) : null}
      <aside
        className={cn(
          "fixed bottom-0 left-0 w-[264px] flex-col overflow-y-auto border-r border-[var(--color-border)] bg-white px-3 py-6 print:hidden",
          menuOpen ? "top-0 z-50 flex shadow-xl lg:top-16 lg:z-20 lg:shadow-none" : "top-16 z-20 hidden lg:flex",
        )}
      >
        <div className="mb-6 px-3">
          {company.logoPath ? (
            <CompanyLogo company={company} className="h-20 w-auto max-w-full object-left" />
          ) : (
            <CompanyLogo company={company} className="h-14 w-14 rounded-2xl bg-[var(--brand-tint)] text-lg" />
          )}
        </div>
        <nav className="space-y-0.5">
          {nav.map((entry) => {
            const classes = cn(
              ITEM,
              entry.active
                ? "bg-[var(--brand-tint)] font-semibold text-[var(--brand-text)]"
                : "text-[var(--color-text)]",
              !entry.active && (entry.href || entry.onSelect) && "hover:bg-[var(--color-hover)]",
            );
            const content = (
              <>
                <NavIcon icon={entry.icon} className={entry.active ? undefined : "text-[var(--color-muted)]"} />
                <span className="min-w-0">{entry.label}</span>
              </>
            );
            if (entry.href) {
              return (
                <a key={entry.key} href={entry.href} aria-current={entry.active ? "page" : undefined} className={classes}>
                  {content}
                </a>
              );
            }
            if (!entry.onSelect) {
              return (
                <div key={entry.key} aria-current={entry.active ? "page" : undefined} className={classes}>
                  {content}
                </div>
              );
            }
            return (
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
        {sidebarExtra ? <div className="mt-6 space-y-5">{sidebarExtra}</div> : null}
        {external.length ? (
          <div className="mt-6">
            <div className={cn(SIDEBAR_GROUP_LABEL, "mb-1.5")}>{company.name}</div>
            {external.map((entry) => (
              <a
                key={entry.key}
                href={entry.href}
                target="_blank"
                rel="noreferrer"
                className={cn(ITEM, "text-[var(--color-text)] hover:bg-[var(--color-hover)]")}
              >
                <Glyph d={entry.d} className="text-[var(--color-muted)]" />
                <span className="min-w-0 flex-1">{entry.label}</span>
                <Glyph d={EXTERNAL} className="h-3.5 w-3.5 text-[var(--color-faint)]" />
              </a>
            ))}
          </div>
        ) : null}
        {links.social.length ? (
          <div className="mt-auto pt-6">
            <div className={cn(SIDEBAR_GROUP_LABEL, "mb-2")}>{linkLabels.followUs}</div>
            <div className="flex flex-wrap gap-1.5 px-3">
              {links.social.map(({ key, href }) => (
                <a
                  key={key}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={SOCIAL[key].name}
                  title={SOCIAL[key].name}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--page-bg)] text-[var(--color-muted)] outline-none transition-colors hover:bg-[var(--brand-tint)] hover:text-[var(--brand-text)] focus-visible:shadow-[var(--focus-ring)]"
                >
                  <Glyph d={SOCIAL[key].d} filled={!SOCIAL[key].line} />
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </aside>

      <main className={cn("pb-16 pt-16", gutter, mainClassName)}>
        <div className={cn("space-y-4", column)}>{children}</div>
      </main>
    </div>
  );
}
