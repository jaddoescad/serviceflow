import { requireStaff } from "@/lib/auth";
import { MobileNav, Nav } from "@/components/nav";
import { SignOutButton } from "@/components/sign-out";
import { Avatar, Badge } from "@/components/ui";
import { initials } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireStaff();
  const name = profile.full_name ?? profile.email ?? "Staff";

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] py-5 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-5">
          <span className="font-display inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-brand)] text-sm font-bold text-[var(--color-brand-ink)]">
            OP
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-[var(--color-heading)]">Ottawa Painters</div>
            <div className="text-[11px] text-[var(--color-muted)]">Admin dashboard</div>
          </div>
        </div>
        <Nav />
        <div className="mt-auto border-t border-[var(--color-border)] px-4 pt-4">
          <div className="flex items-center gap-2.5">
            <Avatar label={initials(name)} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-xs font-medium">{name}</div>
              <Badge tone={profile.role === "admin" ? "brand" : "neutral"}>{profile.role}</Badge>
            </div>
          </div>
          <div className="mt-3">
            <SignOutButton />
          </div>
        </div>
      </aside>
      <main className="flex min-h-screen min-w-0 flex-1 flex-col bg-[var(--color-bg)]">
        <MobileNav />
        <div className="app-content mx-auto w-full max-w-[1800px] flex-1 px-4 py-5 lg:px-6 lg:py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
