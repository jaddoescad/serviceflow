import { cookies } from "next/headers";
import { SITE_NAME } from "@/lib/site-brand";
import { requireMember } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import { MobileNav, Nav, SidebarHeader } from "@/components/nav";
import { NavigationPendingProvider, PendingPage } from "@/components/navigation-pending";
import { NewLeadToast } from "@/components/new-lead-toast";
import { SignOutButton } from "@/components/sign-out";
import { ProjectUploadProvider } from "@/components/project-upload-provider";
import { UnreadInboxProvider } from "@/components/unread-inbox";
import { getUnreadConversationCount } from "@/lib/inbox";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, { data: appConfig }, unreadInbox, cookieStore] = await Promise.all([
    requireMember(),
    createClient().then((supabase) =>
      supabase
        .from("app_config")
        .select("maintenance_mode")
        .eq("id", "default")
        .maybeSingle(),
    ),
    getUnreadConversationCount(),
    cookies(),
  ]);
  const name = profile.full_name ?? profile.email ?? "Staff";
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1";

  if (appConfig?.maintenance_mode) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-6">
        <div className="max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
          <div className="text-base font-semibold text-[var(--color-heading)]">
            Database upgrade in progress
          </div>
          <p className="mt-2 text-[13px] text-[var(--color-muted)]">
            {SITE_NAME} is temporarily read-only while the V2 data migration is
            verified. Please try again shortly.
          </p>
          <div className="mt-4">
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  return (
    <ProjectUploadProvider>
      <UnreadInboxProvider initial={unreadInbox}>
        <NavigationPendingProvider>
          <div className="flex min-h-screen">
            <AppSidebar initialCollapsed={sidebarCollapsed}>
              <SidebarHeader
                name={name}
                role={profile.role}
                userId={profile.user_id}
              />
              <Nav />
            </AppSidebar>
            <main className="flex min-h-screen min-w-0 flex-1 flex-col bg-[var(--color-surface)]">
              <MobileNav name={name} role={profile.role} userId={profile.user_id} />
              <div className="app-content relative min-w-0 flex-1">
                {children}
                <PendingPage />
              </div>
            </main>
          </div>
          <NewLeadToast />
        </NavigationPendingProvider>
      </UnreadInboxProvider>
    </ProjectUploadProvider>
  );
}
