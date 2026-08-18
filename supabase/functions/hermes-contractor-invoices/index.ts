import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ServiceClient = SupabaseClient;
type HttpError = Error & { status: number };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-hermes-time-entry-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const hermesTokenSha256 = "c08f7622874a39026eddde86a38ab505cbbcbb16be0118dab6f61392329bb388";
const sourceSystem = "gmail_contractor_invoice";
const storageBucket = "labour-invoices";
const maximumDocumentBytes = 5_000_000;
const historicalCutoff = "2026-06-01";
const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const itemMatchTypes = new Set(["name", "address", "proposal", "company", "unassigned"]);
const trustedInvoicePlatforms = new Map([
  ["mailer@waveapps.com", ["waveapps.com"]],
  ["quickbooks@notification.intuit.com", ["notification.intuit.com", "intuit.com"]],
  ["notification@msg.getjobber.com", ["msg.getjobber.com", "getjobber.com"]],
]);
const trustedDirectAliases = new Map([
  ["hello@grutenco.ca", { contactName: "Grutenco Painting & Construction Services", evidenceTerms: ["grutenco"] }],
]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    await authorize(request);
    const body = await parseBody(request);
    if (body.action !== "importContractorInvoice") throw httpError("Unsupported action", 400);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw httpError("Missing Supabase service environment", 500);
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    return json(await importContractorInvoice(supabase, body));
  } catch (error) {
    const selected = error as Partial<HttpError>;
    return json({ error: selected.message || "Request failed" }, Number(selected.status || 500));
  }
});

async function importContractorInvoice(supabase: ServiceClient, body: Record<string, unknown>) {
  const messageId = boundedText(body.message_id, "message_id", 225, /^[A-Za-z0-9_-]{5,225}$/);
  const attachmentIndex = boundedInteger(body.attachment_index, "attachment_index", 1, 5);
  const filename = boundedText(body.filename, "filename", 240);
  const mimeType = boundedText(body.mime_type, "mime_type", 80).toLowerCase();
  if (!allowedMimeTypes.has(mimeType)) throw httpError("Unsupported attachment type", 400);
  const bytes = decodeDocument(body.document_base64);
  if (!validMagicBytes(bytes, mimeType)) throw httpError("Attachment signature does not match its approved type", 400);
  const attachmentText = boundedEvidence(body.attachment_text, "attachment_text", 10_000);
  const invoice = verifyInvoiceDecision({
    evidence: attachmentText,
    filename,
    invoiceNumber: body.invoice_number,
    issuedOn: body.issued_on,
    subtotalCents: body.subtotal_cents,
    taxCents: body.tax_cents,
    totalCents: body.total_cents,
  });
  const items = verifyInvoiceItems(body.items, attachmentText, invoice);
  const contentSha256 = await sha256Hex(bytes);
  const documentId = await stableUuid(`document:sha256:${contentSha256}`);
  const invoiceId = await stableUuid(`invoice:${sourceSystem}:sha256:${contentSha256}`);
  const evidenceId = await stableUuid(`evidence-link:${documentId}:invoice:${invoiceId}`);
  const verificationId = await stableUuid(`verification:${sourceSystem}:${invoiceId}:imported`);

  const { data: existing, error: existingError } = await supabase
    .from("invoices")
    .select("id,category,direction,contact_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (existingError) throw httpError(existingError.message, 500);
  if (existing) {
    if (existing.category !== "labour" || existing.direction !== "payable") throw httpError("Document hash is already attached to an incompatible invoice", 409);
    return { status: "already_imported", invoice_id: existing.id, document_id: documentId };
  }

  const message = {
    from: optionalBoundedText(body.from, 500),
    replyTo: optionalBoundedText(body.reply_to, 500),
    subject: optionalBoundedText(body.subject, 500),
    authenticationResults: optionalBoundedText(body.authentication_results, 4_000),
  };
  const contractorMatch = await resolveContractorIdentity(supabase, message, attachmentText);
  if (!contractorMatch) throw httpError("Contractor could not be independently matched from the authenticated sender and attachment evidence", 422);
  const jobsResult = await supabase.from("jobs").select("id,name,formatted_address,status,started_on,completed_on,archived_at,metadata").limit(5000);
  if (jobsResult.error) throw httpError(jobsResult.error.message, 500);
  const itemPlans = await Promise.all(items.map(async (item, index) => {
    const job = exactCurrentJobForItem(jobsResult.data || [], item);
    return { item, job, lineId: await stableUuid(`invoice-line:${invoiceId}:${index + 1}`), lineNumber: index + 1 };
  }));
  const assignedCount = itemPlans.filter((plan) => plan.job).length;
  const companyCount = itemPlans.filter((plan) => plan.item.match_type === "company").length;
  const unassignedCount = itemPlans.length - assignedCount - companyCount;

  const storagePath = `gmail-contractor-invoices/${invoice.issuedOn}/${contentSha256.slice(0, 16)}-${safeFilename(filename)}`;
  const upload = await supabase.storage.from(storageBucket).upload(storagePath, bytes, { contentType: mimeType, upsert: true });
  if (upload.error) throw httpError(upload.error.message, 500);
  const nowIso = new Date().toISOString();
  const receivedAt = optionalIso(body.received_at) || nowIso;

  await upsert(supabase, "documents", {
    id: documentId,
    kind: "labour_invoice",
    original_filename: filename,
    mime_type: mimeType,
    size_bytes: bytes.length,
    content_sha256: contentSha256,
    storage_bucket: storageBucket,
    storage_path: storagePath,
    source_url: `https://mail.google.com/mail/u/0/#all/${messageId}`,
    captured_at: receivedAt,
    metadata: {
      source: sourceSystem,
      gmail_message_id: messageId,
      attachment_index: attachmentIndex,
      sender_email: contractorMatch.senderEmail,
      supplier_match_method: contractorMatch.matchMethod,
    },
  });
  await upsert(supabase, "invoices", {
    id: invoiceId,
    contact_id: contractorMatch.contractor.id,
    direction: "payable",
    category: "labour",
    source_system: sourceSystem,
    external_id: `sha256:${contentSha256}`,
    invoice_number: invoice.invoiceNumber,
    status: "recorded",
    issued_on: invoice.issuedOn,
    due_on: null,
    currency: "CAD",
    subtotal_cents: invoice.subtotalCents,
    tax_cents: invoice.taxCents,
    total_cents: invoice.totalCents,
    paid_cents: 0,
    balance_cents: invoice.totalCents,
    metadata: {
      match_status: unassignedCount > 0 ? "needs_review" : "assigned",
      document_type: "invoice",
      supplier_name: contractorMatch.contractor.name,
      supplier_sender_email: contractorMatch.senderEmail,
      supplier_reply_to_email: senderIdentity(message.replyTo).email,
      supplier_match_method: contractorMatch.matchMethod,
      source_document_id: documentId,
      source_document_sha256: contentSha256,
      source_gmail_message_id: messageId,
      source_gmail_attachment_index: attachmentIndex,
      automatic_import: true,
      payment_status: "unpaid",
      itemization_status: "itemized_from_source",
      job_assignment_status: unassignedCount > 0 ? "partially_unassigned" : "fully_assigned",
      job_assignment_count: assignedCount,
      unassigned_line_count: unassignedCount,
      company_expense_line_count: companyCount,
    },
    updated_at: nowIso,
  });
  for (const plan of itemPlans) {
    await upsert(supabase, "invoice_lines", {
      id: plan.lineId,
      invoice_id: invoiceId,
      line_number: plan.lineNumber,
      description: plan.item.description,
      quantity: 1,
      unit: "service",
      unit_price_cents: plan.item.subtotal_cents,
      subtotal_cents: plan.item.subtotal_cents,
      tax_cents: plan.item.tax_cents,
      total_cents: plan.item.total_cents,
      service_started_on: plan.item.service_started_on,
      service_ended_on: plan.item.service_ended_on,
      source_kind: "gmail_contractor_invoice_item",
      metadata: { needs_review: plan.item.match_type === "unassigned", job_allocation_required: plan.item.match_type !== "company", entry_type: plan.item.match_type === "company" ? "other" : "labour", cost_classification: plan.item.match_type === "company" ? "company_expense" : null, source_document_id: documentId, source_gmail_message_id: messageId, printed_match_type: plan.item.match_type, printed_match_value: plan.item.match_value },
      updated_at: nowIso,
    });
    if (plan.job) {
      await upsert(supabase, "invoice_job_allocations", {
        id: await stableUuid(`invoice-job-allocation:${plan.lineId}:${plan.job.id}`),
        invoice_id: invoiceId,
        invoice_line_id: plan.lineId,
        job_id: plan.job.id,
        subtotal_cents: plan.item.subtotal_cents,
        tax_cents: plan.item.tax_cents,
        total_cents: plan.item.total_cents,
        quantity: 1,
        minutes: null,
        allocation_method: `exact_printed_${plan.item.match_type}`,
        confidence: 1,
        needs_review: false,
        metadata: { source_document_id: documentId, source_gmail_message_id: messageId, printed_description: plan.item.description, printed_match_type: plan.item.match_type, printed_match_value: plan.item.match_value },
        updated_at: nowIso,
      });
    }
  }
  await upsert(supabase, "evidence_links", {
    id: evidenceId,
    document_id: documentId,
    entity_type: "invoice",
    entity_id: invoiceId,
    evidence_role: "primary_invoice",
    metadata: { gmail_message_id: messageId, attachment_index: attachmentIndex },
  });
  await upsert(supabase, "verification_events", {
    id: verificationId,
    entity_type: "invoice",
    entity_id: invoiceId,
    action: "contractor_invoice_imported_unpaid",
    reason: "Exact attachment fields and itemized lines verified; eligible jobs assigned only from exact printed evidence",
    old_values: null,
    new_values: { status: "recorded", paid_cents: 0, balance_cents: invoice.totalCents, line_count: itemPlans.length, job_allocation_count: assignedCount, company_expense_line_count: companyCount, unassigned_line_count: unassignedCount },
    evidence: { document_id: documentId, content_sha256: contentSha256, gmail_message_id: messageId, attachment_index: attachmentIndex },
    performed_by: null,
    occurred_at: nowIso,
  });
  return {
    status: "imported",
    invoice_id: invoiceId,
    document_id: documentId,
    contractor: { id: contractorMatch.contractor.id, name: contractorMatch.contractor.name, match_method: contractorMatch.matchMethod },
    line_count: itemPlans.length,
    job_allocation_count: assignedCount,
    unassigned_line_count: unassignedCount,
    company_expense_line_count: companyCount,
  };
}

type InvoiceItem = {
  match_type: string;
  match_value: string | null;
  description: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  service_started_on: string | null;
  service_ended_on: string | null;
};

function verifyInvoiceItems(value: unknown, evidence: string, invoice: { subtotalCents: number; taxCents: number }) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 25) throw httpError("Invoice requires between 1 and 25 itemized lines", 422);
  const source = normalizedEvidence(evidence);
  const amounts = extractMoneyCents(evidence);
  const items = value.map((candidate, index) => {
    const item = (candidate && typeof candidate === "object" ? candidate : {}) as Record<string, unknown>;
    const matchType = boundedText(item.match_type, `items[${index}].match_type`, 20);
    if (!itemMatchTypes.has(matchType)) throw httpError(`Invalid items[${index}].match_type`, 400);
    const matchValue = ["company", "unassigned"].includes(matchType) ? null : boundedText(item.match_value, `items[${index}].match_value`, 240);
    const description = boundedText(item.description, `items[${index}].description`, 500);
    const subtotalCents = boundedInteger(item.subtotal_cents, `items[${index}].subtotal_cents`, 1, 100_000_000_000);
    const serviceStartedOn = optionalItemDate(item.service_started_on, `items[${index}].service_started_on`);
    const serviceEndedOn = optionalItemDate(item.service_ended_on, `items[${index}].service_ended_on`);
    if (!source.includes(normalizedEvidence(description))) throw httpError(`Invoice item ${index + 1} description is not supported by attachment evidence`, 422);
    if (!amounts.has(subtotalCents)) throw httpError(`Invoice item ${index + 1} subtotal is not supported by attachment evidence`, 422);
    if (matchValue && !source.includes(normalizedEvidence(matchValue))) throw httpError(`Invoice item ${index + 1} job evidence is not supported by attachment evidence`, 422);
    return { match_type: matchType, match_value: matchValue, description, subtotal_cents: subtotalCents, tax_cents: 0, total_cents: subtotalCents, service_started_on: serviceStartedOn, service_ended_on: serviceEndedOn } as InvoiceItem;
  });
  if (items.reduce((sum, item) => sum + item.subtotal_cents, 0) !== invoice.subtotalCents) throw httpError("Invoice item subtotals do not equal the invoice subtotal", 422);
  let remainingTax = invoice.taxCents;
  return items.map((item, index) => {
    const taxCents = index === items.length - 1 ? remainingTax : Math.round(item.subtotal_cents * invoice.taxCents / invoice.subtotalCents);
    remainingTax -= taxCents;
    return { ...item, tax_cents: taxCents, total_cents: item.subtotal_cents + taxCents };
  });
}

function optionalItemDate(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  return isoDate(value, label);
}

function exactCurrentJobForItem(jobs: Record<string, unknown>[], item: InvoiceItem) {
  if (["company", "unassigned"].includes(item.match_type)) return null;
  const selected = normalizedEvidence(item.match_value);
  const matches = jobs.filter((job) => jobIsEligible(job) && exactJobEvidence(job, item.match_type)
    .some((candidate) => normalizedEvidence(candidate) === selected));
  return matches.length === 1 ? matches[0] : null;
}

function jobIsEligible(job: Record<string, unknown>) {
  const status = String(job.status || "").toLowerCase();
  if (status === "cancelled") return false;
  if (job.started_on && String(job.started_on) < historicalCutoff) return false;
  if (!job.started_on && job.completed_on && String(job.completed_on) < historicalCutoff) return false;
  return !(!job.started_on && !job.completed_on && (status === "completed" || status === "archived" || job.archived_at));
}

function exactJobEvidence(job: Record<string, unknown>, matchType: string) {
  const metadata = (job.metadata && typeof job.metadata === "object" ? job.metadata : {}) as Record<string, unknown>;
  const source = (metadata.source_payload && typeof metadata.source_payload === "object" ? metadata.source_payload : {}) as Record<string, unknown>;
  if (matchType === "name") return [job.name, source.Job, source.job_name];
  if (matchType === "address") return [String(job.formatted_address || "").split(",")[0], source.street_address_1, String((metadata.address_verification as Record<string, unknown> | undefined)?.address || "").split(",")[0]];
  if (matchType === "proposal") return [source["Proposal ID"], source.proposal_id, metadata.proposal_id];
  return [];
}

async function resolveContractorIdentity(supabase: ServiceClient, message: Record<string, string | null>, attachmentText: string) {
  const identity = senderIdentity(message.from);
  const direct = await exactContractorEmail(supabase, identity.email);
  if (direct) return { contractor: direct, matchMethod: "exact_sender_email", senderEmail: identity.email };

  const alias = identity.email ? trustedDirectAliases.get(identity.email) : null;
  if (alias) {
    const senderDomain = identity.email!.split("@").at(-1)!;
    if (!authenticatedSenderDomain(message.authenticationResults, [senderDomain])) return null;
    const contractor = await exactContractorName(supabase, alias.contactName);
    const evidence = normalizedEvidence(`${message.subject || ""}\n${attachmentText}`);
    if (!contractor || !alias.evidenceTerms.every((term) => evidence.includes(normalizedEvidence(term)))) return null;
    return { contractor, matchMethod: "authenticated_supplier_alias", senderEmail: identity.email };
  }

  const platformDomains = identity.email ? trustedInvoicePlatforms.get(identity.email) : null;
  if (!platformDomains || !authenticatedSenderDomain(message.authenticationResults, platformDomains)) return null;
  const assertedName = platformSupplierName(message.subject, identity.email);
  if (!assertedName) return null;
  const contractor = await exactContractorName(supabase, assertedName);
  if (!contractor || !normalizedEvidence(attachmentText).includes(normalizedEvidence(contractor.name))) return null;
  return { contractor, matchMethod: "authenticated_invoice_platform", senderEmail: identity.email };
}

async function exactContractorEmail(supabase: ServiceClient, email: string | null) {
  if (!email) return null;
  for (const field of ["normalized_email", "email"]) {
    const result = await supabase.from("contacts").select("id,name,email,kind").eq(field, email).eq("kind", "contractor").limit(2);
    if (result.error) throw httpError(result.error.message, 500);
    if (result.data?.length === 1) return result.data[0];
    if ((result.data?.length || 0) > 1) return null;
  }
  return null;
}

async function exactContractorName(supabase: ServiceClient, name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9 '&.,()/-]{0,159}$/.test(name)) return null;
  const result = await supabase.from("contacts").select("id,name,email,kind").eq("name", name).eq("kind", "contractor").limit(2);
  if (result.error) throw httpError(result.error.message, 500);
  return result.data?.length === 1 ? result.data[0] : null;
}

function verifyInvoiceDecision(input: Record<string, unknown>) {
  const invoiceNumber = boundedText(input.invoiceNumber, "invoice_number", 80, /^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/);
  const issuedOn = isoDate(input.issuedOn, "issued_on");
  const subtotalCents = boundedInteger(input.subtotalCents, "subtotal_cents", 0, 100_000_000_000);
  const taxCents = boundedInteger(input.taxCents, "tax_cents", 0, 100_000_000_000);
  const totalCents = boundedInteger(input.totalCents, "total_cents", 1, 100_000_000_000);
  if (Math.abs(subtotalCents + taxCents - totalCents) > 2) throw httpError("Subtotal plus tax does not equal total", 422);
  const source = `${input.filename || ""}\n${input.evidence || ""}`;
  const numberPattern = new RegExp(`invoice.{0,30}${escapeRegExp(invoiceNumber)}`, "i");
  if (!numberPattern.test(source) && !normalizedEvidence(input.filename).includes(`invoice${normalizedEvidence(invoiceNumber)}`)
      && !(normalizedEvidence(invoiceNumber).length >= 4 && normalizedEvidence(source).includes(normalizedEvidence(invoiceNumber)))) {
    throw httpError("Invoice number is not supported by attachment evidence", 422);
  }
  if (!dateVariants(issuedOn).some((variant) => source.toLowerCase().includes(variant.toLowerCase()))) {
    throw httpError("Invoice date is not supported by attachment evidence", 422);
  }
  const allAmounts = extractMoneyCents(source);
  const totalAmounts = labelledMoneyCents(source, [/\btotal\b/i, /amount\s+due/i, /balance\s+due/i]);
  const subtotalAmounts = labelledMoneyCents(source, [/sub\s*total/i, /before\s+(?:hst|tax)/i]);
  const taxAmounts = labelledMoneyCents(source, [/\bhst\b/i, /\bgst\b/i, /\btax\b/i, /\b(?:on|ontario)\s+\d+(?:\.\d+)?%/i]);
  if (!allAmounts.has(totalCents) || !totalAmounts.has(totalCents)) throw httpError("Invoice total is not supported by a labelled total", 422);
  if (taxCents > 0 && (!allAmounts.has(taxCents) || !taxAmounts.has(taxCents))) throw httpError("Invoice tax is not supported by a labelled amount", 422);
  if (!allAmounts.has(subtotalCents) || (!subtotalAmounts.has(subtotalCents) && !(taxCents === 0 && subtotalCents === totalCents))) {
    throw httpError("Invoice subtotal is not supported by attachment evidence", 422);
  }
  return { invoiceNumber, issuedOn, subtotalCents, taxCents, totalCents };
}

function extractMoneyCents(value: unknown) {
  const matches = String(value || "").match(/(?:CAD\s*|CA\$\s*|\$\s*)?\d{1,3}(?:[ ,.\u00a0]\d{3})*(?:[.,]\d{2})|(?:CAD\s*|CA\$\s*|\$\s*)?\d+[.,]\d{2}/gi) || [];
  return new Set(matches.map(parseAmount).filter((amount): amount is number => amount !== null));
}

function parseAmount(value: string) {
  let text = value.trim().replace(/(?:CAD|CA\$|\$)/gi, "").replace(/[\s\u00a0]/g, "");
  if (text.includes(",") && text.includes(".")) text = text.lastIndexOf(".") > text.lastIndexOf(",") ? text.replaceAll(",", "") : text.replaceAll(".", "").replace(",", ".");
  else if (text.includes(",")) {
    const pieces = text.split(",");
    text = pieces.at(-1)?.length === 2 ? `${pieces.slice(0, -1).join("")}.${pieces.at(-1)}` : pieces.join("");
  }
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function labelledMoneyCents(value: unknown, labels: RegExp[]) {
  const result = new Set<number>();
  for (const line of String(value || "").split(/\r?\n/)) {
    if (!labels.some((label) => label.test(line))) continue;
    for (const amount of extractMoneyCents(line)) result.add(amount);
  }
  return result;
}

function dateVariants(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const monthLong = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1];
  const monthShort = monthLong.slice(0, 3);
  return [date, `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`, `${month}/${day}/${year}`,
    `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`, `${monthLong} ${day}, ${year}`, `${monthShort} ${day}, ${year}`,
    `${day} ${monthLong} ${year}`, `${day} ${monthShort} ${year}`];
}

function decodeDocument(value: unknown) {
  const source = String(value || "");
  if (!source || source.length > 6_700_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source)) throw httpError("Invalid document payload", 400);
  let decoded: string;
  try { decoded = atob(source); } catch { throw httpError("Invalid document payload", 400); }
  if (decoded.length === 0 || decoded.length > maximumDocumentBytes) throw httpError("Document is empty or too large", 413);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function validMagicBytes(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "application/pdf") return new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-";
  if (mimeType === "image/png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  return mimeType === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function senderIdentity(value: unknown) {
  const source = String(value || "").trim();
  const match = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return { email: match ? match[0].toLowerCase() : null };
}

function authenticatedSenderDomain(authenticationResults: string | null, domains: string[]) {
  const authentication = String(authenticationResults || "").toLowerCase();
  return domains.some((domain) => (authentication.includes("dmarc=pass") && authentication.includes(`header.from=${domain}`))
    || (authentication.includes("dkim=pass") && authentication.includes(`header.i=@${domain}`)));
}

function platformSupplierName(subject: string | null, senderEmail: string | null) {
  const text = subject?.trim() || "";
  const match = senderEmail === "notification@msg.getjobber.com"
    ? text.match(/^invoice\s+from\s+(.+?)\s+-\s+.+$/i)
    : text.match(/^invoice\s+#?[A-Za-z0-9._/-]+\s+from\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizedEvidence(value: unknown) {
  return String(value || "").normalize("NFKD").replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

async function upsert(supabase: ServiceClient, table: string, row: Record<string, unknown>) {
  const result = await supabase.from(table).upsert(row, { onConflict: "id" });
  if (result.error) throw httpError(result.error.message, 500);
}

async function stableUuid(value: string) {
  const hex = await sha256Hex(new TextEncoder().encode(value));
  const bytes = Uint8Array.from(hex.slice(0, 32).match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const selected = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${selected.slice(0, 8)}-${selected.slice(8, 12)}-${selected.slice(12, 16)}-${selected.slice(16, 20)}-${selected.slice(20)}`;
}

async function authorize(request: Request) {
  const supplied = request.headers.get("x-hermes-time-entry-token");
  const suppliedSha256 = supplied ? await sha256Hex(new TextEncoder().encode(supplied)) : "";
  if (!supplied || !timingSafeEqual(suppliedSha256, hermesTokenSha256)) throw httpError("Invalid Hermes authorization", 401);
}

async function sha256Hex(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(value).buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function parseBody(request: Request) {
  try { return await request.json() as Record<string, unknown>; } catch { throw httpError("Invalid JSON body", 400); }
}

function boundedText(value: unknown, label: string, maximum: number, pattern?: RegExp) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text) || (pattern && !pattern.test(text))) throw httpError(`Invalid ${label}`, 400);
  return text;
}

function boundedEvidence(value: unknown, label: string, maximum: number) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw httpError(`Invalid ${label}`, 400);
  return text;
}

function optionalText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function optionalBoundedText(value: unknown, maximum: number) {
  const text = optionalText(value);
  if (!text) return null;
  if (text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw httpError("Invalid message metadata", 400);
  return text;
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number) {
  if (!/^\d+$/.test(String(value ?? ""))) throw httpError(`Invalid ${label}`, 400);
  const selected = Number(value);
  if (!Number.isSafeInteger(selected) || selected < minimum || selected > maximum) throw httpError(`Invalid ${label}`, 400);
  return selected;
}

function isoDate(value: unknown, label: string) {
  const text = boundedText(value, label, 10, /^\d{4}-\d{2}-\d{2}$/);
  const date = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw httpError(`Invalid ${label}`, 400);
  return text;
}

function optionalIso(value: unknown) {
  const text = optionalText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeFilename(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160) || "invoice";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function timingSafeEqual(a: string, b: string) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let mismatch = 0;
  for (let index = 0; index < aBytes.length; index += 1) mismatch |= aBytes[index] ^ bBytes[index];
  return mismatch === 0;
}

function httpError(message: string, status: number) {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
