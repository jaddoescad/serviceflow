"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  StatusText,
} from "@/components/ui";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { MarketingLead } from "@/lib/types";

type ProgressFilter = "all" | "unlinked" | "lead" | "estimate" | "job" | "proposal";
const PAGE_SIZE = 50;

function sourceLabel(lead: MarketingLead): string {
  if (lead.rawLeadSource?.trim()) return lead.rawLeadSource.trim();
  return "No source";
}

function sourceTone(
  lead: MarketingLead,
): "brand" | "good" | "neutral" {
  if (lead.normalizedChannel === "paid_social") return "brand";
  if (["referral", "organic_search"].includes(lead.normalizedChannel)) {
    return "good";
  }
  return "neutral";
}

function linkMethodLabel(
  method: MarketingLead["dripJobs"][number]["linkMethod"],
): string {
  if (method === "proposal_number") return "Proposal ID";
  if (method === "dripjobs_contact_uuid") return "DripJobs contact ID";
  if (method === "manual") return "Manually confirmed";
  if (method === "email_and_phone") return "Email + phone";
  if (method === "email") return "Email";
  if (method === "phone") return "Phone";
  return "Saved evidence";
}

function hasProgress(lead: MarketingLead, filter: ProgressFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unlinked") return lead.dripJobs.length === 0;
  if (filter === "lead") {
    return (
      lead.dripJobs.length === 0 &&
      !lead.proposalNumber &&
      lead.proposalAmount == null &&
      !lead.proposalOn
    );
  }
  if (filter === "estimate") {
    return Boolean(lead.estimateScheduledOn || lead.estimateAppointmentOn);
  }
  if (filter === "job") {
    return lead.dripJobs.length > 0;
  }
  return Boolean(lead.proposalNumber || lead.proposalAmount || lead.proposalOn);
}

const DEFAULT_YEAR = "2026";

export function LeadsTable({ leads }: { leads: MarketingLead[] }) {
  const [search, setSearch] = useState("");
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [month, setMonth] = useState("all");
  const [source, setSource] = useState("all");
  const [progress, setProgress] = useState<ProgressFilter>("all");
  const [page, setPage] = useState(1);

  const isFiltered =
    search !== "" || year !== DEFAULT_YEAR || month !== "all" || source !== "all" || progress !== "all";

  const years = useMemo(
    () => [...new Set(leads.map((lead) => lead.createdOn.slice(0, 4)))].sort().reverse(),
    [leads],
  );
  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of leads) {
      if (year !== "all" && !lead.createdOn.startsWith(`${year}-`)) continue;
      const label = sourceLabel(lead);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en-CA"),
    );
  }, [leads, year]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-CA");
    return leads.filter((lead) => {
      if (year !== "all" && !lead.createdOn.startsWith(`${year}-`)) return false;
      if (month !== "all" && lead.createdOn.slice(5, 7) !== month) return false;
      if (source !== "all" && sourceLabel(lead) !== source) return false;
      if (!hasProgress(lead, progress)) return false;
      if (!needle) return true;
      return [
        lead.name,
        lead.email,
        lead.phone,
        lead.address,
        lead.postalCode,
        lead.dealId,
        lead.rawLeadSource,
        lead.proposalNumber,
        ...lead.dripJobs.flatMap((job) => [
          job.jobName,
          job.proposalId,
          job.status,
        ]),
      ].some((value) => value?.toLocaleLowerCase("en-CA").includes(needle));
    });
  }, [leads, month, progress, search, source, year]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function updateFilters(update: () => void) {
    update();
    setPage(1);
  }

  function resetFilters() {
    updateFilters(() => {
      setSearch("");
      setYear(DEFAULT_YEAR);
      setMonth("all");
      setSource("all");
      setProgress("all");
    });
  }

  return (
    <Card>
      <CardHeader
        title="All leads"
        subtitle="One row per Deal ID from the maintained All Leads table"
        right={<Badge tone="brand">{filtered.length.toLocaleString("en-CA")} shown</Badge>}
      />

      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] p-4">
        <Field label="Search">
          <Input
            type="search"
            placeholder="Name, contact, address, Deal ID…"
            value={search}
            onChange={(event) => updateFilters(() => setSearch(event.target.value))}
            className="w-60"
          />
        </Field>
        <Field label="Year">
          <Select
            value={year}
            onChange={(event) =>
              updateFilters(() => {
                setYear(event.target.value);
                setSource("all");
              })
            }
            className="w-28"
          >
            <option value="all">All years</option>
            {years.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </Field>
        <Field label="Month">
          <Select
            value={month}
            onChange={(event) => updateFilters(() => setMonth(event.target.value))}
            className="w-28"
          >
            <option value="all">All months</option>
            {Array.from({ length: 12 }, (_, index) => {
              const value = String(index + 1).padStart(2, "0");
              const label = new Intl.DateTimeFormat("en-CA", {
                month: "short",
                timeZone: "UTC",
              }).format(new Date(Date.UTC(2026, index, 1)));
              return <option key={value} value={value}>{label}</option>;
            })}
          </Select>
        </Field>
        <Field label="Lead source">
          <Select
            value={source}
            onChange={(event) => updateFilters(() => setSource(event.target.value))}
            className="w-48"
          >
            <option value="all">All sources</option>
            {sources.map(([option, count]) => (
              <option key={option} value={option}>{option} ({count})</option>
            ))}
          </Select>
        </Field>
        <Field label="Progress">
          <Select
            value={progress}
            onChange={(event) =>
              updateFilters(() => setProgress(event.target.value as ProgressFilter))
            }
            className="w-48"
          >
            <option value="all">All records</option>
            <option value="unlinked">No DripJobs job</option>
            <option value="lead">Lead only</option>
            <option value="estimate">Estimate booked</option>
            <option value="proposal">Proposal recorded</option>
            <option value="job">Converted to job</option>
          </Select>
        </Field>
        {isFiltered ? (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="mb-0.5">
            Reset filters
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <EmptyState>No leads match these filters.</EmptyState>
      ) : (
        <>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium">Lead</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Location</th>
                  <th className="px-4 py-2.5 font-medium">Progress</th>
                  <th className="px-4 py-2.5 font-medium">DripJobs job</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((lead) => {
                  const firstJob = lead.dripJobs[0];
                  const estimateOn =
                    lead.estimateAppointmentOn ?? lead.estimateScheduledOn;
                  const jobCount = lead.dripJobs.length;
                  return (
                    <tr
                      key={lead.dealId}
                      className="border-b border-[var(--color-border)] align-top last:border-0 hover:bg-[var(--color-surface-2)]"
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 text-[var(--color-muted)]">
                        {fmtDate(lead.createdOn)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-[var(--color-heading)]" title={lead.dealId}>{lead.name}</div>
                        <div className="mt-0.5 max-w-48 truncate font-mono text-[10px] text-[var(--color-muted)]" title={lead.dealId}>
                          {lead.dealId}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={sourceTone(lead)}>{sourceLabel(lead)}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        {lead.phone ? (
                          <a className="block text-[var(--color-heading)] hover:underline" href={`tel:${lead.phone}`}>{lead.phone}</a>
                        ) : null}
                        {lead.email ? (
                          <a className="mt-0.5 block max-w-56 truncate text-xs text-[var(--color-muted)] hover:underline" href={`mailto:${lead.email}`} title={lead.email}>{lead.email}</a>
                        ) : null}
                        {!lead.phone && !lead.email ? <StatusText tone="warn">No contact details</StatusText> : null}
                      </td>
                      <td className="max-w-64 px-4 py-2.5">
                        {lead.address ? <div>{lead.address}</div> : <span className="text-[var(--color-muted)]">No address</span>}
                        {lead.postalCode ? <div className="mt-0.5 text-xs text-[var(--color-muted)]">{lead.postalCode}</div> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        {jobCount > 0 ? <StatusText tone="good">{jobCount === 1 ? "Job" : `${jobCount} jobs`}</StatusText> : null}
                        {estimateOn ? (
                          <div className={jobCount ? "mt-1" : undefined}>
                            <StatusText tone="brand">Estimate {fmtDate(estimateOn)}</StatusText>
                          </div>
                        ) : null}
                        {lead.proposalAmount != null || lead.proposalNumber ? (
                          <div className={jobCount || estimateOn ? "mt-1 text-xs text-[var(--color-muted)]" : "text-xs text-[var(--color-muted)]"}>
                            Proposal {lead.proposalNumber ? `#${lead.proposalNumber}` : ""}
                            {lead.proposalAmount != null ? ` · ${fmtMoney(lead.proposalAmount)}` : ""}
                          </div>
                        ) : null}
                        {!jobCount && !estimateOn && lead.proposalAmount == null && !lead.proposalNumber ? (
                          <StatusText tone="neutral">Lead only</StatusText>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        {firstJob ? (
                          <div>
                            <div className="font-medium text-[var(--color-heading)]">
                              {firstJob.jobName}
                            </div>
                            <div className="mt-0.5 max-w-56 truncate text-xs text-[var(--color-muted)]">
                              Proposal #{firstJob.proposalId} · {firstJob.status}
                              {firstJob.amount > 0 ? ` · ${fmtMoney(firstJob.amount)}` : ""}
                            </div>
                            <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                              Saved relationship · {linkMethodLabel(firstJob.linkMethod)}
                            </div>
                            {lead.dripJobs.length > 1 ? (
                              <div className="mt-1 text-xs text-[var(--color-muted)]">+{lead.dripJobs.length - 1} more linked jobs</div>
                            ) : null}
                          </div>
                        ) : (
                          <StatusText tone="neutral">Not linked</StatusText>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3">
            <div className="text-xs text-[var(--color-muted)]">
              Showing {((safePage - 1) * PAGE_SIZE + 1).toLocaleString("en-CA")}–{Math.min(safePage * PAGE_SIZE, filtered.length).toLocaleString("en-CA")} of {filtered.length.toLocaleString("en-CA")}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="subtle" size="sm" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
              <span className="text-xs tabular-nums text-[var(--color-muted)]">Page {safePage} of {totalPages}</span>
              <Button variant="subtle" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
