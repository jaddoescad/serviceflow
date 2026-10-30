import { DripsEditor } from "@/components/drips-editor";
import { PageHeader } from "@/components/kpi";
import { PageTabs } from "@/components/page-tabs";
import { ReminderRules } from "@/components/reminder-rules";
import { getDripSettings, getMessagingSettings, getReviewSettings } from "@/lib/actions/messaging";
import { getReminderRules } from "@/lib/actions/reminders";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

const VIEWS = [
  ["sales", "Sales Pipeline"],
  ["jobs", "Jobs Pipeline"],
  ["reminders", "Reminders"],
] as const;

export default async function DripsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: requested } = await searchParams;
  const view = VIEWS.find(([key]) => key === requested)?.[0] ?? "sales";
  await requireStaff();
  const [settings, stages, rules, reviews] = await Promise.all([
    getMessagingSettings(),
    view === "reminders" ? [] : getDripSettings(view),
    view === "reminders" ? getReminderRules() : [],
    view === "jobs" ? getReviewSettings() : null,
  ]);
  return (
    <>
      <PageHeader title="Drips" />
      <PageTabs
        label="Drips sections"
        tabs={VIEWS.map(([key, label]) => ({
          href: key === "sales" ? "/drips" : `/drips?view=${key}`,
          label,
          active: view === key,
        }))}
      />
      {view === "reminders" ? (
        <ReminderRules rules={rules} quoConnected={settings.quoConnected} />
      ) : (
        <DripsEditor
          key={view}
          pipeline={view}
          stages={stages}
          quoConnected={settings.quoConnected}
          reviewLinkSet={Boolean(reviews?.reviewLink)}
        />
      )}
    </>
  );
}
