import assert from "node:assert/strict";
import test from "node:test";

import {
  DRIPJOBS_SALES_LIST_HEADERS,
  leadStatusForSalesRow,
  normalizeDripJobsLeadChannel,
  validateDripJobsSalesExports,
  validateDripJobsSalesList,
} from "./lib/dripjobs-sales-list.mjs";

function snapshot(view, count, { start = 0 } = {}) {
  return Buffer.from(JSON.stringify({
    schema_version: 2,
    source_type: "dripjobs_sales_list_all_rows_dom_v2",
    captured_at: "2026-08-20T12:00:00.000Z",
    view,
    filters: { created: "anytime", changed: "anytime", page_length: "-1", applied: true },
    headers: DRIPJOBS_SALES_LIST_HEADERS,
    total: count,
    datatable_total: count,
    rows: Array.from({ length: count }, (_, index) => {
      const dealId = `${view === "active" ? "a" : "b"}${String(start + index).padStart(31, "0")}`;
      return {
        row_number: index + 1,
        deal_id: dealId,
        deal_id_from_href: dealId,
        contact_id: `c${String(start + index).padStart(31, "0")}`,
        Status: view === "active" ? "Pending" : "Archived",
        Label: "",
        "Customer Name": `Customer ${index + 1}`,
        Email: "customer@example.com",
        "Phone Number": "6135551212",
        "Lead Source": index % 2 ? "/Contact" : "Meta Ads - Interior",
        "Deal Name": `Deal ${index + 1}`,
        "Deal Stage": index % 2 ? "Estimate Scheduled" : "Proposal(s) Sent",
        "Deal Amount": "$1,130.00",
        "Last Change": "2d",
        "Deal Age": "5d",
        Salesperson: "Scott Madden",
      };
    }),
  }));
}

test("Sales List validator requires exact IDs, complete filters, and disjoint views", () => {
  const active = snapshot("active", 10);
  const archived = snapshot("archived", 100, { start: 100 });
  const result = validateDripJobsSalesExports({ active, archived }, {
    minimumTotalRows: 110,
    validatorOptions: { active: { minimumRows: 10 }, archived: { minimumRows: 100 } },
  });
  assert.equal(result.manifest.row_count, 110);
  assert.equal(result.manifest.distinct_deals, 110);
  assert.equal(result.active.rows[0].normalizedChannel, "paid_social");
  assert.equal(result.active.rows[1].leadStatus, "estimate_scheduled");
});

test("Sales List source and stage normalization is deterministic", () => {
  assert.equal(normalizeDripJobsLeadChannel("Meta Ads - Exterior"), "paid_social");
  assert.equal(normalizeDripJobsLeadChannel("/Contact"), "website");
  assert.equal(normalizeDripJobsLeadChannel("Website"), "website");
  assert.equal(normalizeDripJobsLeadChannel("Phone Call"), "phone");
  assert.equal(leadStatusForSalesRow({ status: "Archived", dealStage: "Cold Leads" }), "lost");
  assert.equal(leadStatusForSalesRow({ status: "Pending", dealStage: "Proposal(s) Sent" }), "proposal_sent");
});

test("Sales List validator fails closed on a mismatched Deal ID", () => {
  const source = JSON.parse(snapshot("active", 10).toString("utf8"));
  source.rows[0].deal_id_from_href = "f".repeat(32);
  assert.throws(() => validateDripJobsSalesList(Buffer.from(JSON.stringify(source)), {
    view: "active",
    minimumRows: 10,
  }), /exact Deal ID validation failed/);
});

test("Sales List validator rejects unsubmitted Anytime controls", () => {
  const source = JSON.parse(snapshot("active", 10).toString("utf8"));
  source.filters.applied = false;
  assert.throws(() => validateDripJobsSalesList(Buffer.from(JSON.stringify(source)), {
    view: "active",
    minimumRows: 10,
  }), /submitted backfill/);
});

test("Sales List validator rejects a DataTable total mismatch", () => {
  const source = JSON.parse(snapshot("archived", 100).toString("utf8"));
  source.datatable_total = 1_399;
  assert.throws(() => validateDripJobsSalesList(Buffer.from(JSON.stringify(source)), {
    view: "archived",
    minimumRows: 100,
  }), /DataTable total/);
});

test("Sales List changed delta accepts an empty submitted view", () => {
  const delta = (view) => Buffer.from(JSON.stringify({
    schema_version: 3,
    source_type: "dripjobs_sales_list_changed_rows_dom_v3",
    captured_at: "2026-08-20T12:00:00.000Z",
    view,
    filters: { created: "anytime", changed: "last_7_days", page_length: "-1", applied: true },
    headers: DRIPJOBS_SALES_LIST_HEADERS,
    total: 0,
    datatable_total: 0,
    rows: [],
  }));
  const result = validateDripJobsSalesExports({ active: delta("active"), archived: delta("archived") }, { scope: "changed_delta" });
  assert.equal(result.manifest.scope, "changed_delta");
  assert.equal(result.manifest.row_count, 0);
});
