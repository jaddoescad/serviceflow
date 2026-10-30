import { dateFilterBounds, isDatePreset, type DateFilter } from "@/lib/date-filter";
import type { TeamOption } from "@/lib/crm-types";

/** The customers list's search, filters, sort and page, as URL params.
 * Client-safe; lib/contacts.ts loads the rows. */

export type CustomerStatus = "" | "open" | "customer" | "lost";
export type CustomerSortKey = "name" | "created" | "activity" | "deals" | "jobs";

export const CUSTOMER_STATUSES: [Exclude<CustomerStatus, "">, string][] = [
  ["open", "Has an open deal"],
  ["customer", "Customer (has a job)"],
  ["lost", "Lost"],
];

export const CUSTOMER_PAGE_SIZE = 50;

export type CustomerListParams = {
  search: string;
  source: string;
  /** An employee id, "none", or "". */
  salesperson: string;
  status: CustomerStatus;
  created: DateFilter;
  sort: CustomerSortKey;
  desc: boolean;
  page: number;
};

export type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  jobCount: number;
  leadCount: number;
  openDealCount: number;
  projectCount: number;
  source: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  createdAt: string;
  lastActivityAt: string;
};

export type CustomerListOptions = {
  company: { id: string; name: string };
  sources: string[];
  team: TeamOption[];
  /** Open sales pipeline columns, for deals created by an import. */
  stages: { id: string; name: string; dripsEnabled: boolean }[];
};

const SORTS: CustomerSortKey[] = ["name", "created", "activity", "deals", "jobs"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type RawParams = Record<string, string | string[] | undefined>;

export function parseCustomerListParams(raw: RawParams): CustomerListParams {
  const get = (key: string) => {
    const value = raw[key];
    return (Array.isArray(value) ? value[0] : value)?.slice(0, 200) ?? "";
  };
  const preset = get("created");
  const from = get("from");
  const to = get("to");
  const created: DateFilter = !isDatePreset(preset)
    ? null
    : preset === "custom"
      ? DAY.test(from) || DAY.test(to)
        ? { preset, from: DAY.test(from) ? from : undefined, to: DAY.test(to) ? to : undefined }
        : null
      : { preset };
  const sort = SORTS.includes(get("sort") as CustomerSortKey) ? (get("sort") as CustomerSortKey) : "activity";
  const status = get("status");
  return {
    search: get("q"),
    source: get("source"),
    salesperson: get("salesperson"),
    status: CUSTOMER_STATUSES.some(([key]) => key === status) ? (status as CustomerStatus) : "",
    created,
    sort,
    desc: get("dir") ? get("dir") !== "asc" : sort !== "name",
    page: Math.max(1, Math.min(1_000_000, Number.parseInt(get("page") || "1", 10) || 1)),
  };
}

/** `/contacts?...` for these params; defaults are left out. */
export function customerListHref(params: CustomerListParams): string {
  const query = new URLSearchParams();
  if (params.search.trim()) query.set("q", params.search.trim());
  if (params.status) query.set("status", params.status);
  if (params.source) query.set("source", params.source);
  if (params.salesperson) query.set("salesperson", params.salesperson);
  if (params.created) {
    query.set("created", params.created.preset);
    if (params.created.preset === "custom") {
      if (params.created.from) query.set("from", params.created.from);
      if (params.created.to) query.set("to", params.created.to);
    }
  }
  if (params.sort !== "activity") query.set("sort", params.sort);
  if (params.desc !== (params.sort !== "name")) query.set("dir", params.desc ? "desc" : "asc");
  if (params.page > 1) query.set("page", String(params.page));
  return `/contacts${query.size ? `?${query}` : ""}`;
}

/** The filters argument of get_customer_list. */
export function customerListFilters(params: CustomerListParams, today?: string): Record<string, string> {
  const { from, to } = dateFilterBounds(params.created, today);
  const filters: Record<string, string> = {};
  if (params.source) filters.source = params.source;
  if (params.salesperson) filters.salesperson = params.salesperson;
  if (params.status) filters.status = params.status;
  if (from) filters.createdFrom = from;
  if (to) filters.createdTo = to;
  return filters;
}

export function customerFilterCount(params: CustomerListParams): number {
  return [params.source, params.salesperson, params.status, params.created].filter(Boolean).length;
}
