import Link from "next/link";
import { SITE_INITIALS, SITE_NAME } from "@/lib/site-brand";
import { buttonClassName } from "@/components/ui";

/** Where people can reach ServiceFlow about the site, their data or these pages. */
export const CONTACT_EMAIL = "jadslimm@gmail.com";

/** The signed-out pages (home, privacy, terms): logo, sign in, and the legal links. */
export function PublicPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-[var(--color-heading)]">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-brand)] text-xs font-bold text-[var(--color-brand-ink)]">
              {SITE_INITIALS}
            </span>
            {SITE_NAME}
          </Link>
          <Link href="/login" className={buttonClassName({ variant: "secondary" })}>
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>
      <footer className="border-t border-[var(--color-border)]">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-5 text-[13px] text-[var(--color-muted)]">
          <span>© {new Date().getFullYear()} {SITE_NAME}</span>
          <Link href="/privacy" className="hover:text-[var(--color-heading)]">Privacy policy</Link>
          <Link href="/terms" className="hover:text-[var(--color-heading)]">Terms of service</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-[var(--color-heading)]">{CONTACT_EMAIL}</a>
        </div>
      </footer>
    </div>
  );
}

/** Headings and paragraphs for the privacy policy and terms. */
export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-base font-semibold text-[var(--color-heading)]">{title}</h2>
      <div className="space-y-3 text-[14px] leading-relaxed [&_a]:text-[var(--color-brand-strong)] [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
