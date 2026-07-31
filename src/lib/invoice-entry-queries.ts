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
    amount_after_tax: number;
    document_type: string;
    match_status: string;
    original_filename: string;
    duplicate_group_id: string | null;
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
        | "amount_after_tax"
        | "paid_amount"
        | "payment_status"
        | "verification_status"
      > & {
        amount_paid: number;
        document_type: string;
        match_status: string;
        duplicate_group_id: string | null;
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

function currentInvoiceIds(rows: StoredEntry[]): Set<string> {
  const currentByGroup = new Map<
    string,
    NonNullable<StoredEntry["labour_invoices"]>
  >();

  for (const row of rows) {
    const invoice = row.labour_invoices;
    if (
      !invoice ||
      invoice.document_type !== "invoice" ||
      invoice.match_status === "supporting_document"
    ) {
      continue;
    }

    const groupId = invoice.duplicate_group_id ?? invoice.id;
    const current = currentByGroup.get(groupId);
    if (!current) {
      currentByGroup.set(groupId, invoice);
      continue;
    }

    const invoiceDate = invoice.source_date ?? invoice.invoice_date ?? "";
    const currentDate = current.source_date ?? current.invoice_date ?? "";
    const invoiceAmount = Number(invoice.amount_paid ?? 0);
    const currentAmount = Number(current.amount_paid ?? 0);
    if (
      invoiceDate > currentDate ||
      (invoiceDate === currentDate &&
        (invoiceAmount > currentAmount ||
          (invoiceAmount === currentAmount && invoice.id > current.id)))
    ) {
      currentByGroup.set(groupId, invoice);
    }
  }

  return new Set([...currentByGroup.values()].map((invoice) => invoice.id));
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
            document_type,
            match_status,
            original_filename,
            duplicate_group_id,
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

  const storedEntries = (entriesResult.data ?? []) as unknown as StoredEntry[];
  const visibleInvoiceIds = currentInvoiceIds(storedEntries);
  const entries = storedEntries
    .filter((row) => visibleInvoiceIds.has(row.invoice_id))
    .map((value): InvoiceEntryRecord | null => {
      const row = value;
      if (!row.labour_invoices) return null;
      const verification = verificationByInvoice.get(row.invoice_id);
      const {
        labour_contractors: contractor,
        amount_paid: amountAfterTax,
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
        source_kind: row.source_kind,
        source_text: row.source_text,
        needs_review: row.needs_review,
        invoice: {
          ...storedInvoice,
          amount_before_tax: Number(storedInvoice.amount_before_tax),
          tax_amount: Number(storedInvoice.tax_amount),
          amount_after_tax: Number(amountAfterTax),
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

  return entries.sort(
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
