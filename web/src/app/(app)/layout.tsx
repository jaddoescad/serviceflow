import { SITE_NAME } from "@/lib/site-brand";
import { requireMember } from "@/lib/auth";
import { MobileNav, Nav, SidebarHeader } from "@/components/nav";
import { SignOutButton } from "@/components/sign-out";
import { ProjectUploadProvider } from "@/components/project-upload-provider";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, { data: appConfig }] = await Promise.all([
    requireMember(),
    createClient().then((supabase) =>
      supabase
        .from("app_config")
        .select("maintenance_mode")
        .eq("id", "default")
        .maybeSingle(),
    ),
  ]);
  const name = profile.full_name ?? profile.email ?? "Staff";

  if (appConfig?.maintenance_mode) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-6">
        <div className="max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-sm">
          <div className="font-display text-2xl font-bold text-[var(--color-heading)]">
            Database upgrade in progress
          </div>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            {SITE_NAME} is temporarily read-only while the V2 data migration is
            verified. Please try again shortly.
          </p>
          <div className="mt-5">
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  return (
    <ProjectUploadProvider>
      <div className="flex min-h-screen">
        <aside
          data-sidebar
          className="sticky top-0 hidden h-svh w-[230px] shrink-0 flex-col bg-[var(--sidebar-bg)] text-[var(--sidebar-text)] md:flex"
        >
          <SidebarHeader
            name={name}
            role={profile.role}
            userId={profile.user_id}
          />
          <Nav />
        </aside>
        <main className="flex min-h-screen min-w-0 flex-1 flex-col bg-[var(--color-bg)]">
          <MobileNav name={name} role={profile.role} userId={profile.user_id} />
          <div className="app-content mx-auto w-full max-w-none flex-1 px-4 py-5 lg:px-6 lg:py-6">
            {children}
          </div>
        </main>
      </div>
    </ProjectUploadProvider>
  );
}
