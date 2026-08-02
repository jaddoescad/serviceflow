import Link from "next/link";
import { PageHeader, Kpi } from "@/components/kpi";
import { Badge, Card, CardHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import {
  getJobAccountingLedger,
  type JobAccountingRecord,
} from "@/lib/job-accounting";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat("en-CA", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function sum(rows: JobAccountingRecord[], field: keyof JobAccountingRecord) {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

function rowState(job: JobAccountingRecord) {
  if (job.review_reasons.length > 0) return "review";
  if (job.open_items.length > 0) return "open";
  return "settled";
}

function reasonLabel(value: string) {
  return value
    .replace("missing_lead", "Missing lead")
    .replace("missing_customer_invoice", "Missing customer invoice")
    .replace("ambiguous_project_identity", "Ambiguous job identity")
    .replace("customer_invoice_needs_review", "Customer invoice review")
    .replace(
      "supplier_hst_registration_unverified",
      "Subcontractor HST registration",
    )
    .replace("supplier_cost_needs_review", "Subcontractor cost review")
    .replace("material_cost_needs_review", "Material cost review")
    .replace("customer_payment_open", "Customer payment open")
    .replace("supplier_payment_open", "Subcontractor payment open")
    .replace("material_payment_open", "Material payment open")
    .replaceAll("_", " ");
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [, jobs, params] = await Promise.all([
    requireStaff(),
    getJobAccountingLedger(),
    searchParams,
  ]);

  const requestedStatus = first(params.status) || "all";
  const status = ["all", "review", "open", "settled"].includes(
    requestedStatus,
  )
    ? requestedStatus
    : "all";
  const query = first(params.q).trim().toLocaleLowerCase("en-CA");
  const filtered = jobs.filter((job) => {
    const matchesStatus = status === "all" || rowState(job) === status;
    const matchesQuery =
      !query ||
      [
        job.job_name,
        job.job_proposal_id,
        job.companycam_project_id,
        job.raw_lead_source,
      ].some((value) =>
        String(value ?? "").toLocaleLowerCase("en-CA").includes(query),
      );
    return matchesStatus && matchesQuery;
  });

  const reviewJobs = jobs.filter((job) => rowState(job) === "review").length;
  const openJobs = jobs.filter((job) => rowState(job) === "open").length;
  const billed = sum(jobs, "booked_revenue_before_hst");
  const directCost = sum(jobs, "direct_cost_before_hst");
  const grossProfit = billed - directCost;

  return (
    <>
      <PageHeader
        title="Job accounting"
        subtitle="One connected view of leads, jobs, invoices, HST, bank settlement, and direct costs"
        actions={
          reviewJobs > 0 ? (
            <Badge tone="warn">{reviewJobs} jobs need connection review</Badge>
          ) : (
            <Badge tone="good">All job connections verified</Badge>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          label="Booked before HST"
          value={money.format(billed)}
          hint={`${jobs.length} DripJobs jobs`}
          tone="good"
        />
        <Kpi
          label="Customer HST billed"
          value={money.format(sum(jobs, "customer_hst_billed"))}
          hint="from customer invoices"
        />
        <Kpi
          label="Bank cash received"
          value={money.format(sum(jobs, "customer_bank_cash_received"))}
          hint="allocated bank deposits"
        />
        <Kpi
          label="Direct cost before HST"
          value={money.format(directCost)}
          hint="subcontractor + material invoices"
          tone="warn"
        />
        <Kpi
          label="Invoice-backed gross margin"
          value={billed > 0 ? percent.format(grossProfit / billed) : "—"}
          hint={money.format(grossProfit)}
          tone={grossProfit >= 0 ? "good" : "bad"}
        />
      </div>

      <Card className="my-4 p-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium text-[var(--color-heading)]">
            Connection health
          </span>
          <Badge tone={reviewJobs > 0 ? "warn" : "good"}>
            {reviewJobs} need review
          </Badge>
          <Badge tone={openJobs > 0 ? "neutral" : "good"}>
            {openJobs} connected with open payments
          </Badge>
          <span className="text-xs text-[var(--color-muted)]">
            Source-level bank, supplier-line, and material-line exceptions stay
            available in the accounting audit queue without slowing this job view.
          </span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Connected jobs"
          subtitle="Review means evidence is missing; open means the connection is valid but money remains unpaid"
        />
        <form className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <label className="text-xs font-medium text-[var(--color-muted)]">
            Status
            <select
              name="status"
              defaultValue={status}
              className="mt-1 block h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            >
              <option value="all">All jobs</option>
              <option value="review">Needs connection review</option>
              <option value="open">Connected · payment open</option>
              <option value="settled">Connected · settled</option>
            </select>
          </label>
          <label className="min-w-[240px] flex-1 text-xs font-medium text-[var(--color-muted)]">
            Search
            <input
              name="q"
              defaultValue={first(params.q)}
              placeholder="Customer, proposal, project, or source"
              className="mt-1 block h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            />
          </label>
          <button
            type="submit"
            className="h-9 rounded-lg bg-[var(--color-brand)] px-4 text-sm font-medium text-white"
          >
            Apply
          </button>
          <Link
            href="/accounting"
            className="mb-2 text-xs font-medium text-[var(--color-brand-strong)] hover:underline"
          >
            Clear
          </Link>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-xs">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Lead source</th>
                <th className="px-3 py-2 text-right font-medium">Before HST</th>
                <th className="px-3 py-2 text-right font-medium">HST billed</th>
                <th className="px-3 py-2 text-right font-medium">Bank cash</th>
                <th className="px-3 py-2 text-right font-medium">A/R</th>
                <th className="px-3 py-2 text-right font-medium">Sub cost</th>
                <th className="px-3 py-2 text-right font-medium">Sub HST</th>
                <th className="px-3 py-2 text-right font-medium">Materials</th>
                <th className="px-3 py-2 text-right font-medium">Gross profit</th>
                <th className="px-3 py-2 font-medium">Connection</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filtered.map((job) => {
                const state = rowState(job);
                const labels =
                  state === "review" ? job.review_reasons : job.open_items;
                return (
                  <tr key={job.job_proposal_id} className="hover:bg-[var(--color-surface-2)]">
                    <td className="px-3 py-2">
                      {job.companycam_project_id ? (
                        <Link
                          href={`/projects/${encodeURIComponent(job.companycam_project_id)}/invoices`}
                          className="font-medium text-[var(--color-heading)] hover:text-[var(--color-brand-strong)]"
                        >
                          {job.job_name}
                        </Link>
                      ) : (
                        <span className="font-medium text-[var(--color-heading)]">
                          {job.job_name}
                        </span>
                      )}
                      <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                        Proposal {job.job_proposal_id} · {fmtDate(job.proposal_signed_on)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{job.raw_lead_source ?? "—"}</div>
                      <div className="text-[11px] text-[var(--color-muted)]">
                        {job.lead_channel?.replaceAll("_", " ") ?? "No lead"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money.format(job.booked_revenue_before_hst)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money.format(job.customer_hst_billed)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money.format(job.customer_bank_cash_received)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money.format(job.customer_amount_receivable)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money.format(job.supplier_cost_before_hst)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money.format(job.supplier_hst_documented)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money.format(job.material_cost_before_hst)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {money.format(job.gross_profit_before_hst)}
                    </td>
                    <td className="max-w-[230px] px-3 py-2">
                      <Badge
                        tone={
                          state === "review"
                            ? "warn"
                            : state === "open"
                              ? "neutral"
                              : "good"
                        }
                      >
                        {state === "review"
                          ? "Needs review"
                          : state === "open"
                            ? "Connected · open"
                            : "Connected · settled"}
                      </Badge>
                      {labels.length > 0 ? (
                        <div className="mt-1 text-[11px] text-[var(--color-muted)]">
                          {labels.map(reasonLabel).join(" · ")}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-muted)]">
          {filtered.length} of {jobs.length} jobs
        </div>
      </Card>
    </>
  );
}
