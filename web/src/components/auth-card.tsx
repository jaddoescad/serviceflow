import { SITE_INITIALS, SITE_NAME } from "@/lib/site-brand";
import { Card } from "@/components/ui";

/** The sign-in and sign-up panel: logo, title, one line of context. */
export function AuthCard({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <Card className="w-full max-w-sm p-6">
      <div className="mb-6">
        <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-brand)] text-lg font-bold text-[var(--color-brand-ink)]">
          {SITE_INITIALS}
        </div>
        <h1 className="text-lg font-semibold">{SITE_NAME}</h1>
        <p className="text-sm text-[var(--color-muted)]">{subtitle}</p>
      </div>
      {children}
    </Card>
  );
}
