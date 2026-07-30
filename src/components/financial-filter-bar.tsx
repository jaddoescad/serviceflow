"use client";

import { Button, Card, Field, Input, Select } from "@/components/ui";
import type { FinancialAccount } from "@/lib/financials";
import Link from "next/link";
import type { ChangeEvent } from "react";

export type FinancialFilters = {
  year: number;
  account: string;
  category: string;
  query: string;
  status: "all" | "needs_review" | "reconciled" | "paid";
  transactionType: "all" | "income" | "expense" | "transfer" | "credit";
  evidence: "all" | "matched" | "no_document" | "missing";
};

function applySelectFilter(event: ChangeEvent<HTMLSelectElement>) {
  event.currentTarget.form?.requestSubmit();
}

export function FinancialFilterBar({
  filters,
  years,
  accounts,
  categories,
}: {
  filters: FinancialFilters;
  years: number[];
  accounts: FinancialAccount[];
  categories: string[];
}) {
  const activeFilterCount = [
    filters.account !== "all",
    filters.category !== "all",
    filters.status !== "all",
    filters.transactionType !== "all",
    filters.evidence !== "all",
    Boolean(filters.query),
  ].filter(Boolean).length;

  return (
    <Card className="mb-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">
          Filter transactions
        </h2>
        {activeFilterCount > 0 ? (
          <span className="rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-brand)]">
            {activeFilterCount} active
          </span>
        ) : null}
      </div>
      <form
        action="/financials"
        method="get"
        className="flex flex-wrap items-end gap-2"
      >
        <div className="w-[90px]">
          <Field label="Year">
            <Select
              name="year"
              defaultValue={String(filters.year)}
              className="w-full"
              onChange={applySelectFilter}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-[145px]">
          <Field label="Payment / review">
            <Select
              name="status"
              defaultValue={filters.status}
              className="w-full"
              onChange={applySelectFilter}
            >
              <option value="all">All statuses</option>
              <option value="needs_review">Needs review</option>
              <option value="paid">Paid invoice</option>
              <option value="reconciled">Reconciled</option>
            </Select>
          </Field>
        </div>
        <div className="w-[178px]">
          <Field label="Supporting evidence">
            <Select
              name="evidence"
              defaultValue={filters.evidence}
              className="w-full"
              onChange={applySelectFilter}
            >
              <option value="all">All evidence</option>
              <option value="matched">Invoice or email matched</option>
              <option value="no_document">No document required</option>
              <option value="missing">Missing document</option>
            </Select>
          </Field>
        </div>
        <div className="w-[132px]">
          <Field label="Type">
            <Select
              name="type"
              defaultValue={filters.transactionType}
              className="w-full"
              onChange={applySelectFilter}
            >
              <option value="all">All types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
              <option value="transfer">Transfer</option>
              <option value="credit">Credit</option>
            </Select>
          </Field>
        </div>
        <div className="w-[198px]">
          <Field label="Account">
            <Select
              name="account"
              defaultValue={filters.account}
              className="w-full"
              onChange={applySelectFilter}
            >
              <option value="all">All business accounts</option>
              {accounts.map((account) => (
                <option key={account.slug} value={account.slug}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-[185px]">
          <Field label="Category">
            <Select
              name="category"
              defaultValue={filters.category}
              className="w-full"
              onChange={applySelectFilter}
            >
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-full sm:w-[220px]">
          <Field label="Search">
            <Input
              name="q"
              defaultValue={filters.query}
              placeholder="Counterparty or description"
            />
          </Field>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="submit" variant="subtle" size="sm">
            Apply filters
          </Button>
          <Link
            href="/financials"
            className="inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            Clear
          </Link>
        </div>
      </form>
    </Card>
  );
}
