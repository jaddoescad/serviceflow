"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { exportCustomersCsv } from "@/lib/actions/contacts";
import {
  CUSTOMER_PAGE_SIZE,
  CUSTOMER_STATUSES,
  customerFilterCount,
  customerListHref,
  type CustomerListOptions,
  type CustomerListParams,
  type CustomerRow,
  type CustomerSortKey,
  type CustomerStatus,
} from "@/lib/customer-list";
import { dayKey, fmtDate } from "@/lib/format";
import type { ProjectLabel } from "@/lib/project-workspace";
import { BulkActions, SelectBox } from "./bulk-actions";
import { CreateContactModal } from "./create-contact-form";
import { CustomerImport } from "./customer-import";
import { DateFilterField } from "./date-filter-field";
import { PageHeader } from "./kpi";
import { FilterIcon, SearchIcon, linkStyle } from "./pipeline-ui";
import { Popover } from "./popover";
import { DataTable, RowLink, SortTh, TablePanel, TableToolbar, Td, Th, Tr } from "./table-ui";
import { Button, EmptyState, Input, Select, cn } from "./ui";

const dash = <span className="text-[var(--color-faint)]">—</span>;

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3">
      <span className="pt-2 text-xs text-[var(--color-muted)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function CustomerFilterMenu({
  params,
  options,
  onChange,
}: {
  params: CustomerListParams;
  options: CustomerListOptions;
  onChange: (patch: Partial<CustomerListParams>) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = customerFilterCount(params);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      className="w-[min(320px,calc(100vw-2rem))] space-y-2.5 p-3"
      trigger={
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
          <FilterIcon className="h-3.5 w-3.5 text-[var(--color-muted)]" />
          Filter
          {active ? (
            <span className="rounded-[4px] bg-[var(--color-primary)] px-1 text-[11px] leading-4 text-[var(--color-primary-ink)]">
              {active}
            </span>
          ) : null}
        </Button>
      }
    >
      <FilterRow label="Status">
        <Select
          value={params.status}
          onChange={(event) => onChange({ status: event.target.value as CustomerStatus })}
          className="w-full"
        >
          <option value="">Any status</option>
          {CUSTOMER_STATUSES.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
      </FilterRow>
      <FilterRow label="Lead source">
        <Select value={params.source} onChange={(event) => onChange({ source: event.target.value })} className="w-full">
          <option value="">Any source</option>
          {params.source && !options.sources.includes(params.source) ? <option value={params.source}>{params.source}</option> : null}
          {options.sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </Select>
      </FilterRow>
      <FilterRow label="Salesperson">
        <Select value={params.salesperson} onChange={(event) => onChange({ salesperson: event.target.value })} className="w-full">
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {options.team.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
      </FilterRow>
      <FilterRow label="Created">
        <DateFilterField label="Created" value={params.created} onChange={(created) => onChange({ created })} />
      </FilterRow>
      {active ? (
        <div className="border-t border-[var(--color-border)] pt-2.5">
          <button
            type="button"
            onClick={() => onChange({ status: "", source: "", salesperson: "", created: null })}
            className={cn("text-xs", linkStyle)}
          >
            Clear filters
          </button>
        </div>
      ) : null}
    </Popover>
  );
}

export function ContactsTable({
  rows,
  total,
  params,
  options,
  labels,
  canManage,
  initiallyOpen = false,
}: {
  rows: CustomerRow[];
  total: number;
  params: CustomerListParams;
  options: CustomerListOptions;
  labels: ProjectLabel[];
  canManage: boolean;
  initiallyOpen?: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(params.search);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportError, setExportError] = useState("");
  const [pending, startTransition] = useTransition();
  const [exporting, startExport] = useTransition();
  const previousQuery = useRef(params.search);

  useEffect(() => {
    const previous = previousQuery.current;
    previousQuery.current = params.search;
    setSearch((value) => (value.trim() === previous ? params.search : value));
  }, [params.search]);

  // A new page, sort or filter starts a new selection.
  useEffect(() => {
    setSelected(new Set());
  }, [rows]);

  function navigate(patch: Partial<CustomerListParams>) {
    const href = customerListHref({ ...params, page: 1, ...patch });
    startTransition(() => router.replace(href, { scroll: false }));
  }

  useEffect(() => {
    if (search.trim() === params.search) return;
    const timer = setTimeout(() => navigate({ search }), 300);
    return () => clearTimeout(timer);
  }, [search, params.search]);

  function sortBy(key: CustomerSortKey) {
    navigate(params.sort === key ? { sort: key, desc: !params.desc } : { sort: key, desc: key !== "name" });
  }

  function exportCsv() {
    setExportError("");
    startExport(async () => {
      const result = await exportCustomersCsv(customerListHref(params).split("?")[1] ?? "").catch(() => null);
      if (!result?.csv) {
        setExportError(result?.error ?? "Could not export customers. Try again.");
        return;
      }
      const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `customers-${dayKey(new Date())}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));
  const first = (params.page - 1) * CUSTOMER_PAGE_SIZE + 1;
  const last = Math.min(params.page * CUSTOMER_PAGE_SIZE, total);
  const filtered = Boolean(params.search) || customerFilterCount(params) > 0;
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const header = (key: CustomerSortKey, label: string, className?: string, numeric = false) => (
    <SortTh
      label={label}
      active={params.sort === key}
      desc={params.desc}
      numeric={numeric}
      className={className}
      onClick={() => sortBy(key)}
    />
  );

  return (
    <>
      <PageHeader
        title="Customers"
        actions={
          <>
            {canManage ? <CustomerImport options={options} /> : null}
            <CreateContactModal initiallyOpen={initiallyOpen} />
          </>
        }
      />
      <TableToolbar>
        <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-faint)]" />
          <Input
            type="search"
            aria-label="Search customers"
            placeholder="Search customers"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-8"
          />
        </div>
        <CustomerFilterMenu params={params} options={options} onChange={navigate} />
      </TableToolbar>

      <TablePanel
        fill
        busy={pending}
        footer={
          <>
            <span className="flex items-center gap-3">
              <span className="tabular-nums">
                {total
                  ? `${first.toLocaleString("en-CA")}–${last.toLocaleString("en-CA")} of ${total.toLocaleString("en-CA")}`
                  : "0 customers"}
              </span>
              {canManage && total ? (
                <Button variant="ghost" size="sm" disabled={exporting} onClick={exportCsv}>
                  {exporting ? "Exporting…" : "Export CSV"}
                </Button>
              ) : null}
              {exportError ? (
                <span role="alert" className="text-[var(--tag-red-text)]">
                  {exportError}
                </span>
              ) : null}
            </span>
            {totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending || params.page <= 1}
                  onClick={() => navigate({ page: params.page - 1 })}
                >
                  Previous
                </Button>
                <span className="tabular-nums">
                  Page {params.page} of {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending || params.page >= totalPages}
                  onClick={() => navigate({ page: params.page + 1 })}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </>
        }
      >
        <DataTable>
          <thead>
            <tr>
              {canManage ? (
                <Th className="w-9 pr-0">
                  <SelectBox
                    label="Select all customers on this page"
                    checked={allSelected}
                    indeterminate={!allSelected && selectedRows.length > 0}
                    onChange={(checked) => setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set())}
                  />
                </Th>
              ) : null}
              {header("name", "Customer")}
              <Th className="hidden md:table-cell">Email</Th>
              <Th>Phone</Th>
              <Th className="hidden xl:table-cell">Address</Th>
              <Th className="hidden lg:table-cell">Source</Th>
              <Th className="hidden lg:table-cell">Salesperson</Th>
              {header("deals", "Deals", "hidden lg:table-cell", true)}
              {header("jobs", "Jobs", "hidden lg:table-cell", true)}
              {header("created", "Created", "hidden xl:table-cell", true)}
              {header("activity", "Last activity", "hidden sm:table-cell", true)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr
                key={row.id}
                className={selected.has(row.id) ? "bg-[var(--color-brand-soft)] hover:bg-[var(--color-brand-soft)]" : undefined}
              >
                {canManage ? (
                  <Td className="w-9 pr-0">
                    <SelectBox
                      label={`Select ${row.name}`}
                      checked={selected.has(row.id)}
                      onChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(row.id);
                          else next.delete(row.id);
                          return next;
                        })
                      }
                    />
                  </Td>
                ) : null}
                <Td className="max-w-64 truncate">
                  <RowLink href={`/contacts/${encodeURIComponent(row.id)}`}>{row.name}</RowLink>
                </Td>
                <Td className="hidden max-w-60 truncate md:table-cell">{row.email ?? dash}</Td>
                <Td className="whitespace-nowrap">{row.phone ?? dash}</Td>
                <Td className="hidden max-w-72 truncate xl:table-cell">{row.address ?? dash}</Td>
                <Td className="hidden max-w-40 truncate lg:table-cell">{row.source ?? dash}</Td>
                <Td className="hidden whitespace-nowrap lg:table-cell">{row.salespersonName ?? dash}</Td>
                <Td numeric className="hidden lg:table-cell">
                  {row.leadCount}
                </Td>
                <Td numeric className="hidden lg:table-cell">
                  {row.jobCount}
                </Td>
                <Td numeric muted className="hidden xl:table-cell">
                  {fmtDate(row.createdAt)}
                </Td>
                <Td numeric muted className="hidden sm:table-cell">
                  {fmtDate(row.lastActivityAt)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
        {rows.length ? null : filtered ? (
          <EmptyState>
            No customers match.{" "}
            <button
              type="button"
              onClick={() => {
                setSearch("");
                navigate({ search: "", status: "", source: "", salesperson: "", created: null });
              }}
              className={linkStyle}
            >
              Clear search and filters
            </button>
          </EmptyState>
        ) : (
          <EmptyState>No customers yet.</EmptyState>
        )}
      </TablePanel>

      {canManage ? (
        <BulkActions
          selected={selectedRows.length}
          noun="customer"
          target={{ contactIds: selectedRows.map((row) => row.id) }}
          dealCount={selectedRows.reduce((sum, row) => sum + row.openDealCount, 0)}
          team={options.team}
          labels={labels}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
    </>
  );
}
