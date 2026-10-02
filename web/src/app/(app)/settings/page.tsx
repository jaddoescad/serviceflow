import { requireStaff } from "@/lib/auth";
import { getCompanySettings, getLabourBudgetSettings } from "@/lib/actions/settings";
import { LabourBudgetSettingsForm } from "@/components/labour-budget-settings";
import { CompanyProfileForm } from "@/components/settings/company-profile-form";
import { SettingsNav } from "@/components/settings/settings-nav";
import {
  AccountSection,
  IntegrationsSection,
  TeamSection,
} from "@/components/settings/settings-overview";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [profile, company, labour] = await Promise.all([
    requireStaff(),
    getCompanySettings(),
    getLabourBudgetSettings(),
  ]);

  return (
    <section className="workspace-page">
      <header>
        <h1 className="text-4xl font-extrabold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {company.company.name} · company details, labour budgets, team and integrations.
        </p>
      </header>
      <div className="mt-8 grid gap-8 lg:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <SettingsNav />
        </aside>
        <div className="max-w-3xl space-y-6">
          <CompanyProfileForm company={company.company} canEdit={company.canEdit} />
          <LabourBudgetSettingsForm settings={labour} />
          <TeamSection team={company.team} />
          <IntegrationsSection integrations={company.integrations} />
          <AccountSection profile={profile} role={company.myRole} companySince={company.company.createdAt} />
        </div>
      </div>
    </section>
  );
}
