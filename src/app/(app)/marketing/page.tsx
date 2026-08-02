import { MarketingSalesDashboard } from "@/components/marketing-sales-dashboard";
import { requireStaff } from "@/lib/auth";
import { getMarketingSalesDataset } from "@/lib/marketing-sales";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  const [, dataset] = await Promise.all([
    requireStaff(),
    getMarketingSalesDataset(),
  ]);

  return <MarketingSalesDashboard dataset={dataset} />;
}
