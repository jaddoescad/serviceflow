import { createClient } from "@/lib/supabase/server";

export type InvoiceEntryType =
  | "labour"
  | "material"
  | "bonus"
  | "commission"
  | "expense"
  | "other"
  | "unclassified";

export type InvoiceEntrySourceKind =
  | "extracted"
  | "manual"
  | "legacy_project_link"
  | "legacy_invoice_total";

export type InvoiceEntryRecord = {
  id: string;
  invoice_id: string;
  line_number: number;
  entry_type: InvoiceEntryType;
  description: string;
  service_started_on: string | null;
  service_ended_on: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  quantity_hours: number | null;
  hourly_rate: number | null;
  amount_before_tax: number;
  tax_amount: number;
  after_hst_amount: number;
  source_kind: InvoiceEntrySourceKind;
  source_text: string | null;
  needs_review: boolean;
  invoice: {
    id: string;
    supplier_name: string;
    invoice_number: string;
    invoice_date: string | null;
    source_date: string | null;
    currency: "CAD" | "USD";
    amount_before_tax: number;
    tax_amount: number;
    amount_paid: number;
    original_filename: string;
    duplicate_group_size: number;
    owner_name: string;
    paid_amount: number;
    payment_status: "paid" | "partially_paid" | "unpaid" | "overpaid";
    verification_status: "needs_information" | "needs_review" | "verified";
  };
  jobs: Array<{
    companycam_project_id: string;
    allocated_amount: number;
    allocated_hours: number | null;
    needs_review: boolean;
    name: string;
    address: string | null;
  }>;
};

type StoredEntry = Omit<InvoiceEntryRecord, "invoice" | "jobs"> & {
  labour_invoices:
    | (Omit<
        InvoiceEntryRecord["invoice"],
        | "owner_name"
        | "paid_amount"
        | "payment_status"
        | "verification_status"
      > & {
        labour_contractors: {
          employee_profiles: {
            full_name: string;
          } | null;
        } | null;
      })
    | null;
  labour_invoice_line_allocations: Array<{
    companycam_project_id: string;
    allocated_amount: number;
    allocated_hours: number | null;
    needs_review: boolean;
    companycam_projects: {
      name: string;
      formatted_address: string | null;
    } | null;
  }>;
};

type EntryVerification = Pick<
  InvoiceEntryRecord["invoice"],
  "paid_amount" | "payment_status" | "verification_status"
>;

function dateKey(entry: InvoiceEntryRecord): string {
  return (
    entry.service_started_on ??
    entry.invoice.invoice_date ??
    entry.invoice.source_date ??
    ""
  );
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function addAfterHstAmounts(
  entries: InvoiceEntryRecord[],
): InvoiceEntryRecord[] {
  const entriesByInvoice = new Map<string, InvoiceEntryRecord[]>();
  for (const entry of entries) {
    entriesByInvoice.set(entry.invoice_id, [
      ...(entriesByInvoice.get(entry.invoice_id) ?? []),
      entry,
    ]);
  }

  return [...entriesByInvoice.values()].flatMap((invoiceEntries) => {
    const invoiceTaxCents = cents(invoiceEntries[0]!.invoice.tax_amount);
    const recordedLineTaxCents = invoiceEntries.reduce(
      (total, entry) => total + cents(entry.tax_amount),
      0,
    );
    const taxToAllocate = invoiceTaxCents - recordedLineTaxCents;
    const allocationBasis = invoiceEntries.reduce(
      (total, entry) => total + Math.max(0, cents(entry.amount_before_tax)),
      0,
    );

    if (taxToAllocate === 0 || allocationBasis === 0) {
      return invoiceEntries.map((entry, index) => ({
        ...entry,
        after_hst_amount:
          (cents(entry.amount_before_tax) +
            cents(entry.tax_amount) +
            (allocationBasis === 0 && index === 0 ? taxToAllocate : 0)) /
          100,
      }));
    }

    const shares = invoiceEntries.map((entry) => {
      const rawShare =
        (taxToAllocate * Math.max(0, cents(entry.amount_before_tax))) /
        allocationBasis;
      const baseShare = Math.trunc(rawShare);
      return {
        entry,
        baseShare,
        remainder: Math.abs(rawShare - baseShare),
      };
    });
    const remainder =
      taxToAllocate -
      shares.reduce((total, share) => total + share.baseShare, 0);
    const adjustment = Math.sign(remainder);
    const ordered = [...shares].sort(
      (left, right) =>
        right.remainder - left.remainder ||
        left.entry.line_number - right.entry.line_number ||
        left.entry.id.localeCompare(right.entry.id),
    );
    const adjustmentByEntry = new Map<string, number>();
    for (
      let index = 0;
      index < Math.abs(remainder) && ordered.length;
      index += 1
    ) {
      const entryId = ordered[index % ordered.length]!.entry.id;
      adjustmentByEntry.set(
        entryId,
        (adjustmentByEntry.get(entryId) ?? 0) + adjustment,
      );
    }
    return shares.map(({ entry, baseShare }) => ({
      ...entry,
      after_hst_amount:
        (cents(entry.amount_before_tax) +
          cents(entry.tax_amount) +
          baseShare +
          (adjustmentByEntry.get(entry.id) ?? 0)) /
        100,
    }));
  });
}

export async function getInvoiceEntries(): Promise<InvoiceEntryRecord[]> {
  const supabase = await createClient();
  const [entriesResult, verificationResult] = await Promise.all([
    supabase
      .from("labour_invoice_lines")
      .select(
        `
          id,
          invoice_id,
          line_number,
          entry_type,
          description,
          service_started_on,
          service_ended_on,
          quantity,
          unit,
          unit_price,
          quantity_hours,
          hourly_rate,
          amount_before_tax,
          tax_amount,
          source_kind,
          source_text,
          needs_review,
          labour_invoices (
            id,
            supplier_name,
            invoice_number,
            invoice_date,
            source_date,
            currency,
            amount_before_tax,
            tax_amount,
            amount_paid,
            original_filename,
            duplicate_group_size,
            labour_contractors (
              employee_profiles (
                full_name
              )
            )
          ),
          labour_invoice_line_allocations (
            companycam_project_id,
            allocated_amount,
            allocated_hours,
            needs_review,
            companycam_projects (
              name,
              formatted_address
            )
          )
        `,
      )
      .order("line_number", { ascending: true })
      .limit(2000),
    supabase
      .from("labour_invoice_verification")
      .select(
        "invoice_id,paid_amount,payment_status,verification_status",
      ),
  ]);

  if (entriesResult.error) throw entriesResult.error;
  if (verificationResult.error) throw verificationResult.error;

  const verificationByInvoice = new Map<string, EntryVerification>(
    (verificationResult.data ?? []).map((row) => [
      row.invoice_id,
      {
        paid_amount: Number(row.paid_amount),
        payment_status:
          row.payment_status as EntryVerification["payment_status"],
        verification_status:
          row.verification_status as EntryVerification["verification_status"],
      },
    ]),
  );

  const entries = (entriesResult.data ?? [])
    .map((value): InvoiceEntryRecord | null => {
      const row = value as unknown as StoredEntry;
      if (!row.labour_invoices) return null;
      const verification = verificationByInvoice.get(row.invoice_id);
      const {
        labour_contractors: contractor,
        ...storedInvoice
      } = row.labour_invoices;

      return {
        id: row.id,
        invoice_id: row.invoice_id,
        line_number: row.line_number,
        entry_type: row.entry_type,
        description: row.description,
        service_started_on: row.service_started_on,
        service_ended_on: row.service_ended_on,
        quantity: row.quantity == null ? null : Number(row.quantity),
        unit: row.unit,
        unit_price:
          row.unit_price == null ? null : Number(row.unit_price),
        quantity_hours:
          row.quantity_hours == null ? null : Number(row.quantity_hours),
        hourly_rate:
          row.hourly_rate == null ? null : Number(row.hourly_rate),
        amount_before_tax: Number(row.amount_before_tax),
        tax_amount: Number(row.tax_amount),
        after_hst_amount: 0,
        source_kind: row.source_kind,
        source_text: row.source_text,
        needs_review: row.needs_review,
        invoice: {
          ...storedInvoice,
          amount_before_tax: Number(storedInvoice.amount_before_tax),
          tax_amount: Number(storedInvoice.tax_amount),
          amount_paid: Number(storedInvoice.amount_paid),
          owner_name:
            contractor?.employee_profiles?.full_name ??
            storedInvoice.supplier_name,
          paid_amount: verification?.paid_amount ?? 0,
          payment_status: verification?.payment_status ?? "unpaid",
          verification_status:
            verification?.verification_status ?? "needs_information",
        },
        jobs: row.labour_invoice_line_allocations.map((allocation) => ({
          companycam_project_id: allocation.companycam_project_id,
          allocated_amount: Number(allocation.allocated_amount),
          allocated_hours:
            allocation.allocated_hours == null
              ? null
              : Number(allocation.allocated_hours),
          needs_review: allocation.needs_review,
          name:
            allocation.companycam_projects?.name ??
            allocation.companycam_project_id,
          address:
            allocation.companycam_projects?.formatted_address ?? null,
        })),
      };
    })
    .filter((entry): entry is InvoiceEntryRecord => entry != null);

  return addAfterHstAmounts(entries).sort(
    (left, right) =>
      dateKey(right).localeCompare(dateKey(left)) ||
      right.invoice.invoice_number.localeCompare(
        left.invoice.invoice_number,
        "en-CA",
        { numeric: true },
      ) ||
      left.line_number - right.line_number,
  );
}

export async function getInvoiceEntriesForProject(
  projectId: string,
): Promise<InvoiceEntryRecord[]> {
  return (await getInvoiceEntries()).filter((entry) =>
    entry.jobs.some((job) => job.companycam_project_id === projectId),
  );
}
