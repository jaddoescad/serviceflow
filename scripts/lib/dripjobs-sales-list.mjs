import crypto from "node:crypto";

import { parseMoneyCents } from "./dripjobs-invoice-list.mjs";

export const DRIPJOBS_SALES_LIST_HEADERS = Object.freeze([
  "Status",
  "Label",
  "Customer Name",
  "Email",
  "Phone Number",
  "Lead Source",
  "Deal Name",
  "Deal Stage",
  "Deal Amount",
  "Last Change",
  "Deal Age",
  "Salesperson",
]);

const ARCHIVED_STATUSES = new Set(["archived", "cancelled", "canceled"]);
const SALES_LIST_SNAPSHOT_SOURCE_TYPE = "dripjobs_sales_list_all_rows_dom_v2";
const SALES_LIST_MANIFEST_SOURCE_TYPE = "dripjobs_sales_list_all_views_dom_v2";
const SALES_DELTA_SNAPSHOT_SOURCE_TYPE = "dripjobs_sales_list_changed_rows_dom_v3";
const SALES_DELTA_MANIFEST_SOURCE_TYPE = "dripjobs_sales_list_changed_views_dom_v3";

export function salesListSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function boundedText(value, label, maximum, { allowEmpty = false } = {}) {
  const text = String(value ?? "").trim();
  if (!allowEmpty && !text) throw new Error(`${label} is empty`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-CA");
}

export function normalizeDripJobsLeadChannel(source) {
  const value = normalized(source);
  if (value === "meta-perspective" || value === "meta ads" || value.startsWith("meta ads -")) return "paid_social";
  if (value === "facebook" || value === "instagram") return "organic_social";
  if (value === "website" || value === "/" || value.startsWith("/")) return "website";
  if (value === "phone call") return "phone";
  if (value === "mail") return "mail";
  if (value === "word of mouth") return "referral";
  if (value === "google") return "organic_search";
  if (value === "other") return "other";
  return "unknown";
}

export function leadStatusForSalesRow(row) {
  const status = normalized(row.status);
  const stage = normalized(row.dealStage).replace(/[^a-z0-9]+/g, " ").trim();
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "archived") return "lost";
  if (stage === "estimate scheduled") return "estimate_scheduled";
  if (stage === "in draft") return "estimated";
  if (stage === "proposal s sent" || stage.startsWith("proposal on hold")) return "proposal_sent";
  return "contacted";
}

export function validateDripJobsSalesList(input, {
  view,
  scope = "backfill",
  minimumRows = null,
  maximumRows = 10_000,
} = {}) {
  if (!["active", "archived"].includes(view)) throw new Error("Sales List view must be active or archived");
  if (!["backfill", "changed_delta"].includes(scope)) throw new Error("Sales List scope must be backfill or changed_delta");
  const expectedSchemaVersion = scope === "backfill" ? 2 : 3;
  const expectedSourceType = scope === "backfill" ? SALES_LIST_SNAPSHOT_SOURCE_TYPE : SALES_DELTA_SNAPSHOT_SOURCE_TYPE;
  const expectedChangedFilter = scope === "backfill" ? "anytime" : "last_7_days";
  const effectiveMinimumRows = minimumRows ?? (scope === "backfill" ? (view === "archived" ? 1_000 : 50) : 0);
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(typeof input === "string" ? input : JSON.stringify(input), "utf8");
  if (bytes.length < 128) throw new Error(`${view} Sales List snapshot is too small to be complete`);
  if (bytes.length > 10_000_000) throw new Error(`${view} Sales List snapshot exceeds the 10 MB limit`);
  let snapshot;
  try { snapshot = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${view} Sales List snapshot is not valid JSON`); }
  if (snapshot?.schema_version !== expectedSchemaVersion || snapshot?.source_type !== expectedSourceType) {
    throw new Error(`${view} Sales List snapshot has the wrong source contract`);
  }
  if (snapshot.view !== view) throw new Error(`${view} Sales List snapshot has view ${snapshot.view || "missing"}`);
  if (
    snapshot.filters?.created !== "anytime" ||
    snapshot.filters?.changed !== expectedChangedFilter ||
    snapshot.filters?.page_length !== "-1" ||
    snapshot.filters?.applied !== true
  ) {
    throw new Error(`${view} Sales List snapshot was not captured with the submitted ${scope} / All filters`);
  }
  if (JSON.stringify(snapshot.headers) !== JSON.stringify(DRIPJOBS_SALES_LIST_HEADERS)) {
    throw new Error(`unexpected ${view} Sales List headers: ${JSON.stringify(snapshot.headers)}`);
  }
  if (!Array.isArray(snapshot.rows)) throw new Error(`${view} Sales List rows are missing`);
  if (!Number.isInteger(snapshot.total) || snapshot.total !== snapshot.rows.length) {
    throw new Error(`${view} Sales List reported total does not match its captured rows`);
  }
  if (!Number.isInteger(snapshot.datatable_total) || snapshot.datatable_total !== snapshot.rows.length) {
    throw new Error(`${view} Sales List DataTable total does not match its captured rows`);
  }
  if (snapshot.rows.length < effectiveMinimumRows) throw new Error(`${view} Sales List has only ${snapshot.rows.length} rows`);
  if (snapshot.rows.length > maximumRows) throw new Error(`${view} Sales List has ${snapshot.rows.length} rows; maximum is ${maximumRows}`);
  const dealIds = new Set();
  const rows = snapshot.rows.map((source, index) => {
    const label = `${view} Sales List row ${index + 1}`;
    if (Number(source.row_number) !== index + 1) throw new Error(`${label}: row number is not sequential`);
    const dealId = boundedText(source.deal_id, `${label} Deal ID`, 80);
    const hrefDealId = boundedText(source.deal_id_from_href, `${label} href Deal ID`, 80);
    if (!/^[a-f0-9]{20,80}$/i.test(dealId) || hrefDealId !== dealId) throw new Error(`${label}: exact Deal ID validation failed`);
    if (dealIds.has(dealId)) throw new Error(`${label}: duplicate Deal ID ${dealId}`);
    dealIds.add(dealId);
    const status = boundedText(source.Status, `${label} Status`, 40);
    const archivedStatus = ARCHIVED_STATUSES.has(normalized(status));
    if (view === "active" && archivedStatus) throw new Error(`${label}: active view contains ${status}`);
    if (view === "archived" && !archivedStatus) throw new Error(`${label}: archived view contains ${status}`);
    const rawSource = boundedText(source["Lead Source"], `${label} Lead Source`, 500, { allowEmpty: true }) || null;
    const parsed = {
      view,
      rowNumber: index + 1,
      dealId,
      contactId: boundedText(source.contact_id, `${label} Contact ID`, 80, { allowEmpty: true }) || null,
      status,
      label: boundedText(source.Label, `${label} Label`, 160, { allowEmpty: true }) || null,
      customer: boundedText(source["Customer Name"], `${label} Customer Name`, 300),
      email: boundedText(source.Email, `${label} Email`, 320, { allowEmpty: true }) || null,
      phone: boundedText(source["Phone Number"], `${label} Phone Number`, 80, { allowEmpty: true }) || null,
      rawSource,
      normalizedChannel: normalizeDripJobsLeadChannel(rawSource),
      dealName: boundedText(source["Deal Name"], `${label} Deal Name`, 300, { allowEmpty: true }),
      dealStage: boundedText(source["Deal Stage"], `${label} Deal Stage`, 160),
      dealAmountCents: parseMoneyCents(source["Deal Amount"], `${label} Deal Amount`),
      lastChange: boundedText(source["Last Change"], `${label} Last Change`, 40, { allowEmpty: true }) || null,
      dealAge: boundedText(source["Deal Age"], `${label} Deal Age`, 40, { allowEmpty: true }) || null,
      salesperson: boundedText(source.Salesperson, `${label} Salesperson`, 160, { allowEmpty: true }) || null,
    };
    parsed.leadStatus = leadStatusForSalesRow(parsed);
    return parsed;
  });
  return {
    view,
    rows,
    headers: snapshot.headers,
    capturedAt: boundedText(snapshot.captured_at, `${view} Sales List captured_at`, 80),
    bytes,
    sourceSha256: salesListSha256(bytes),
  };
}

export function validateDripJobsSalesExports({ active, archived }, {
  previousManifest = null,
  scope = "backfill",
  minimumTotalRows = null,
  validatorOptions = {},
} = {}) {
  if (!["backfill", "changed_delta"].includes(scope)) throw new Error("Sales List scope must be backfill or changed_delta");
  const activeResult = validateDripJobsSalesList(active, { view: "active", scope, ...validatorOptions.active });
  const archivedResult = validateDripJobsSalesList(archived, { view: "archived", scope, ...validatorOptions.archived });
  const rows = [...activeResult.rows, ...archivedResult.rows];
  const effectiveMinimumTotalRows = minimumTotalRows ?? (scope === "backfill" ? 1_200 : 0);
  if (rows.length < effectiveMinimumTotalRows) throw new Error(`combined Sales List has only ${rows.length} rows`);
  const dealIds = new Set();
  for (const row of rows) {
    if (dealIds.has(row.dealId)) throw new Error(`Deal ID ${row.dealId} appears in both Sales List views`);
    dealIds.add(row.dealId);
  }
  const manifest = {
    schema_version: scope === "backfill" ? 2 : 3,
    source_type: scope === "backfill" ? SALES_LIST_MANIFEST_SOURCE_TYPE : SALES_DELTA_MANIFEST_SOURCE_TYPE,
    scope,
    accepted_at: new Date().toISOString(),
    source_sha256: salesListSha256(`${activeResult.sourceSha256}:${archivedResult.sourceSha256}`),
    active_source_sha256: activeResult.sourceSha256,
    archived_source_sha256: archivedResult.sourceSha256,
    active_row_count: activeResult.rows.length,
    archived_row_count: archivedResult.rows.length,
    row_count: rows.length,
    distinct_deals: dealIds.size,
    paid_social_rows: rows.filter((row) => row.normalizedChannel === "paid_social").length,
    deal_ids: [...dealIds].sort(),
  };
  if (previousManifest) validateSalesManifestContinuity(manifest, previousManifest);
  return { active: activeResult, archived: archivedResult, rows, manifest };
}

export function validateSalesManifestContinuity(current, previous) {
  if (previous.source_type !== SALES_LIST_MANIFEST_SOURCE_TYPE) throw new Error("previous Sales List manifest has the wrong source type");
  const previousRows = Number(previous.row_count);
  if (!Number.isInteger(previousRows) || previousRows < 1) throw new Error("previous Sales List manifest has an invalid row count");
  const allowedDecrease = Math.max(20, Math.ceil(previousRows * 0.15));
  const allowedIncrease = Math.max(50, Math.ceil(previousRows * 0.35));
  if (current.row_count < previousRows - allowedDecrease) throw new Error(`combined Sales List row count dropped from ${previousRows} to ${current.row_count}`);
  if (current.row_count > previousRows + allowedIncrease) throw new Error(`combined Sales List row count jumped from ${previousRows} to ${current.row_count}`);
  const previousIds = new Set(Array.isArray(previous.deal_ids) ? previous.deal_ids.map(String) : []);
  if (previousIds.size !== previousRows) throw new Error("previous Sales List manifest has an invalid Deal ID set");
  const overlap = current.deal_ids.filter((id) => previousIds.has(String(id))).length;
  const requiredOverlap = Math.floor(Math.min(previousRows, current.row_count) * 0.8);
  if (overlap < requiredOverlap) throw new Error(`only ${overlap} Deal IDs overlap the last accepted Sales List; expected at least ${requiredOverlap}`);
  return true;
}
