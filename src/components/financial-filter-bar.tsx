"use client";

import { Button, Card, Field, Input, Select } from "@/components/ui";
import type { FinancialAccount } from "@/lib/financials";
import type { ChangeEvent } from "react";

export type FinancialFilters = {
  year: number;
  account: string;
  category: string;
  query: string;
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
  return (
    <Card className="mb-4 p-4">
      <form
        action="/financials"
        method="get"
        className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[140px_230px_230px_minmax(220px,1fr)_auto]"
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
        <Button type="submit" variant="subtle">
          Apply filters
        </Button>
      </form>
    </Card>
  );
}
