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
    <Card className="mb-4 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-[var(--color-heading)]">
            Filter transactions
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Use payment status and evidence to find what still needs attention.
          </p>
        </div>
        {activeFilterCount > 0 ? (
          <span className="rounded-full bg-[var(--color-brand-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-brand)]">
            {activeFilterCount} active
          </span>
        ) : null}
      </div>
      <form
        action="/financials"
        method="get"
        className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
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
        <Field label="Transaction type">
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
        <Field label="Search">
          <Input
            name="q"
            defaultValue={filters.query}
            placeholder="Counterparty or description"
          />
        </Field>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="subtle" className="flex-1">
            Apply filters
          </Button>
          <Link
            href="/financials"
            className="inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            Clear
          </Link>
        </div>
      </form>
    </Card>
  );
}
