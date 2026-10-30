import { requireStaff } from "@/lib/auth";
import { getPaymentSettings } from "@/lib/actions/billing";
import { getMyCalendarConnection } from "@/lib/actions/calendar";
import { getCrewSettings } from "@/lib/actions/crews";
import { getLeadIntakeSettings } from "@/lib/actions/lead-intake";
import { getMessagingSettings, getReviewSettings } from "@/lib/actions/messaging";
import {
  getCompanyDocuments,
  getCompanySettings,
  getLabourBudgetSettings,
} from "@/lib/actions/settings";
import { PageHeader } from "@/components/kpi";
import { LabourBudgetSettingsForm } from "@/components/labour-budget-settings";
import { BrandingForm } from "@/components/settings/branding-form";
import { CompanyDocuments } from "@/components/settings/company-documents";
import { CompanyProfileForm } from "@/components/settings/company-profile-form";
import { CrewsSettings } from "@/components/settings/crews-settings";
import { GoogleCalendarSection } from "@/components/settings/google-calendar-section";
import { LeadIntakeSettings } from "@/components/settings/lead-intake-settings";
import { MessagingSettingsForm } from "@/components/settings/messaging-settings-form";
import { PaymentsSettings } from "@/components/settings/payments-settings";
import { ReviewsSettings } from "@/components/settings/reviews-settings";
import { SettingsNav } from "@/components/settings/settings-nav";
import {
  AccountSection,
  IntegrationsSection,
  TeamSection,
} from "@/components/settings/settings-overview";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  // Reviews, crews, payments and lead intake are managers-only; others don't see them.
  const managerOnly = <T,>(load: () => Promise<T>) => load().catch(() => null);
  const [profile, { company, documents }, labour, messaging, reviews, calendar, crews, payments, intake, params] =
    await Promise.all([
    requireStaff(),
    getCompanySettings().then(async (company) => ({
      company,
      documents: await getCompanyDocuments(company.company.id),
    })),
    getLabourBudgetSettings(),
    getMessagingSettings(),
    managerOnly(getReviewSettings),
    getMyCalendarConnection(),
    managerOnly(getCrewSettings),
    managerOnly(getPaymentSettings),
    managerOnly(getLeadIntakeSettings),
    searchParams,
  ]);
  const calendarResult =
    params.calendar === "connected" || params.calendar === "error" ? params.calendar : null;

  return (
    <>
      <PageHeader title="Settings" subtitle={company.company.name} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <SettingsNav />
        </aside>
        <div className="min-w-0 max-w-3xl space-y-4">
          <CompanyProfileForm company={company.company} canEdit={company.canEdit} />
          <BrandingForm
            orgId={company.company.id}
            logoPath={company.company.logoPath}
            brandColor={company.company.brandColor}
            canManage={company.isManager}
          />
          <CompanyDocuments orgId={company.company.id} documents={documents} canManage={company.isManager} />
          <LabourBudgetSettingsForm settings={labour} />
          <TeamSection team={company.team} />
          {crews ? <CrewsSettings settings={crews} /> : null}
          <MessagingSettingsForm settings={messaging} />
          {reviews ? <ReviewsSettings settings={reviews} /> : null}
          {payments ? <PaymentsSettings settings={payments} /> : null}
          {intake ? <LeadIntakeSettings settings={intake} /> : null}
          <IntegrationsSection integrations={company.integrations} />
          <GoogleCalendarSection
            connection={calendar}
            configured={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)}
            result={calendarResult}
          />
          <AccountSection profile={profile} role={company.myRole} companySince={company.company.createdAt} />
        </div>
      </div>
    </>
  );
}
