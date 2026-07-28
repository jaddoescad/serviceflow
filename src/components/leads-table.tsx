"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, CardHeader, EmptyState, Field, Input, Select } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { LeadEstimate } from "@/lib/types";

type LeadFilter = "all" | "no-address" | "addressed" | "started";

export function LeadsTable({ leads }: { leads: LeadEstimate[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LeadFilter>("all");

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-CA");

    return leads.filter((lead) => {
      if (filter === "no-address" && lead.hasStreetAddress) return false;
      if (filter === "addressed" && !lead.hasStreetAddress) return false;
      if (filter === "started" && !lead.estimateUpdatedAt) return false;
      if (!needle) return true;

      return [lead.name, lead.address, lead.projectId].some((value) =>
        value?.toLocaleLowerCase("en-CA").includes(needle),
      );
    });
  }, [filter, leads, search]);

  return (
    <Card>
      <CardHeader
        title="Active leads"
        subtitle="Estimates autosave by CompanyCam lead and stay attached when the lead becomes a job"
        right={<Badge tone="brand">{filtered.length} shown</Badge>}
      />

      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] p-4">
        <Field label="Search">
          <Input
            type="search"
            placeholder="Name, address, or CompanyCam ID…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-72"
          />
        </Field>
        <Field label="Filter">
          <Select
            value={filter}
            onChange={(event) => setFilter(event.target.value as LeadFilter)}
          >
            <option value="all">All active leads</option>
            <option value="no-address">No street address</option>
            <option value="addressed">Has street address</option>
            <option value="started">Estimate started</option>
          </Select>
        </Field>
      </div>

      {filtered.length === 0 ? (
        <EmptyState>No leads match.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-4 py-3 font-medium">Lead</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Added</th>
                <th className="px-4 py-3 font-medium">Estimate</th>
                <th className="px-4 py-3 text-right font-medium">
                  <span className="sr-only">Open calculator</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => {
                const calculatorHref = `/projects/${encodeURIComponent(
                  lead.projectId,
                )}/calculator?name=${encodeURIComponent(lead.name)}`;

                return (
                  <tr
                    key={lead.projectId}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={calculatorHref}
                        className="rounded font-medium text-[var(--color-heading)] underline decoration-transparent underline-offset-4 transition-colors hover:text-[var(--color-brand-strong)] hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                      >
                        {lead.name}
                      </Link>
                      <div className="mt-0.5 text-xs tabular-nums text-[var(--color-muted)]">
                        CompanyCam #{lead.projectId}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {lead.address ? (
                        <span>{lead.address}</span>
                      ) : (
                        <Badge tone="neutral">No address yet</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[var(--color-muted)]">
                      {fmtDate(lead.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {lead.estimateUpdatedAt ? (
                        <div>
                          <Badge tone="good">Estimate started</Badge>
                          <div className="mt-1 text-xs text-[var(--color-muted)]">
                            Saved {fmtDateTime(lead.estimateUpdatedAt)}
                          </div>
                        </div>
                      ) : (
                        <Badge tone="neutral">Not started</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={calculatorHref}
                        className="inline-flex items-center justify-center rounded-lg bg-[var(--color-brand)] px-3.5 py-2 text-sm font-medium text-[var(--color-brand-ink)] transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
                      >
                        {lead.estimateUpdatedAt ? "Continue estimate" : "Start estimate"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
