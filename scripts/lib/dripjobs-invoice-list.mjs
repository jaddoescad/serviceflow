import crypto from "node:crypto";

export const DRIPJOBS_INVOICE_LIST_HEADERS = Object.freeze([
  "Status",
  "Customer",
  "Proposal Name",
  "Invoice ID",
  "Amount",
  "Paid",
  "Balance",
  "Date",
]);

const ALLOWED_STATUSES = new Set([
  "Open",
  "Partially Paid",
  "Paid",
  "Offline Requested",
  "Void",
  "Voided",
  "Canceled",
  "Cancelled",
]);

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  if (quoted) throw new Error("CSV ended inside a quoted field");
  return rows;
}

export function parseMoneyCents(value, label) {
  const raw = String(value ?? "").trim();
  const negative = raw.startsWith("(") && raw.endsWith(")");
  const normalized = raw.replace(/[()$,]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label}: invalid currency value ${JSON.stringify(value)}`);
  }
  const [dollars, cents = ""] = normalized.split(".");
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  return negative ? -amount : amount;
}

function boundedText(value, label, maximum) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is empty`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function parseSourceDate(value, label) {
  const text = boundedText(value, label, 80);
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s+[AP]M)?$/i.test(text)) {
    throw new Error(`${label}: unexpected date format`);
  }
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}: invalid date`);
  const year = parsed.getFullYear();
  if (year < 2010 || year > new Date().getFullYear() + 1) throw new Error(`${label}: implausible date`);
  return parsed.toISOString();
}

function assertStatusArithmetic(row, label) {
  const settled = Math.abs(row.paidCents + row.balanceCents - row.grossCents) <= 1;
  if (!settled) throw new Error(`${label}: paid plus balance does not equal amount`);
  if (row.grossCents <= 0) throw new Error(`${label}: amount must be positive`);
  if (row.paidCents < 0) throw new Error(`${label}: paid amount cannot be negative`);
  // DripJobs occasionally leaves a settled invoice labelled Partially Paid and
  // represents an overpayment as a negative balance. The exact amount equation
  // is authoritative; status-to-balance consistency is not a file-validity rule.
}

export function invoiceRowFingerprint(row) {
  return sha256(JSON.stringify([
    row.proposalId,
    row.invoiceId,
    row.grossCents,
    row.beforeHstCents,
    row.status,
  ]));
}

export function validateDripJobsInvoiceList(input, {
  minimumBytes = 512,
  minimumRows = 50,
  maximumRows = 10_000,
  previousManifest = null,
  now = new Date(),
} = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  if (bytes.length < minimumBytes) throw new Error("download is too small to be the full DripJobs Invoice List");
  if (bytes.length > 5_000_000) throw new Error("download exceeds the 5 MB Invoice List limit");
  if (bytes.includes(0)) throw new Error("download contains binary data instead of CSV text");
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  const parsed = parseCsv(text);
  if (parsed.length < 2) throw new Error("Invoice List has no data rows");
  const headers = parsed[0];
  if (JSON.stringify(headers) !== JSON.stringify(DRIPJOBS_INVOICE_LIST_HEADERS)) {
    throw new Error(`unexpected CSV headers: ${JSON.stringify(headers)}`);
  }
  const dataRows = parsed.slice(1).filter((values) => values.some((value) => String(value).trim()));
  if (dataRows.length < minimumRows) throw new Error(`Invoice List has only ${dataRows.length} rows; expected at least ${minimumRows}`);
  if (dataRows.length > maximumRows) throw new Error(`Invoice List has ${dataRows.length} rows; maximum is ${maximumRows}`);

  const invoiceIds = new Set();
  const rows = dataRows.map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) throw new Error(`CSV row ${rowNumber} has ${values.length} columns`);
    const source = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    const status = boundedText(source.Status, `CSV row ${rowNumber} Status`, 40);
    if (!ALLOWED_STATUSES.has(status)) throw new Error(`CSV row ${rowNumber}: unexpected status ${JSON.stringify(status)}`);
    const customer = boundedText(source.Customer, `CSV row ${rowNumber} Customer`, 300);
    const proposalName = boundedText(source["Proposal Name"], `CSV row ${rowNumber} Proposal Name`, 300);
    const proposalId = proposalName.match(/\d+/)?.[0] ?? null;
    if (!proposalId) throw new Error(`CSV row ${rowNumber} has no proposal number`);
    const invoiceId = boundedText(source["Invoice ID"], `CSV row ${rowNumber} Invoice ID`, 80).replace(/^#/, "");
    if (!/^\d+$/.test(invoiceId)) throw new Error(`CSV row ${rowNumber}: Invoice ID must be numeric`);
    if (invoiceIds.has(invoiceId)) throw new Error(`CSV row ${rowNumber}: duplicate Invoice ID ${invoiceId}`);
    invoiceIds.add(invoiceId);
    const grossCents = parseMoneyCents(source.Amount, `CSV row ${rowNumber} Amount`);
    const paidCents = parseMoneyCents(source.Paid, `CSV row ${rowNumber} Paid`);
    const balanceCents = parseMoneyCents(source.Balance, `CSV row ${rowNumber} Balance`);
    const beforeHstCents = Math.round(grossCents / 1.13);
    const parsedRow = {
      rowNumber,
      status,
      customer,
      proposalName,
      proposalId,
      invoiceId,
      grossCents,
      paidCents,
      balanceCents,
      beforeHstCents,
      impliedHstCents: grossCents - beforeHstCents,
      sourceDate: boundedText(source.Date, `CSV row ${rowNumber} Date`, 80),
      sourceDateIso: parseSourceDate(source.Date, `CSV row ${rowNumber} Date`),
    };
    assertStatusArithmetic(parsedRow, `CSV row ${rowNumber}`);
    if (new Date(parsedRow.sourceDateIso).getTime() > now.getTime() + 48 * 60 * 60 * 1000) {
      throw new Error(`CSV row ${rowNumber}: invoice date is more than two days in the future`);
    }
    return { ...parsedRow, rowFingerprint: invoiceRowFingerprint(parsedRow) };
  });

  const manifest = buildInvoiceListManifest(rows, bytes, now);
  if (previousManifest) validateManifestContinuity(manifest, previousManifest);
  return { headers, rows, manifest, bytes };
}

export function buildInvoiceListManifest(rows, bytes, now = new Date()) {
  const newestSourceDate = rows.reduce((latest, row) => (
    !latest || row.sourceDateIso > latest ? row.sourceDateIso : latest
  ), null);
  return {
    schema_version: 1,
    source_type: "dripjobs_invoice_list_csv",
    accepted_at: now.toISOString(),
    source_sha256: sha256(bytes),
    size_bytes: bytes.length,
    row_count: rows.length,
    distinct_proposals: new Set(rows.map((row) => row.proposalId)).size,
    gross_total_cents: rows.reduce((sum, row) => sum + row.grossCents, 0),
    newest_source_date: newestSourceDate,
    invoice_ids: rows.map((row) => row.invoiceId).sort(),
  };
}

export function validateManifestContinuity(current, previous) {
  if (previous.source_type !== "dripjobs_invoice_list_csv") throw new Error("previous validator manifest has the wrong source type");
  const previousRows = Number(previous.row_count);
  if (!Number.isInteger(previousRows) || previousRows < 1) throw new Error("previous validator manifest has an invalid row count");
  const allowedDecrease = Math.max(5, Math.ceil(previousRows * 0.05));
  const allowedIncrease = Math.max(50, Math.ceil(previousRows * 0.25));
  if (current.row_count < previousRows - allowedDecrease) {
    throw new Error(`row count dropped from ${previousRows} to ${current.row_count}`);
  }
  if (current.row_count > previousRows + allowedIncrease) {
    throw new Error(`row count jumped from ${previousRows} to ${current.row_count}`);
  }
  const previousIds = new Set(Array.isArray(previous.invoice_ids) ? previous.invoice_ids.map(String) : []);
  if (previousIds.size !== previousRows) throw new Error("previous validator manifest has an invalid Invoice ID set");
  const overlap = current.invoice_ids.filter((id) => previousIds.has(String(id))).length;
  const requiredOverlap = Math.floor(Math.min(previousRows, current.row_count) * 0.9);
  if (overlap < requiredOverlap) {
    throw new Error(`only ${overlap} Invoice IDs overlap the last accepted export; expected at least ${requiredOverlap}`);
  }
  const previousGross = Number(previous.gross_total_cents);
  if (!Number.isSafeInteger(previousGross) || previousGross <= 0) throw new Error("previous validator manifest has an invalid gross total");
  if (current.gross_total_cents < Math.floor(previousGross * 0.8)) throw new Error("gross invoice total dropped by more than 20%");
  if (current.gross_total_cents > Math.ceil(previousGross * 1.5)) throw new Error("gross invoice total increased by more than 50%");
  return true;
}
