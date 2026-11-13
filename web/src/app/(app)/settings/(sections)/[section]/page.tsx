import { notFound } from "next/navigation";
import { LabourBudgetSettingsForm } from "@/components/labour-budget-settings";
import { AvailabilitySettings } from "@/components/settings/availability-settings";
import { BrandingForm } from "@/components/settings/branding-form";
import { CompanyDocuments } from "@/components/settings/company-documents";
import { CompanyProfileForm } from "@/components/settings/company-profile-form";
import { CrewsSettings } from "@/components/settings/crews-settings";
import { DocumentTemplates } from "@/components/settings/document-templates";
import { TaskTemplates } from "@/components/settings/task-templates";
import { GoogleCalendarSection } from "@/components/settings/google-calendar-section";
import { LeadIntakeSettings } from "@/components/settings/lead-intake-settings";
import { LeadAgentSettings } from "@/components/settings/lead-agent-settings";
import { MessagingSettingsForm } from "@/components/settings/messaging-settings-form";
import { PaymentsSettings } from "@/components/settings/payments-settings";
import { ProposalDetailForm } from "@/components/settings/proposal-detail-form";
import { ProposalPageBuilder } from "@/components/settings/proposal-page-builder";
import { ReviewsSettings } from "@/components/settings/reviews-settings";
import { AccountSection, IntegrationsSection, TeamSection } from "@/components/settings/settings-overview";
import { EmptyState } from "@/components/ui";
import { getPaymentSettings } from "@/lib/actions/billing";
import { getBookingSettings } from "@/lib/actions/booking";
import { getMyCalendarConnection } from "@/lib/actions/calendar";
import { getCrewSettings } from "@/lib/actions/crews";
import { getDocumentTemplates } from "@/lib/actions/document-templates";
import { getTaskTemplates } from "@/lib/actions/task-templates";
import { getLeadIntakeSettings } from "@/lib/actions/lead-intake";
import { getLeadAgentSettings } from "@/lib/actions/lead-agent";
import { getMessagingSettings, getReviewSettings } from "@/lib/actions/messaging";
import { getCompanyDocuments, getLabourBudgetSettings } from "@/lib/actions/settings";
import { requireStaff } from "@/lib/auth";
import { getLatestProposalId } from "@/lib/proposals";
import { loadCompanySettings } from "@/lib/settings-data";
import { isSettingsPage, type SettingsPageId } from "@/lib/settings-pages";

export const dynamic = "force-dynamic";

/** Crews, reviews, payments, lead intake, availability and templates are for managers; others get nothing back. */
const managerOnly = <T,>(load: () => Promise<T>) => load().catch(() => null);

const ManagersOnly = () => <EmptyState>Only managers can see these settings.</EmptyState>;

async function Company() {
  const [{ company, canEdit, isManager }, labour] = await Promise.all([loadCompanySettings(), getLabourBudgetSettings()]);
  return (
    <>
      <CompanyProfileForm company={company} canEdit={canEdit} />
      <ProposalDetailForm field="license" page={company.proposalPage} canManage={isManager} />
      <ProposalDetailForm field="taxRatePercent" page={company.proposalPage} canManage={isManager} />
      <LabourBudgetSettingsForm settings={labour} />
    </>
  );
}

async function Team() {
  const [{ team }, crews] = await Promise.all([loadCompanySettings(), managerOnly(getCrewSettings)]);
  return (
    <>
      <TeamSection team={team} />
      {crews ? <CrewsSettings settings={crews} /> : null}
    </>
  );
}

async function Branding() {
  const { company, isManager } = await loadCompanySettings();
  const documents = await getCompanyDocuments(company.id);
  return (
    <>
      <BrandingForm orgId={company.id} logoPath={company.logoPath} brandColor={company.brandColor} canManage={isManager} />
      <CompanyDocuments orgId={company.id} documents={documents} canManage={isManager} />
    </>
  );
}

async function ProposalPage() {
  const { company, isManager } = await loadCompanySettings();
  const previewId = await getLatestProposalId(company.id);
  return (
    <ProposalPageBuilder
      orgId={company.id}
      companyName={company.name}
      brandColor={company.brandColor}
      page={company.proposalPage}
      canManage={isManager}
      previewId={previewId}
    />
  );
}

async function Templates() {
  const [templates, taskTemplates, { company, isManager }] = await Promise.all([
    managerOnly(getDocumentTemplates),
    managerOnly(getTaskTemplates),
    loadCompanySettings(),
  ]);
  return templates ? (
    <>
      <DocumentTemplates templates={templates} />
      <TaskTemplates templates={taskTemplates ?? []} />
      <ProposalDetailForm field="terms" page={company.proposalPage} canManage={isManager} />
    </>
  ) : (
    <ManagersOnly />
  );
}

async function Messaging() {
  const [messaging, reviews] = await Promise.all([getMessagingSettings(), managerOnly(getReviewSettings)]);
  return (
    <>
      <MessagingSettingsForm settings={messaging} />
      {reviews ? <ReviewsSettings settings={reviews} /> : null}
    </>
  );
}

async function Booking() {
  const [intake, booking] = await Promise.all([managerOnly(getLeadIntakeSettings), managerOnly(getBookingSettings)]);
  if (!intake && !booking) return <ManagersOnly />;
  return (
    <>
      {intake ? <LeadIntakeSettings settings={intake} /> : null}
      {booking ? <AvailabilitySettings settings={booking} /> : null}
    </>
  );
}

async function Payments() {
  const payments = await managerOnly(getPaymentSettings);
  return payments ? <PaymentsSettings settings={payments} /> : <ManagersOnly />;
}

async function Integrations({ calendar: outcome }: { calendar?: string }) {
  const [{ integrations }, calendar, leadAgent] = await Promise.all([
    loadCompanySettings(),
    getMyCalendarConnection(),
    managerOnly(getLeadAgentSettings),
  ]);
  return (
    <>
      <IntegrationsSection integrations={integrations} />
      <GoogleCalendarSection
        connection={calendar}
        configured={Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)}
        result={outcome === "connected" || outcome === "error" ? outcome : null}
      />
      {leadAgent ? <LeadAgentSettings settings={leadAgent} /> : null}
    </>
  );
}

async function Account() {
  const [profile, { company, myRole }] = await Promise.all([requireStaff(), loadCompanySettings()]);
  return <AccountSection profile={profile} role={myRole} companySince={company.createdAt} />;
}

const PAGES: Record<SettingsPageId, (query: { calendar?: string }) => React.ReactNode> = {
  company: () => <Company />,
  team: () => <Team />,
  branding: () => <Branding />,
  "proposal-page": () => <ProposalPage />,
  templates: () => <Templates />,
  messaging: () => <Messaging />,
  booking: () => <Booking />,
  payments: () => <Payments />,
  integrations: (query) => <Integrations calendar={query.calendar} />,
  account: () => <Account />,
};

export default async function SettingsSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ calendar?: string }>;
}) {
  const [{ section }, query] = await Promise.all([params, searchParams, requireStaff()]);
  if (!isSettingsPage(section)) notFound();
  return PAGES[section](query);
}
