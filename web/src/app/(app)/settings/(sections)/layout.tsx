import { PageHeader } from "@/components/kpi";
import { SettingsNav } from "@/components/settings/settings-nav";
import { requireStaff } from "@/lib/auth";
import { loadCompanySettings } from "@/lib/settings-data";

export const dynamic = "force-dynamic";

/** The frame around every Settings page: the title and the list of pages. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const [settings] = await Promise.all([loadCompanySettings(), requireStaff()]);
  return (
    <>
      <PageHeader title="Settings" subtitle={settings.company.name} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav />
        <div className="min-w-0 max-w-3xl space-y-4">{children}</div>
      </div>
    </>
  );
}
