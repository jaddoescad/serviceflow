import { onlinePaymentsAvailable } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { isIncluded, lineTotalCents, newLineItem, reviveLineItems, type LineItem } from "@/lib/line-items";
import type {
  ChangeOrder,
  ChangeOrderStatus,
  Invoice,
  InvoicePayment,
  InvoiceSummary,
  PaymentSettings,
  ScopeItem,
  WorkOrder,
} from "@/lib/billing-types";

type Row = Record<string, any>;

/** PostgREST embeds a related row as an object or a one-element array. */
function one<T = Row>(value: unknown): T | null {
  return ((Array.isArray(value) ? value[0] : value) ?? null) as T | null;
}

const CHANGE_ORDER_FIELDS =
  "id,job_id,number,name,status,line_items,tax_rate_percent,amount_cents,intro,public_token,sent_at,viewed_at,signed_name,signed_at,declined_at,decline_reason,updated_at";

function toChangeOrder(row: Row): ChangeOrder {
  return {
    id: row.id,
    jobId: row.job_id,
    number: row.number,
    name: row.name,
    status: row.status,
    items: reviveLineItems(row.line_items),
    taxRatePercent: Number(row.tax_rate_percent ?? 0),
    amountCents: Number(row.amount_cents ?? 0),
    intro: row.intro ?? "",
    publicToken: row.public_token,
    sentAt: row.sent_at,
    viewedAt: row.viewed_at,
    signedName: row.signed_name,
    signedAt: row.signed_at,
    declinedAt: row.declined_at,
    declineReason: row.decline_reason,
    updatedAt: row.updated_at,
    customerName: row.job?.contact?.name ?? undefined,
  };
}

export async function getJobChangeOrders(jobId: string): Promise<ChangeOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("change_orders")
    .select(CHANGE_ORDER_FIELDS)
    .eq("job_id", jobId)
    .order("number", { ascending: false });
  if (error) throw new Error(`change orders: ${error.message}`);
  return (data ?? []).map(toChangeOrder);
}

export async function getChangeOrder(id: string): Promise<ChangeOrder | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("change_orders").select(CHANGE_ORDER_FIELDS).eq("id", id).maybeSingle();
  if (error) throw new Error(`change order: ${error.message}`);
  return data ? toChangeOrder(data) : null;
}

export async function listChangeOrders(status: ChangeOrderStatus | null): Promise<ChangeOrder[]> {
  const supabase = await createClient();
  let query = supabase
    .from("change_orders")
    .select(`${CHANGE_ORDER_FIELDS},job:jobs(contact:contacts(name))`)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`change orders list: ${error.message}`);
  return (data ?? []).map(toChangeOrder);
}

export async function getInvoices(jobId: string | null): Promise<InvoiceSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invoices", { requested_job: jobId });
  if (error) throw new Error(`invoices: ${error.message}`);
  return (data ?? []) as InvoiceSummary[];
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id,org_id,job_id,line_items,tax_rate_percent,notes,public_token,viewed_at,invoice_payments(id,amount_cents,paid_on,method,reference,note,source,fee_cents)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`invoice: ${error.message}`);
  if (!data) return null;
  const [invoices, online] = await Promise.all([getInvoices(data.job_id), getOnlinePayments(data.org_id, data.job_id)]);
  const summary = invoices.find((invoice) => invoice.id === id);
  if (!summary) return null;
  return {
    ...summary,
    items: reviveLineItems(data.line_items),
    taxRatePercent: Number(data.tax_rate_percent ?? 0),
    notes: data.notes ?? "",
    publicToken: data.public_token,
    viewedAt: data.viewed_at,
    payments: ((data.invoice_payments ?? []) as Row[])
      .map(
        (payment): InvoicePayment => ({
          id: payment.id,
          amountCents: Number(payment.amount_cents),
          paidOn: payment.paid_on,
          method: payment.method,
          reference: payment.reference,
          note: payment.note,
          source: payment.source ?? "manual",
          feeCents: Number(payment.fee_cents ?? 0),
        }),
      )
      .sort((a, b) => a.paidOn.localeCompare(b.paidOn)),
    online,
  };
}

/** Whether customers can pay this job's invoices by card; null when the company doesn't take cards online. */
async function getOnlinePayments(orgId: string, jobId: string): Promise<Invoice["online"]> {
  if (!onlinePaymentsAvailable()) return null;
  const supabase = await createClient();
  const [settings, locked] = await Promise.all([
    supabase.rpc("get_payment_settings", { requested_org: orgId }),
    supabase.rpc("is_historical_job_accounting_locked", { p_job_id: jobId }),
  ]);
  const value = settings.data as PaymentSettings | null;
  if (settings.error || !value?.acceptCards) return null;
  return { feePercent: Number(value.cardFeePercent ?? 0), locked: locked.data === true };
}

/** What the customer agreed to: the accepted proposal's chosen lines, then each accepted change order's, oldest first. */
function agreedScope(quote: Row | null, changeOrders: ChangeOrder[]): ScopeItem[] {
  return [
    ...reviveLineItems(quote?.line_items)
      .filter(isIncluded)
      .map((item) => ({ ...item, changeOrder: null })),
    ...changeOrders
      .filter((order) => order.status === "accepted")
      .sort((a, b) => a.number - b.number)
      .flatMap((order) => order.items.filter(isIncluded).map((item) => ({ ...item, changeOrder: order.number }))),
  ];
}

/**
 * Lines for a job's final invoice: the agreed scope, less what earlier
 * invoices already billed (entered before tax so the total comes out right).
 */
export async function draftFinalInvoice(jobId: string): Promise<{ items: LineItem[]; taxRatePercent: number }> {
  const supabase = await createClient();
  const [{ data: job, error }, changeOrders, invoices] = await Promise.all([
    supabase
      .from("jobs")
      .select("accepted_quote:quotes!jobs_accepted_quote_id_fkey(line_items,tax_rate_percent)")
      .eq("id", jobId)
      .maybeSingle(),
    getJobChangeOrders(jobId),
    getInvoices(jobId),
  ]);
  if (error) throw new Error(`final invoice: ${error.message}`);
  const quote = one(job?.accepted_quote);
  const taxRatePercent = Number(quote?.tax_rate_percent ?? 13);
  const items: LineItem[] = agreedScope(quote, changeOrders).map(({ changeOrder, ...item }) => ({
    ...item,
    id: crypto.randomUUID(),
    name: changeOrder == null ? item.name : `${item.name} (change order #${changeOrder})`,
    optional: false,
    selected: true,
  }));
  const billed = invoices.filter((invoice) => invoice.status !== "void" && invoice.status !== "draft");
  const billedCents = billed.reduce((sum, invoice) => sum + invoice.amountCents, 0);
  if (billedCents > 0) {
    items.push(
      newLineItem({
        name: "Less previous invoices",
        description: billed.map((invoice) => `#${invoice.number} ${invoice.name}`).join(", "),
        unitPriceCents: -Math.round(billedCents / (1 + taxRatePercent / 100)),
      }),
    );
  }
  return { items: items.filter((item) => lineTotalCents(item) !== 0 || item.name), taxRatePercent };
}

/** The crew's job sheet: where, who to call, when, and the agreed scope without prices. */
export async function getWorkOrder(jobId: string): Promise<WorkOrder | null> {
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .select(
      "id,name,lead_id,formatted_address,address_line_1,scheduled_on,scheduled_end_on,contact:contacts(name,email,phone),accepted_quote:quotes!jobs_accepted_quote_id_fkey(name,line_items),job_assignments(status,employee:employees(full_name))",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`work order: ${error.message}`);
  if (!job) return null;
  const [{ data: notes, error: notesError }, changeOrders] = await Promise.all([
    supabase
      .from("project_notes")
      .select("id,body")
      .in("project_id", [job.id, job.lead_id].filter(Boolean))
      .order("created_at", { ascending: false }),
    getJobChangeOrders(jobId),
  ]);
  if (notesError) throw new Error(`work order notes: ${notesError.message}`);
  const quote = one(job.accepted_quote);
  return {
    name: job.name,
    address: job.formatted_address ?? job.address_line_1 ?? null,
    scheduledOn: job.scheduled_on,
    scheduledEndOn: job.scheduled_end_on,
    contact: one<WorkOrder["contact"]>(job.contact),
    proposalName: quote?.name ?? null,
    scope: agreedScope(quote, changeOrders),
    crew: ((job.job_assignments ?? []) as Row[])
      .filter((assignment) => assignment.status === "active")
      .map((assignment) => one(assignment.employee)?.full_name)
      .filter((name): name is string => !!name),
    notes: (notes ?? []) as WorkOrder["notes"],
  };
}
