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

export type MaterialInvoiceEvidence = {
  id: string;
  documentId: string;
  role: "primary_invoice" | "supporting_batch" | "portal_export";
  label: string;
  sourcePageStart: number | null;
  sourcePageEnd: number | null;
  sourceSystem: string;
  sourceReference: string | null;
  originalFilename: string;
  mimeType: string;
  contentSha256: string;
  storagePath: string;
  signedUrl: string | null;
  pageCount: number | null;
};

export type MaterialPortalRecord = {
  id: string;
  sourceDocumentId: string;
  rowNumber: number;
  invoiceNumber: string;
  invoiceDate: string;
  storeNumber: string;
  poNumber: string | null;
  totalAmount: number;
  portalType: string;
  matchStatus: "matched" | "matched_with_difference";
  matchDifferences: Array<{
    field?: string;
    portal?: unknown;
    physical_invoice?: unknown;
  }>;
};

export type MaterialInvoiceDetail = MaterialInvoiceListRow & {
  accountNumber: string | null;
  dueOn: string | null;
  orderNumber: string | null;
  storeNumber: string | null;
  receivedBy: string | null;
  currency: string;
  extractionStatus: string;
  document: MaterialInvoiceEvidence;
  evidence: MaterialInvoiceEvidence[];
  portalRecord: MaterialPortalRecord | null;
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

export type MaterialPortalEvidenceSummary = {
  totalRows: number;
  matchedRows: number;
  matchedWithDifferenceRows: number;
  sourceMissingRows: number;
  sourceMissingTotal: number;
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

export type ProjectMaterialSummary = {
  amountBeforeTax: number;
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

type PrimaryEvidenceIndexRow = {
  material_invoice_id: string;
  document_id: string;
  material_invoice_documents:
    | { original_filename: string }
    | Array<{ original_filename: string }>
    | null;
};

type RawEvidenceLink = {
  id: string;
  material_invoice_id: string;
  document_id: string;
  evidence_role: MaterialInvoiceEvidence["role"];
  source_page_start: number | null;
  source_page_end: number | null;
  evidence_label: string;
  material_invoice_documents:
    | {
        id: string;
        source_system: string;
        source_reference: string | null;
        original_filename: string;
        mime_type: string;
        content_sha256: string;
        storage_bucket: string;
        storage_path: string;
        page_count: number | null;
      }
    | Array<{
        id: string;
        source_system: string;
        source_reference: string | null;
        original_filename: string;
        mime_type: string;
        content_sha256: string;
        storage_bucket: string;
        storage_path: string;
        page_count: number | null;
      }>
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
  const [verificationRows, headerRows, allocationRows, primaryEvidenceRows] = await Promise.all([
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
    fetchAll<PrimaryEvidenceIndexRow>(() =>
      supabase
        .from("material_invoice_evidence_links")
        .select(
          "material_invoice_id,document_id,material_invoice_documents(original_filename)",
        )
        .eq("evidence_role", "primary_invoice"),
    ),
  ]);

  const primaryFilenameByInvoice = new Map(
    primaryEvidenceRows.map((row) => [
      row.material_invoice_id,
      one(row.material_invoice_documents)?.original_filename ?? "Invoice-specific PDF",
    ]),
  );
  const primaryDocumentIdByInvoice = new Map(
    primaryEvidenceRows.map((row) => [row.material_invoice_id, row.document_id]),
  );

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
    documentId:
      primaryDocumentIdByInvoice.get(row.material_invoice_id) ??
      documentIdByInvoice.get(row.material_invoice_id) ??
      row.material_invoice_id,
    documentFilename:
      primaryFilenameByInvoice.get(row.material_invoice_id) ??
      filenameByInvoice.get(row.material_invoice_id) ??
      "Archived invoice",
    jobs: [...(jobsByInvoice.get(row.material_invoice_id) ?? new Map()).entries()].map(
      ([id, name]) => ({ id, name }),
    ),
    overheadCategories: [
      ...(overheadByInvoice.get(row.material_invoice_id) ?? new Set()),
    ],
  }));
}

export async function getMaterialPortalEvidenceSummary(): Promise<MaterialPortalEvidenceSummary> {
  const supabase = await createClient();
  const rows = await fetchAll<{
    match_status: "matched" | "matched_with_difference" | "source_missing";
    total_amount: number;
  }>(() =>
    supabase
      .from("material_supplier_portal_records")
      .select("match_status,total_amount"),
  );
  return {
    totalRows: rows.length,
    matchedRows: rows.filter((row) => row.match_status === "matched").length,
    matchedWithDifferenceRows: rows.filter(
      (row) => row.match_status === "matched_with_difference",
    ).length,
    sourceMissingRows: rows.filter((row) => row.match_status === "source_missing").length,
    sourceMissingTotal: rows
      .filter((row) => row.match_status === "source_missing")
      .reduce((sum, row) => sum + Number(row.total_amount), 0),
  };
}

export async function getMaterialInvoice(
  invoiceId: string,
): Promise<MaterialInvoiceDetail | null> {
  const supabase = await createClient();
  const [
    invoiceResult,
    verificationResult,
    linesResult,
    paymentsResult,
    creditsInResult,
    creditsOutResult,
    evidenceResult,
    portalResult,
  ] =
    await Promise.all([
      supabase
        .from("material_invoices")
        .select(
          "*,material_invoice_documents(id,source_system,source_reference,original_filename,mime_type,content_sha256,storage_bucket,storage_path,page_count)",
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
      supabase
        .from("material_invoice_evidence_links")
        .select(
          "id,material_invoice_id,document_id,evidence_role,source_page_start,source_page_end,evidence_label,material_invoice_documents(id,source_system,source_reference,original_filename,mime_type,content_sha256,storage_bucket,storage_path,page_count)",
        )
        .eq("material_invoice_id", invoiceId)
        .order("evidence_role"),
      supabase
        .from("material_supplier_portal_records")
        .select(
          "id,source_document_id,source_row_number,invoice_number,transaction_date,store_number,po_number,total_amount,portal_type,match_status,match_differences",
        )
        .eq("material_invoice_id", invoiceId)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  for (const result of [
    invoiceResult,
    verificationResult,
    linesResult,
    paymentsResult,
    creditsInResult,
    creditsOutResult,
    evidenceResult,
    portalResult,
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
  const rawEvidenceLinks = (evidenceResult.data ?? []) as unknown as RawEvidenceLink[];
  const evidenceLinks = rawEvidenceLinks.length
    ? rawEvidenceLinks
    : [
        {
          id: `fallback-${invoiceId}`,
          material_invoice_id: invoiceId,
          document_id: String(rawDocument.id),
          evidence_role: "primary_invoice" as const,
          source_page_start:
            rawInvoice.source_page_start == null ? null : Number(rawInvoice.source_page_start),
          source_page_end:
            rawInvoice.source_page_end == null ? null : Number(rawInvoice.source_page_end),
          evidence_label: "Archived supplier document",
          material_invoice_documents: rawDocument as RawEvidenceLink["material_invoice_documents"],
        },
      ];
  const signedEvidence = await Promise.all(
    evidenceLinks.map(async (link) => {
      const document = one(link.material_invoice_documents);
      if (!document) return null;
      const signed = await supabase.storage
        .from(String(document.storage_bucket))
        .createSignedUrl(String(document.storage_path), 60 * 60);
      return {
        id: link.id,
        documentId: document.id,
        role: link.evidence_role,
        label: link.evidence_label,
        sourcePageStart: link.source_page_start,
        sourcePageEnd: link.source_page_end,
        sourceSystem: document.source_system,
        sourceReference: document.source_reference,
        originalFilename: document.original_filename,
        mimeType: document.mime_type,
        contentSha256: document.content_sha256,
        storagePath: document.storage_path,
        signedUrl: signed.data?.signedUrl ?? null,
        pageCount: document.page_count == null ? null : Number(document.page_count),
      } satisfies MaterialInvoiceEvidence;
    }),
  );
  const evidence = signedEvidence.filter(
    (item): item is MaterialInvoiceEvidence => item != null,
  );
  const primaryEvidence =
    evidence.find((item) => item.role === "primary_invoice") ?? evidence[0];
  if (!primaryEvidence) return null;

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
    documentId: primaryEvidence.documentId,
    documentFilename: primaryEvidence.originalFilename,
    jobs: [...jobs.entries()].map(([id, name]) => ({ id, name })),
    overheadCategories: [...overhead],
    accountNumber: String(rawInvoice.account_number ?? "") || null,
    dueOn: String(rawInvoice.due_on ?? "") || null,
    orderNumber: String(rawInvoice.order_number ?? "") || null,
    storeNumber: String(rawInvoice.store_number ?? "") || null,
    receivedBy: String(rawInvoice.received_by ?? "") || null,
    currency: String(rawInvoice.currency ?? "CAD"),
    extractionStatus: String(rawInvoice.extraction_status ?? "needs_review"),
    document: primaryEvidence,
    evidence,
    portalRecord: portalResult.data
      ? {
          id: portalResult.data.id,
          sourceDocumentId: portalResult.data.source_document_id,
          rowNumber: Number(portalResult.data.source_row_number),
          invoiceNumber: portalResult.data.invoice_number,
          invoiceDate: portalResult.data.transaction_date,
          storeNumber: portalResult.data.store_number,
          poNumber: portalResult.data.po_number,
          totalAmount: Number(portalResult.data.total_amount),
          portalType: portalResult.data.portal_type,
          matchStatus: portalResult.data.match_status as MaterialPortalRecord["matchStatus"],
          matchDifferences: Array.isArray(portalResult.data.match_differences)
            ? (portalResult.data.match_differences as MaterialPortalRecord["matchDifferences"])
            : [],
        }
      : null,
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

export async function getProjectMaterialSummaries(): Promise<
  Map<string, ProjectMaterialSummary>
> {
  const supabase = await createClient();
  const allocations = await fetchAll<{
    companycam_project_id: string | null;
    allocated_before_tax: number;
  }>(() =>
    supabase
      .from("material_invoice_line_allocations")
      .select("companycam_project_id,allocated_before_tax")
      .eq("allocation_scope", "job")
      .not("companycam_project_id", "is", null)
      .is("reversed_at", null),
  );

  const summaries = new Map<string, ProjectMaterialSummary>();
  for (const allocation of allocations) {
    const projectId = allocation.companycam_project_id;
    if (!projectId) continue;
    const current = summaries.get(projectId) ?? {
      amountBeforeTax: 0,
      lineCount: 0,
    };
    current.amountBeforeTax += Number(allocation.allocated_before_tax);
    current.lineCount += 1;
    summaries.set(projectId, current);
  }
  return summaries;
}
