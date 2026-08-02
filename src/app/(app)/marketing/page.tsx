import { PageHeader, Kpi } from "@/components/kpi";
import { Badge, Card, CardHeader, Select } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import {
  getMarketingMetrics,
  getMarketingYears,
  type MarketingPlatformEntity,
} from "@/lib/marketing";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const percent = new Intl.NumberFormat("en-CA", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const integer = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function money(value: number, currency: "CAD" | "USD" = "CAD") {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRatio(value: number | null) {
  return value == null ? "—" : `${value.toFixed(2)}×`;
}

function roasTone(value: number | null): "neutral" | "good" | "warn" | "bad" {
  if (value == null) return "neutral";
  if (value >= 3) return "good";
  if (value >= 1) return "warn";
  return "bad";
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonth(value: string) {
  return new Date(`${value}-01T12:00:00Z`).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    month: "short",
  });
}

function formatCapturedAt(value: string) {
  return new Date(value).toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function purposeLabel(value: MarketingPlatformEntity["purpose"]) {
  if (value === "customer_acquisition") return "Customer acquisition";
  if (value === "recruiting") return "Recruiting";
  return "Other";
}

function EntityTable({
  rows,
  level,
}: {
  rows: MarketingPlatformEntity[];
  level: "campaign" | "ad_set" | "ad";
}) {
  const label = level === "campaign" ? "Campaign" : level === "ad_set" ? "Ad set" : "Ad";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-left text-[13px]">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
          <tr>
            <th className="px-4 py-3 font-medium">Account</th>
            <th className="px-4 py-3 font-medium">{label}</th>
            <th className="px-4 py-3 font-medium">Purpose</th>
            <th className="px-4 py-3 text-right font-medium">Spend</th>
            <th className="px-4 py-3 text-right font-medium">Leads</th>
            <th className="px-4 py-3 text-right font-medium">Impressions</th>
            <th className="px-4 py-3 text-right font-medium">Reach</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {rows.map((row, index) => (
            <tr
              key={`${row.accountId}-${row.level}-${row.campaignName}-${row.adSetName}-${row.name}-${index}`}
            >
              <td className="px-4 py-3">
                <div className="font-medium text-[var(--color-heading)]">{row.accountName}</div>
                <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">{row.currency}</div>
              </td>
              <td className="max-w-[360px] px-4 py-3">
                <div className="font-medium text-[var(--color-heading)]">{row.name}</div>
                {level !== "campaign" && row.campaignName ? (
                  <div className="mt-0.5 truncate text-[11px] text-[var(--color-muted)]">
                    {row.campaignName}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <Badge tone={row.purpose === "customer_acquisition" ? "brand" : "neutral"}>
                  {purposeLabel(row.purpose)}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">
                {money(row.spend, row.currency)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{integer.format(row.leads)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{integer.format(row.impressions)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{integer.format(row.reach)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [, years, params] = await Promise.all([
    requireStaff(),
    getMarketingYears(),
    searchParams,
  ]);
  const requestedYear = Number(firstParam(params.year));
  const defaultYear = years[0] ?? new Date().getFullYear();
  const year = years.includes(requestedYear) ? requestedYear : defaultYear;
  const marketing = await getMarketingMetrics(year);
  const campaignRows = marketing.platformEntities.filter(
    (row) => row.level === "campaign",
  );
  const adSetRows = marketing.platformEntities.filter(
    (row) => row.level === "ad_set",
  );
  const adRows = marketing.platformEntities.filter((row) => row.level === "ad");
  const maxMonthlySpend = Math.max(
    0,
    ...marketing.accounting.monthlySpend.map((row) => row.spend),
  );

  return (
    <>
      <PageHeader
        title="Marketing"
        subtitle="Bank spend, Meta delivery, leads, customer invoices, and collected revenue"
        actions={
          <form method="get" className="flex items-center gap-2">
            <Select name="year" defaultValue={String(year)} aria-label="Marketing year">
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <button
              type="submit"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)]"
            >
              Apply
            </button>
          </form>
        }
      />

      <Card className="mb-4 border-[var(--color-brand)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-heading)]">
              The bank ledger is the accounting source of truth
            </div>
            <div className="mt-1 max-w-4xl text-sm text-[var(--color-muted)]">
              {money(marketing.accounting.spend)} across {marketing.accounting.transactionCount} posted Advertising &amp; marketing transactions. Meta delivery is supporting detail from two ad accounts—one CAD and one legacy USD—so those native-currency totals are shown separately and never substituted for the bank total.
            </div>
          </div>
          <Badge tone="good">Verified bank total</Badge>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          label="Total marketing spend"
          value={money(marketing.accounting.spend)}
          hint={`${marketing.accounting.transactionCount} posted bank transactions`}
          tone="warn"
        />
        <Kpi
          label="Marketing % of revenue"
          value={
            marketing.accounting.marketingShareOfRevenue == null
              ? "—"
              : percent.format(marketing.accounting.marketingShareOfRevenue)
          }
          hint={`${money(marketing.accounting.revenueBeforeHst)} revenue before HST`}
        />
        <Kpi
          label="Paid-social invoices"
          value={marketing.paidSocial.jobs}
          hint={`${money(marketing.paidSocial.customerAcquisitionCost ?? 0)} blended cost per won job`}
        />
        <Kpi
          label="Booked ROAS"
          value={formatRatio(marketing.paidSocial.bookedRoas)}
          hint={`${money(marketing.paidSocial.bookedRevenueBeforeHst)} invoiced before HST`}
          tone={roasTone(marketing.paidSocial.bookedRoas)}
        />
        <Kpi
          label="Cash ROAS"
          value={formatRatio(marketing.paidSocial.cashRoas)}
          hint={`${money(marketing.paidSocial.bankBackedRevenueBeforeHst)} bank-backed before HST`}
          tone={roasTone(marketing.paidSocial.cashRoas)}
        />
      </div>

      <div className="my-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <Card>
          <CardHeader
            title={`${year} bank marketing spend by month`}
            subtitle="Posted CAD charges · bank ledger source"
            right={<Badge tone="neutral">{money(marketing.accounting.spend)} total</Badge>}
          />
          <div className="space-y-4 p-5">
            {marketing.accounting.monthlySpend.map((row) => (
              <div key={row.month}>
                <div className="mb-1.5 flex items-center justify-between gap-4 text-sm">
                  <span className="font-medium text-[var(--color-heading)]">
                    {formatMonth(row.month)}
                    <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">
                      {row.transactions} transactions
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">{money(row.spend)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-chip-muted)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-brand)]"
                    style={{
                      width: `${maxMonthlySpend > 0 ? Math.max(2, (row.spend / maxMonthlySpend) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Paid-social revenue evidence"
            subtitle="DripJobs lead source → customer invoice → bank allocation"
          />
          <div className="divide-y divide-[var(--color-border)] px-5">
            <div className="flex items-center justify-between gap-4 py-4 text-sm">
              <span className="text-[var(--color-muted)]">Attributed customer invoices</span>
              <span className="font-semibold tabular-nums text-[var(--color-heading)]">{marketing.paidSocial.jobs}</span>
            </div>
            <div className="flex items-center justify-between gap-4 py-4 text-sm">
              <span className="text-[var(--color-muted)]">Booked revenue before HST</span>
              <span className="font-semibold tabular-nums text-[var(--color-heading)]">{money(marketing.paidSocial.bookedRevenueBeforeHst)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 py-4 text-sm">
              <span className="text-[var(--color-muted)]">Bank-backed revenue before HST</span>
              <span className="font-semibold tabular-nums text-[var(--color-heading)]">{money(marketing.paidSocial.bankBackedRevenueBeforeHst)}</span>
            </div>
            <div className="py-4 text-xs leading-5 text-[var(--color-muted)]">
              The blended ROAS denominator is the full {money(marketing.accounting.spend)} bank marketing total, including recruiting. It is deliberately conservative and does not invent a CAD conversion for the legacy USD platform account.
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">
            Meta account delivery
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Direct Marketing API snapshot · native account currency
          </p>
        </div>
        {marketing.capturedAt ? (
          <Badge tone="neutral">Captured {formatCapturedAt(marketing.capturedAt)}</Badge>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {marketing.platformAccounts.map((account) => (
          <Card key={account.accountId} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-[var(--color-heading)]">{account.name}</div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  {formatDate(account.reportingStart)}–{formatDate(account.reportingEnd)} · {account.accountId}
                </div>
              </div>
              <Badge tone="brand">{account.currency}</Badge>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div>
                <div className="text-xs text-[var(--color-muted)]">Customer campaigns</div>
                <div className="mt-1 font-display text-xl font-semibold tabular-nums text-[var(--color-heading)]">{money(account.customerSpend, account.currency)}</div>
                <div className="mt-0.5 text-xs text-[var(--color-muted)]">{integer.format(account.customerLeads)} leads</div>
              </div>
              <div>
                <div className="text-xs text-[var(--color-muted)]">Recruiting campaigns</div>
                <div className="mt-1 font-display text-xl font-semibold tabular-nums text-[var(--color-heading)]">{money(account.recruitingSpend, account.currency)}</div>
                <div className="mt-0.5 text-xs text-[var(--color-muted)]">{integer.format(account.recruitingLeads)} leads</div>
              </div>
            </div>
            <div className="mt-5 border-t border-[var(--color-border)] pt-3 text-sm">
              <span className="text-[var(--color-muted)]">Platform delivery total</span>
              <span className="float-right font-semibold tabular-nums text-[var(--color-heading)]">{money(account.totalSpend, account.currency)}</span>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title="Meta campaigns"
          subtitle="Spend and results from both Ottawa Painters ad accounts"
        />
        <EntityTable rows={campaignRows} level="campaign" />
      </Card>

      <Card className="mt-4 overflow-hidden">
        <details>
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-[var(--color-heading)]">
            Ad-set detail ({adSetRows.length})
          </summary>
          <EntityTable rows={adSetRows} level="ad_set" />
        </details>
        <details className="border-t border-[var(--color-border)]">
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-[var(--color-heading)]">
            Ad detail ({adRows.length})
          </summary>
          <EntityTable rows={adRows} level="ad" />
        </details>
      </Card>
    </>
  );
}
