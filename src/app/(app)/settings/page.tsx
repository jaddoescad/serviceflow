import { getLabourBudgetSettings } from "@/lib/actions/settings";
import { LabourBudgetSettingsForm } from "@/components/labour-budget-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getLabourBudgetSettings();
  return (
    <section className="workspace-page">
      <h1 className="text-4xl font-extrabold tracking-tight">Settings</h1>
      <div className="mt-7 max-w-2xl">
        <LabourBudgetSettingsForm settings={settings} />
      </div>
    </section>
  );
}
