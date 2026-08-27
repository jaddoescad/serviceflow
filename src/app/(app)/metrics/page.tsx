import { BusinessPulseBento } from "@/components/business-pulse-concepts";
import { PageHeader } from "@/components/kpi";
import { requireStaff } from "@/lib/auth";
import { getBusinessPulse, getOttawaToday } from "@/lib/business-pulse";
import { resolveMetricsPeriod } from "@/lib/metrics-period";

export const dynamic = "force-dynamic";

type MetricsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MetricsPage({ searchParams }: MetricsPageProps) {
  await requireStaff();
  const query = await searchParams;
  const today = getOttawaToday();
  const selection = resolveMetricsPeriod(
    first(query.range),
    today,
    first(query.start),
    first(query.end),
    first(query.month),
  );
  const pulse = await getBusinessPulse(selection, today);

  return (
    <>
      <PageHeader
        title="Business overview"
        subtitle="Sales performance and conversion rates for the selected period."
      />
      <BusinessPulseBento
        pulse={pulse}
        selection={selection}
      />
    </>
  );
}
