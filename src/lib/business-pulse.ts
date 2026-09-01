import { createClient } from "@/lib/supabase/server";
import {
  buildBusinessPulse,
  type BusinessPulse,
  type BusinessPulseJobRow,
  type BusinessPulseLeadRow,
  type BusinessPulseProposalRow,
  type BusinessPulseQuoteRow,
  type BusinessPulseSalesReportRow,
  type BusinessPulseSetRateReportRow,
  type BusinessPulseSpendRow,
  type BusinessPulseTransactionRow,
} from "@/lib/business-pulse-metrics";
import type { MetricsPeriodSelection } from "@/lib/metrics-period";

const OTTAWA_TIME_ZONE = "America/Toronto";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function ottawaToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OTTAWA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  orderBy: string,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function getOttawaToday(): string {
  return ottawaToday();
}

export async function getBusinessPulse(
  period?: MetricsPeriodSelection,
  asOf = ottawaToday(),
): Promise<BusinessPulse> {
  const supabase = await createClient();
  const [
    leads,
    proposals,
    spend,
    jobs,
    quotes,
    transactions,
    salesReports,
    setRateReports,
  ] =
    await Promise.all([
      fetchAllRows<BusinessPulseLeadRow>(
        supabase,
        "marketing_lead_facts",
        "source_document_id,source_row_number,lead_id,created_on,appointment_on,normalized_channel,marketing_eligible,captured_at",
        "source_row_number",
      ),
      fetchAllRows<BusinessPulseProposalRow>(
        supabase,
        "marketing_proposal_facts",
        "source_document_id,source_row_number,proposal_key,lead_id,first_sent_on,captured_at",
        "source_row_number",
      ),
      fetchAllRows<BusinessPulseSpendRow>(
        supabase,
        "marketing_performance",
        "id,platform,grain,period_start,entity_level,purpose,currency,spend_cents,captured_at",
        "id",
      ),
      fetchAllRows<BusinessPulseJobRow>(
        supabase,
        "jobs",
        "id,lead_id,accepted_quote_id,status,contract_amount_cents,updated_at",
        "id",
      ),
      fetchAllRows<BusinessPulseQuoteRow>(
        supabase,
        "quotes",
        "id,lead_id,accepted_at",
        "id",
      ),
      fetchAllRows<BusinessPulseTransactionRow>(
        supabase,
        "transactions",
        "id,posted_on,description,counterparty,amount_cents,category,is_transfer,review_status,updated_at",
        "posted_on",
      ),
      fetchAllRows<BusinessPulseSalesReportRow>(
        supabase,
        "dripjobs_sales_report_latest",
        "period_start,period_end,sales_count,gross_sales_cents,captured_at",
        "period_start",
      ),
      fetchAllRows<BusinessPulseSetRateReportRow>(
        supabase,
        "dripjobs_set_rate_latest",
        "period_start,period_end,contacts_created_count,booked_contacts_count,captured_at",
        "period_start",
      ),
    ]);

  return buildBusinessPulse({
    asOf,
    period,
    leads,
    proposals,
    spend,
    jobs,
    quotes,
    transactions,
    salesReports,
    setRateReports,
  });
}
