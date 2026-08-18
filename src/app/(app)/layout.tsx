import { requireStaff } from "@/lib/auth";
import { MobileNav, Nav, SidebarAccount } from "@/components/nav";
import { SignOutButton } from "@/components/sign-out";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireStaff();
  const name = profile.full_name ?? profile.email ?? "Staff";
  const supabase = await createClient();
  const { data: appConfig } = await supabase
    .from("app_config")
    .select("maintenance_mode")
    .eq("id", "default")
    .maybeSingle();

  if (appConfig?.maintenance_mode) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-6">
        <div className="max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-sm">
          <div className="font-display text-2xl font-bold text-[var(--color-heading)]">Database upgrade in progress</div>
          <p className="mt-3 text-sm text-[var(--color-muted)]">Ottawa Painters is temporarily read-only while the V2 data migration is verified. Please try again shortly.</p>
          <div className="mt-5"><SignOutButton /></div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside
        data-sidebar
        className="sticky top-0 hidden h-svh w-[17rem] shrink-0 flex-col bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] md:flex"
      >
        <div className="mb-5 flex h-[84px] shrink-0 items-center gap-3 px-5">
          <span className="font-display inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#2979ff] text-sm font-bold text-white shadow-[0_8px_24px_rgba(41,121,255,0.3)]">
            OP
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-[var(--sidebar-text)]">Ottawa Painters</div>
            <div className="mt-0.5 text-[11px] text-[var(--sidebar-muted)]">Admin dashboard</div>
          </div>
        </div>
        <Nav />
        <SidebarAccount name={name} role={profile.role} />
      </aside>
      <main className="flex min-h-screen min-w-0 flex-1 flex-col bg-[var(--color-bg)]">
        <MobileNav name={name} role={profile.role} />
        <div className="app-content mx-auto w-full max-w-[1800px] flex-1 px-4 py-5 lg:px-6 lg:py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
