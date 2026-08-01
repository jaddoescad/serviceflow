import { createClient } from "@/lib/supabase/server";

export type MaterialVerificationStatus =
  | "verified"
  | "unpaid"
  | "unapplied_credit"
  | "needs_review";

export type MaterialInvoiceListRow = {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceType: "charge_invoice" | "cash_receipt" | "return" | "credit_memo";
  invoiceDate: string;
  poNumber: string | null;
  amountBeforeTax: number;
  taxAmount: number;
  totalAmount: number;
  lineCount: number;
  jobCount: number;
  jobAllocatedTotal: number;
  paidAmount: number;
  creditAppliedAmount: number;
  creditUsedAmount: number;
  amountRemaining: number;
  verificationStatus: MaterialVerificationStatus;
  documentId: string;
  documentFilename: string;
  jobs: Array<{ id: string; name: string }>;
  overheadCategories: string[];
};

export type MaterialLineAllocation = {
  id: string;
  scope: "job" | "overhead";
  projectId: string | null;
  projectName: string | null;
  overheadCategory: string | null;
  amountBeforeTax: number;
  taxAmount: number;
  totalAmount: number;
  method: string;
  evidenceReference: string | null;
};

export type MaterialInvoiceLine = {
  id: string;
  lineNumber: number;
  salesNumber: string | null;
  size: string | null;
  productCode: string | null;
  description: string;
  colorCode: string | null;
  colorName: string | null;
  quantity: number | null;
  unitPrice: number | null;
  grossAmount: number;
  discountAmount: number;
  amountBeforeTax: number;
  taxAmount: number;
  totalAmount: number;
  needsReview: boolean;
  allocations: MaterialLineAllocation[];
};

export type MaterialInvoiceDetail = MaterialInvoiceListRow & {
  accountNumber: string | null;
  dueOn: string | null;
  orderNumber: string | null;
  storeNumber: string | null;
  receivedBy: string | null;
  currency: string;
  extractionStatus: string;
  document: {
    id: string;
    sourceReference: string | null;
    originalFilename: string;
    contentSha256: string;
    storagePath: string;
    signedUrl: string | null;
    pageCount: number | null;
  };
  lines: MaterialInvoiceLine[];
  payments: Array<{
    id: string;
    transactionId: string;
    postedOn: string;
    counterparty: string | null;
    description: string;
    bankAmount: number;
    allocatedAmount: number;
    evidenceReference: string | null;
  }>;
  creditsIn: Array<{
    id: string;
    creditInvoiceId: string;
    creditInvoiceNumber: string;
    creditInvoiceDate: string;
    allocatedAmount: number;
    evidenceReference: string | null;
  }>;
  creditsOut: Array<{
    id: string;
    chargeInvoiceId: string;
    chargeInvoiceNumber: string;
    chargeInvoiceDate: string;
    allocatedAmount: number;
    evidenceReference: string | null;
  }>;
};

export type MaterialPaymentVerificationSummary = {
  invoice_count: number;
  payment_amount: number;
  allocated_amount: number;
  unallocated_amount: number;
  payment_status:
    | "unmatched"
    | "partially_allocated"
    | "fully_allocated"
    | "needs_review";
};

export type MaterialPaymentEvidence = {
  verification: MaterialPaymentVerificationSummary;
  invoices: Array<{
    id: string;
    supplierName: string;
    invoiceNumber: string;
    invoiceDate: string;
    poNumber: string | null;
    totalAmount: number;
    allocatedAmount: number;
    evidenceReference: string | null;
    documentFilename: string;
  }>;
  statements: Array<{
    id: string;
    date: string | null;
    filename: string;
    signedUrl: string | null;
  }>;
};

export type ProjectMaterialInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierName: string;
  poNumber: string | null;
  documentFilename: string;
  amountBeforeTax: number;
  taxAmount: number;
  totalAmount: number;
  lineCount: number;
};

async function fetchAll<T>(
  queryFactory: () => {
    range: (from: number, to: number) => PromiseLike<{
      data: T[] | null;
      error: { message: string } | null;
    }>;
  },
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await queryFactory().range(
      page * pageSize,
      page * pageSize + pageSize - 1,
    );
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Material query exceeded 100,000 rows.");
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type VerificationRow = {
  material_invoice_id: string;
  supplier_name: string;
  invoice_number: string;
  invoice_type: MaterialInvoiceListRow["invoiceType"];
  invoice_date: string;
  po_number: string | null;
  amount_before_tax: number;
  tax_amount: number;
  total_amount: number;
  line_count: number;
  job_count: number;
  job_allocated_total: number;
  paid_amount: number;
  credit_applied_amount: number;
  credit_used_amount: number;
  amount_remaining: number;
  verification_status: MaterialVerificationStatus;
};

type InvoiceHeaderRow = {
  id: string;
  document_id: string;
  material_invoice_documents:
    | { original_filename: string }
    | Array<{ original_filename: string }>
    | null;
};

type AllocationIndexRow = {
  allocation_scope: "job" | "overhead";
  companycam_project_id: string | null;
  overhead_category: string | null;
  companycam_projects:
    | { name: string }
    | Array<{ name: string }>
    | null;
  material_invoice_lines:
    | { material_invoice_id: string }
    | Array<{ material_invoice_id: string }>
    | null;
};

type RawLineAllocation = {
  id: string;
  allocation_scope: "job" | "overhead";
  companycam_project_id: string | null;
  overhead_category: string | null;
  allocated_before_tax: number;
  allocated_tax: number;
  allocated_total: number;
  allocation_method: string;
  evidence_reference: string | null;
  reversed_at: string | null;
  companycam_projects:
    | { name: string }
    | Array<{ name: string }>
    | null;
};

export async function getMaterialInvoices(): Promise<MaterialInvoiceListRow[]> {
  const supabase = await createClient();
  const [verificationRows, headerRows, allocationRows] = await Promise.all([
    fetchAll<VerificationRow>(() =>
      supabase
        .from("material_invoice_verification")
        .select("*")
        .order("invoice_date", { ascending: false })
        .order("invoice_number", { ascending: false }),
    ),
    fetchAll<InvoiceHeaderRow>(() =>
      supabase
        .from("material_invoices")
        .select("id,document_id,material_invoice_documents(original_filename)"),
    ),
    fetchAll<AllocationIndexRow>(() =>
      supabase
        .from("material_invoice_line_allocations")
        .select(
          "allocation_scope,companycam_project_id,overhead_category,companycam_projects(name),material_invoice_lines!inner(material_invoice_id)",
        )
        .is("reversed_at", null),
    ),
  ]);

  const filenameByInvoice = new Map(
    headerRows.map((row) => [
      row.id,
      one(row.material_invoice_documents)?.original_filename ?? "Archived invoice",
    ]),
  );
  const documentIdByInvoice = new Map(
    headerRows.map((row) => [row.id, row.document_id]),
  );
  const jobsByInvoice = new Map<string, Map<string, string>>();
  const overheadByInvoice = new Map<string, Set<string>>();
  for (const allocation of allocationRows) {
    const invoiceId = one(allocation.material_invoice_lines)?.material_invoice_id;
    if (!invoiceId) continue;
    if (allocation.companycam_project_id) {
      const jobs = jobsByInvoice.get(invoiceId) ?? new Map<string, string>();
      jobs.set(
        allocation.companycam_project_id,
        one(allocation.companycam_projects)?.name ?? allocation.companycam_project_id,
      );
      jobsByInvoice.set(invoiceId, jobs);
    } else if (allocation.overhead_category) {
      const categories = overheadByInvoice.get(invoiceId) ?? new Set<string>();
      categories.add(allocation.overhead_category);
      overheadByInvoice.set(invoiceId, categories);
    }
  }

  return verificationRows.map((row) => ({
    id: row.material_invoice_id,
    supplierName: row.supplier_name,
    invoiceNumber: row.invoice_number,
    invoiceType: row.invoice_type,
    invoiceDate: row.invoice_date,
    poNumber: row.po_number,
    amountBeforeTax: Number(row.amount_before_tax),
    taxAmount: Number(row.tax_amount),
    totalAmount: Number(row.total_amount),
    lineCount: Number(row.line_count),
    jobCount: Number(row.job_count),
    jobAllocatedTotal: Number(row.job_allocated_total),
    paidAmount: Number(row.paid_amount),
    creditAppliedAmount: Number(row.credit_applied_amount),
    creditUsedAmount: Number(row.credit_used_amount),
    amountRemaining: Number(row.amount_remaining),
    verificationStatus: row.verification_status,
    documentId: documentIdByInvoice.get(row.material_invoice_id) ?? row.material_invoice_id,
    documentFilename: filenameByInvoice.get(row.material_invoice_id) ?? "Archived invoice",
    jobs: [...(jobsByInvoice.get(row.material_invoice_id) ?? new Map()).entries()].map(
      ([id, name]) => ({ id, name }),
    ),
    overheadCategories: [
      ...(overheadByInvoice.get(row.material_invoice_id) ?? new Set()),
    ],
  }));
}

export async function getMaterialInvoice(
  invoiceId: string,
): Promise<MaterialInvoiceDetail | null> {
  const supabase = await createClient();
  const [invoiceResult, verificationResult, linesResult, paymentsResult, creditsInResult, creditsOutResult] =
    await Promise.all([
      supabase
        .from("material_invoices")
        .select(
          "*,material_invoice_documents(id,source_reference,original_filename,content_sha256,storage_bucket,storage_path,page_count)",
        )
        .eq("id", invoiceId)
        .maybeSingle(),
      supabase
        .from("material_invoice_verification")
        .select("*")
        .eq("material_invoice_id", invoiceId)
        .maybeSingle(),
      supabase
        .from("material_invoice_lines")
        .select(
          "*,material_invoice_line_allocations(id,allocation_scope,companycam_project_id,overhead_category,allocated_before_tax,allocated_tax,allocated_total,allocation_method,evidence_reference,reversed_at,companycam_projects(name))",
        )
        .eq("material_invoice_id", invoiceId)
        .order("line_number"),
      supabase
        .from("material_payment_allocations")
        .select(
          "id,financial_transaction_id,allocated_amount,evidence_reference,financial_transactions(posted_on,counterparty,description,amount)",
        )
        .eq("material_invoice_id", invoiceId)
        .is("reversed_at", null),
      supabase
        .from("material_credit_allocations")
        .select("id,credit_material_invoice_id,allocated_amount,evidence_reference")
        .eq("charge_material_invoice_id", invoiceId)
        .is("reversed_at", null),
      supabase
        .from("material_credit_allocations")
        .select("id,charge_material_invoice_id,allocated_amount,evidence_reference")
        .eq("credit_material_invoice_id", invoiceId)
        .is("reversed_at", null),
    ]);
  for (const result of [
    invoiceResult,
    verificationResult,
    linesResult,
    paymentsResult,
    creditsInResult,
    creditsOutResult,
  ]) {
    if (result.error) throw result.error;
  }
  if (!invoiceResult.data || !verificationResult.data) return null;

  const rawInvoice = invoiceResult.data as unknown as Record<string, unknown>;
  const rawVerification = verificationResult.data as unknown as VerificationRow;
  const rawDocument = one(
    rawInvoice.material_invoice_documents as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | null,
  );
  if (!rawDocument) return null;
  const signed = await supabase.storage
    .from(String(rawDocument.storage_bucket))
    .createSignedUrl(String(rawDocument.storage_path), 60 * 60);

  const creditInvoiceIds = (creditsInResult.data ?? []).map(
    (row) => row.credit_material_invoice_id,
  );
  const chargeInvoiceIds = (creditsOutResult.data ?? []).map(
    (row) => row.charge_material_invoice_id,
  );
  const relatedIds = [...new Set([...creditInvoiceIds, ...chargeInvoiceIds])];
  const relatedResult = relatedIds.length
    ? await supabase
        .from("material_invoices")
        .select("id,invoice_number,invoice_date")
        .in("id", relatedIds)
    : { data: [], error: null };
  if (relatedResult.error) throw relatedResult.error;
  const relatedById = new Map((relatedResult.data ?? []).map((row) => [row.id, row]));

  const lines = (linesResult.data ?? []).map((line) => {
    const rawAllocations = (line.material_invoice_line_allocations ?? []) as RawLineAllocation[];
    return {
      id: line.id,
      lineNumber: Number(line.line_number),
      salesNumber: line.sales_number,
      size: line.size,
      productCode: line.product_code,
      description: line.description,
      colorCode: line.color_code,
      colorName: line.color_name,
      quantity: line.quantity == null ? null : Number(line.quantity),
      unitPrice: line.unit_price == null ? null : Number(line.unit_price),
      grossAmount: Number(line.gross_amount),
      discountAmount: Number(line.discount_amount),
      amountBeforeTax: Number(line.amount_before_tax),
      taxAmount: Number(line.tax_amount),
      totalAmount: Number(line.total_amount),
      needsReview: line.needs_review,
      allocations: rawAllocations
        .filter((allocation) => allocation.reversed_at == null)
        .map((allocation) => ({
          id: allocation.id,
          scope: allocation.allocation_scope,
          projectId: allocation.companycam_project_id,
          projectName: one(allocation.companycam_projects)?.name ?? null,
          overheadCategory: allocation.overhead_category,
          amountBeforeTax: Number(allocation.allocated_before_tax),
          taxAmount: Number(allocation.allocated_tax),
          totalAmount: Number(allocation.allocated_total),
          method: allocation.allocation_method,
          evidenceReference: allocation.evidence_reference,
        })),
    };
  }) as MaterialInvoiceLine[];
  const jobs = new Map<string, string>();
  const overhead = new Set<string>();
  for (const line of lines) {
    for (const allocation of line.allocations) {
      if (allocation.projectId) jobs.set(allocation.projectId, allocation.projectName ?? allocation.projectId);
      if (allocation.overheadCategory) overhead.add(allocation.overheadCategory);
    }
  }

  return {
    id: invoiceId,
    supplierName: rawVerification.supplier_name,
    invoiceNumber: rawVerification.invoice_number,
    invoiceType: rawVerification.invoice_type,
    invoiceDate: rawVerification.invoice_date,
    poNumber: rawVerification.po_number,
    amountBeforeTax: Number(rawVerification.amount_before_tax),
    taxAmount: Number(rawVerification.tax_amount),
    totalAmount: Number(rawVerification.total_amount),
    lineCount: Number(rawVerification.line_count),
    jobCount: Number(rawVerification.job_count),
    jobAllocatedTotal: Number(rawVerification.job_allocated_total),
    paidAmount: Number(rawVerification.paid_amount),
    creditAppliedAmount: Number(rawVerification.credit_applied_amount),
    creditUsedAmount: Number(rawVerification.credit_used_amount),
    amountRemaining: Number(rawVerification.amount_remaining),
    verificationStatus: rawVerification.verification_status,
    documentId: String(rawDocument.id),
    documentFilename: String(rawDocument.original_filename),
    jobs: [...jobs.entries()].map(([id, name]) => ({ id, name })),
    overheadCategories: [...overhead],
    accountNumber: String(rawInvoice.account_number ?? "") || null,
    dueOn: String(rawInvoice.due_on ?? "") || null,
    orderNumber: String(rawInvoice.order_number ?? "") || null,
    storeNumber: String(rawInvoice.store_number ?? "") || null,
    receivedBy: String(rawInvoice.received_by ?? "") || null,
    currency: String(rawInvoice.currency ?? "CAD"),
    extractionStatus: String(rawInvoice.extraction_status ?? "needs_review"),
    document: {
      id: String(rawDocument.id),
      sourceReference: String(rawDocument.source_reference ?? "") || null,
      originalFilename: String(rawDocument.original_filename),
      contentSha256: String(rawDocument.content_sha256),
      storagePath: String(rawDocument.storage_path),
      signedUrl: signed.data?.signedUrl ?? null,
      pageCount: rawDocument.page_count == null ? null : Number(rawDocument.page_count),
    },
    lines,
    payments: (paymentsResult.data ?? []).map((payment) => {
      const transaction = one(payment.financial_transactions);
      return {
        id: payment.id,
        transactionId: payment.financial_transaction_id,
        postedOn: transaction?.posted_on ?? "",
        counterparty: transaction?.counterparty ?? null,
        description: transaction?.description ?? "Bank payment",
        bankAmount: Math.abs(Number(transaction?.amount ?? 0)),
        allocatedAmount: Number(payment.allocated_amount),
        evidenceReference: payment.evidence_reference,
      };
    }),
    creditsIn: (creditsInResult.data ?? []).map((credit) => {
      const related = relatedById.get(credit.credit_material_invoice_id);
      return {
        id: credit.id,
        creditInvoiceId: credit.credit_material_invoice_id,
        creditInvoiceNumber: related?.invoice_number ?? "Unknown",
        creditInvoiceDate: related?.invoice_date ?? "",
        allocatedAmount: Number(credit.allocated_amount),
        evidenceReference: credit.evidence_reference,
      };
    }),
    creditsOut: (creditsOutResult.data ?? []).map((credit) => {
      const related = relatedById.get(credit.charge_material_invoice_id);
      return {
        id: credit.id,
        chargeInvoiceId: credit.charge_material_invoice_id,
        chargeInvoiceNumber: related?.invoice_number ?? "Unknown",
        chargeInvoiceDate: related?.invoice_date ?? "",
        allocatedAmount: Number(credit.allocated_amount),
        evidenceReference: credit.evidence_reference,
      };
    }),
  };
}

export async function getMaterialPaymentEvidence(
  transactionId: string,
): Promise<MaterialPaymentEvidence | null> {
  const supabase = await createClient();
  const [verificationResult, allocationsResult] = await Promise.all([
    supabase
      .from("material_payment_verification")
      .select("*")
      .eq("financial_transaction_id", transactionId)
      .maybeSingle(),
    supabase
      .from("material_payment_allocations")
      .select(
        "id,allocated_amount,evidence_reference,source_payload,material_invoices(id,supplier_name,invoice_number,invoice_date,po_number,total_amount,material_invoice_documents(original_filename))",
      )
      .eq("financial_transaction_id", transactionId)
      .is("reversed_at", null),
  ]);
  if (verificationResult.error) throw verificationResult.error;
  if (allocationsResult.error) throw allocationsResult.error;
  if (!verificationResult.data) return null;

  const statementIds = [
    ...new Set(
      (allocationsResult.data ?? [])
        .map((allocation) => allocation.source_payload?.statement_document_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const statementResult = statementIds.length
    ? await supabase
        .from("material_invoice_documents")
        .select("id,document_date,original_filename,storage_path")
        .in("id", statementIds)
    : { data: [], error: null };
  if (statementResult.error) throw statementResult.error;
  const signedStatements = statementResult.data?.length
    ? await supabase.storage
        .from("material-invoices")
        .createSignedUrls(
          statementResult.data.map((document) => document.storage_path),
          60 * 60,
        )
    : { data: [], error: null };
  const signedByPath = new Map(
    (signedStatements.data ?? []).map((item) => [item.path, item.signedUrl]),
  );
  const verification = verificationResult.data;

  return {
    verification: {
      invoice_count: Number(verification.invoice_count),
      payment_amount: Number(verification.payment_amount),
      allocated_amount: Number(verification.allocated_amount),
      unallocated_amount: Number(verification.unallocated_amount),
      payment_status: verification.payment_status,
    },
    invoices: (allocationsResult.data ?? []).map((allocation) => {
      const invoice = one(allocation.material_invoices);
      const document = one(invoice?.material_invoice_documents);
      return {
        id: invoice?.id ?? "",
        supplierName: invoice?.supplier_name ?? "Material supplier",
        invoiceNumber: invoice?.invoice_number ?? "Unknown",
        invoiceDate: invoice?.invoice_date ?? "",
        poNumber: invoice?.po_number ?? null,
        totalAmount: Number(invoice?.total_amount ?? 0),
        allocatedAmount: Number(allocation.allocated_amount),
        evidenceReference: allocation.evidence_reference,
        documentFilename: document?.original_filename ?? "Archived invoice",
      };
    }),
    statements: (statementResult.data ?? []).map((document) => ({
      id: document.id,
      date: document.document_date,
      filename: document.original_filename,
      signedUrl: signedByPath.get(document.storage_path) ?? null,
    })),
  };
}

export async function getProjectMaterialInvoices(
  projectId: string,
): Promise<ProjectMaterialInvoice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_invoice_line_allocations")
    .select(
      "allocated_before_tax,allocated_tax,allocated_total,material_invoice_lines!inner(id,material_invoices!inner(id,invoice_number,invoice_date,supplier_name,po_number,material_invoice_documents(original_filename)))",
    )
    .eq("companycam_project_id", projectId)
    .is("reversed_at", null);
  if (error) throw error;

  const grouped = new Map<string, ProjectMaterialInvoice>();
  for (const allocation of data ?? []) {
    const line = one(allocation.material_invoice_lines);
    const invoice = one(line?.material_invoices);
    if (!invoice) continue;
    const document = one(invoice.material_invoice_documents);
    const current = grouped.get(invoice.id) ?? {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.invoice_date,
      supplierName: invoice.supplier_name,
      poNumber: invoice.po_number,
      documentFilename: document?.original_filename ?? "Archived invoice",
      amountBeforeTax: 0,
      taxAmount: 0,
      totalAmount: 0,
      lineCount: 0,
    };
    current.amountBeforeTax += Number(allocation.allocated_before_tax);
    current.taxAmount += Number(allocation.allocated_tax);
    current.totalAmount += Number(allocation.allocated_total);
    current.lineCount += 1;
    grouped.set(invoice.id, current);
  }
  return [...grouped.values()].sort(
    (left, right) =>
      right.invoiceDate.localeCompare(left.invoiceDate) ||
      right.invoiceNumber.localeCompare(left.invoiceNumber, "en-CA", {
        numeric: true,
      }),
  );
}
