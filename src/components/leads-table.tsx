"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, Input, Select, cn } from "@/components/ui";
import { fmtDate, fmtMoney } from "@/lib/format";
import type { MarketingLead } from "@/lib/types";

type ProgressFilter = "all" | "unlinked" | "lead" | "estimate" | "job" | "proposal";

type Stage = {
  label: string;
  tone: "neutral" | "brand" | "warn" | "good";
};

const PAGE_SIZE = 50;
const DEFAULT_YEAR = "2026";

const PROGRESS_SCOPES: Array<{
  value: ProgressFilter;
  label: string;
  title: string;
}> = [
  { value: "all", label: "All", title: "All records" },
  { value: "unlinked", label: "Unlinked", title: "No DripJobs job" },
  { value: "lead", label: "Lead", title: "No estimate, proposal, or job yet" },
  { value: "estimate", label: "Estimate", title: "Estimate booked" },
  { value: "proposal", label: "Proposal", title: "Proposal recorded" },
  { value: "job", label: "Job", title: "Converted to job" },
];

const stageTones: Record<Stage["tone"], string> = {
  neutral: "bg-[var(--color-chip-muted)] text-[var(--color-muted)]",
  brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]",
  warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
  good: "bg-[var(--color-good-soft)] text-[var(--color-good)]",
};

function sourceLabel(lead: MarketingLead): string {
  return lead.rawLeadSource?.trim() || "No source";
}

function sourceTone(lead: MarketingLead): "neutral" | "brand" | "good" {
  if (lead.normalizedChannel === "paid_social") return "brand";
  if (["referral", "organic_search"].includes(lead.normalizedChannel)) return "good";
  return "neutral";
}

function hasProgress(lead: MarketingLead, filter: ProgressFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unlinked") return lead.dripJobs.length === 0;
  if (filter === "lead") {
    return (
      lead.dripJobs.length === 0 &&
      !lead.estimateScheduledOn &&
      !lead.estimateAppointmentOn &&
      !lead.proposalNumber &&
      lead.proposalAmount == null &&
      !lead.proposalOn
    );
  }
  if (filter === "estimate") {
    return Boolean(lead.estimateScheduledOn || lead.estimateAppointmentOn);
  }
  if (filter === "job") return lead.dripJobs.length > 0;
  return Boolean(lead.proposalNumber || lead.proposalAmount || lead.proposalOn);
}

function leadStage(lead: MarketingLead): Stage {
  if (lead.dripJobs.length > 0) {
    return {
      label: lead.dripJobs.length === 1 ? "Job" : `${lead.dripJobs.length} jobs`,
      tone: "good",
    };
  }
  if (lead.proposalNumber || lead.proposalAmount != null || lead.proposalOn) {
    return { label: "Proposal", tone: "warn" };
  }
  if (lead.estimateAppointmentOn || lead.estimateScheduledOn) {
    return { label: "Estimate", tone: "brand" };
  }
  return { label: "Lead", tone: "neutral" };
}

type IconProps = { className?: string };

function iconAttrs(className?: string) {
  return {
    "aria-hidden": true,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
  } as const;
}

function SearchIcon({ className }: IconProps) {
  return (
    <svg {...iconAttrs(className)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

function ImageIcon({ className }: IconProps) {
  return (
    <svg {...iconAttrs(className)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.6" />
      <path d="m21 15-4.2-4.2L6 21" />
    </svg>
  );
}

function PhotoPlaceholder({ text }: { text?: string }) {
  return (
    <div
      aria-hidden="true"
      className="grid h-[52px] w-[52px] place-items-center rounded-lg border border-dashed border-[var(--color-border)] text-[var(--color-muted)]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, var(--color-surface-2), var(--color-surface-2) 6px, var(--color-chip-muted) 6px, var(--color-chip-muted) 12px)",
      }}
    >
      {text ? (
        <span className="font-mono text-[9px]">{text}</span>
      ) : (
        <ImageIcon className="h-3.5 w-3.5" />
      )}
    </div>
  );
}

export function LeadsTable({ leads }: { leads: MarketingLead[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [month, setMonth] = useState("all");
  const [source, setSource] = useState("all");
  const [progress, setProgress] = useState<ProgressFilter>("all");
  const [page, setPage] = useState(1);

  const isFiltered =
    search !== "" ||
    year !== DEFAULT_YEAR ||
    month !== "all" ||
    source !== "all" ||
    progress !== "all";

  const years = useMemo(
    () => [...new Set(leads.map((lead) => lead.createdOn.slice(0, 4)))].sort().reverse(),
    [leads],
  );

  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const value = String(index + 1).padStart(2, "0");
        const label = new Intl.DateTimeFormat("en-CA", {
          month: "short",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(2026, index, 1)));
        return { value, label };
      }),
    [],
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

  const scoped = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-CA");
    return leads.filter((lead) => {
      if (year !== "all" && !lead.createdOn.startsWith(`${year}-`)) return false;
      if (month !== "all" && lead.createdOn.slice(5, 7) !== month) return false;
      if (source !== "all" && sourceLabel(lead) !== source) return false;
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
        ...lead.dripJobs.flatMap((job) => [job.jobName, job.proposalId, job.status]),
      ].some((value) => value?.toLocaleLowerCase("en-CA").includes(needle));
    });
  }, [leads, month, search, source, year]);

  const scopeCounts = useMemo(() => {
    const counts = Object.fromEntries(
      PROGRESS_SCOPES.map((scope) => [scope.value, 0]),
    ) as Record<ProgressFilter, number>;
    for (const lead of scoped) {
      for (const scope of PROGRESS_SCOPES) {
        if (hasProgress(lead, scope.value)) counts[scope.value] += 1;
      }
    }
    return counts;
  }, [scoped]);

  const filtered = useMemo(
    () => scoped.filter((lead) => hasProgress(lead, progress)),
    [progress, scoped],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const dateFilter = `${year}:${month}`;

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
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1"
          role="group"
          aria-label="Lead scope"
        >
          {PROGRESS_SCOPES.map((scope) => {
            const active = progress === scope.value;
            return (
              <button
                key={scope.value}
                type="button"
                title={scope.title}
                aria-pressed={active}
                onClick={() => updateFilters(() => setProgress(scope.value))}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-[var(--color-heading)] font-semibold text-[var(--color-surface)]"
                    : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                )}
              >
                {scope.label}{" "}
                <span className="tabular-nums opacity-65">
                  {scopeCounts[scope.value].toLocaleString("en-CA")}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative min-w-48 flex-1 sm:max-w-[250px]">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
            <Input
              type="search"
              aria-label="Search leads"
              placeholder="Search leads…"
              value={search}
              onChange={(event) => updateFilters(() => setSearch(event.target.value))}
              className="bg-[var(--color-surface)] py-1.5 pl-9 text-[13px]"
            />
          </div>

          <Select
            aria-label="Filter by date"
            value={dateFilter}
            onChange={(event) => {
              const [nextYear, nextMonth] = event.target.value.split(":");
              updateFilters(() => {
                if (nextYear !== year) setSource("all");
                setYear(nextYear);
                setMonth(nextMonth);
              });
            }}
            className="w-auto min-w-40 bg-[var(--color-surface)] py-1.5 text-[13px]"
          >
            <option value="all:all">All dates</option>
            {years.flatMap((optionYear) => [
              <option key={`${optionYear}:all`} value={`${optionYear}:all`}>
                {optionYear} · All months
              </option>,
              ...monthOptions.map((optionMonth) => (
                <option
                  key={`${optionYear}:${optionMonth.value}`}
                  value={`${optionYear}:${optionMonth.value}`}
                >
                  {optionYear} · {optionMonth.label}
                </option>
              )),
            ])}
          </Select>

          <Select
            aria-label="Filter by lead source"
            value={source}
            onChange={(event) => updateFilters(() => setSource(event.target.value))}
            className="w-auto min-w-36 max-w-52 bg-[var(--color-surface)] py-1.5 text-[13px]"
          >
            <option value="all">All sources</option>
            {sources.map(([option, count]) => (
              <option key={option} value={option}>
                {option} ({count})
              </option>
            ))}
          </Select>

          {isFiltered ? (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState>No leads match these filters.</EmptyState>
        ) : (
          <>
            <div className="max-h-[72vh] overflow-auto">
              {visible.map((lead) => {
                const projectHref = `/jobs/${encodeURIComponent(lead.leadId)}`;
                const estimateOn = lead.estimateAppointmentOn ?? lead.estimateScheduledOn;
                const hasProposal =
                  lead.proposalAmount != null || Boolean(lead.proposalNumber);
                const stage = leadStage(lead);

                return (
                  <div
                    key={lead.dealId}
                    role="link"
                    tabIndex={0}
                    aria-label={`Open ${lead.name}`}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("a,button,input,select")) return;
                      router.push(projectHref);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      router.push(projectHref);
                    }}
                    onMouseEnter={() => router.prefetch(projectHref)}
                    onFocus={() => router.prefetch(projectHref)}
                    className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-[var(--color-border)] px-4 py-3 outline-none last:border-0 hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)] sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto_7rem_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2.5">
                        <span className="truncate font-display text-sm font-semibold tracking-[-0.01em] text-[var(--color-heading)] sm:max-w-[45%]">
                          {lead.name}
                        </span>
                        <span className="truncate text-xs text-[var(--color-muted)]">
                          {lead.address || "No address on file"}
                          {lead.postalCode ? ` · ${lead.postalCode}` : ""}
                        </span>
                      </div>

                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-[var(--color-muted)]">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
                            sourceTone(lead) === "brand"
                              ? "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
                              : sourceTone(lead) === "good"
                                ? "bg-[var(--color-good-soft)] text-[var(--color-good)]"
                                : "bg-[var(--color-chip-muted)] text-[var(--color-muted)]",
                          )}
                        >
                          {sourceLabel(lead)}
                        </span>
                        {estimateOn ? (
                          <span className="font-medium text-[var(--color-brand-strong)]">
                            Estimate {fmtDate(estimateOn)}
                          </span>
                        ) : null}
                        {hasProposal ? (
                          <span className="truncate">
                            Proposal{lead.proposalNumber ? ` #${lead.proposalNumber}` : ""}
                            {lead.proposalAmount != null
                              ? ` · ${fmtMoney(lead.proposalAmount)}`
                              : ""}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                        stageTones[stage.tone],
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                      {stage.label}
                    </span>

                    <span className="hidden text-right text-xs text-[var(--color-muted)] lg:block">
                      Created {fmtDate(lead.createdOn)}
                    </span>

                    <div className="hidden gap-1.5 lg:flex">
                      <PhotoPlaceholder />
                      <PhotoPlaceholder text="photo" />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 sm:px-5">
              <div className="text-xs text-[var(--color-muted)]">
                {((safePage - 1) * PAGE_SIZE + 1).toLocaleString("en-CA")}–
                {Math.min(safePage * PAGE_SIZE, filtered.length).toLocaleString("en-CA")} of{" "}
                {filtered.length.toLocaleString("en-CA")}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs tabular-nums text-[var(--color-muted)]">
                  Page {safePage} of {totalPages}
                </span>
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
