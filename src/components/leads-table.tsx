"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, Input, cn } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { getDealMedia } from "@/lib/deal-media";
import type { MarketingLead } from "@/lib/types";

const PAGE_SIZE = 50;

function sourceLabel(lead: MarketingLead): string {
  return lead.rawLeadSource?.trim() || "No source";
}

function sourceTone(lead: MarketingLead): "neutral" | "brand" | "good" {
  if (lead.normalizedChannel === "paid_social") return "brand";
  if (["referral", "organic_search"].includes(lead.normalizedChannel)) return "good";
  return "neutral";
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

function LeadMediaPreview({ lead }: { lead: MarketingLead }) {
  const photos = lead.media.filter((item) => item.mediaType === "image").slice(0, 2);
  if (!photos.length) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
        <PhotoPlaceholder />
        <span>{lead.mediaCount > 0 ? "No image preview" : "No photos"}</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-end gap-1.5"
      aria-label={`${lead.mediaCount} ${lead.mediaCount === 1 ? "photo or video" : "photos and videos"}`}
    >
      {photos.map((photo) => (
        <div
          key={photo.id}
          className="relative h-[52px] w-[52px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]"
        >
          <Image
            src={`/api/jobs/${encodeURIComponent(photo.ownerProjectId)}/media/${encodeURIComponent(photo.id)}?preview=1`}
            alt=""
            fill
            unoptimized
            sizes="52px"
            className="object-cover"
          />
        </div>
      ))}
      {lead.mediaCount > photos.length ? (
        <span className="min-w-7 text-right text-[11px] font-medium text-[var(--color-muted)]">
          +{lead.mediaCount - photos.length}
        </span>
      ) : null}
    </div>
  );
}

export function LeadsTable({ leads, total, currentPage, query }: { leads: MarketingLead[]; total: number; currentPage: number; query: string }) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const [pending, startTransition] = useTransition();
  const [photos, setPhotos] = useState<{ source: MarketingLead[]; rows: MarketingLead[] } | null>(null);
  const previousQuery = useRef(query);
  useEffect(() => {
    const previous = previousQuery.current;
    previousQuery.current = query;
    setSearch(value => value.trim() === previous ? query : value);
  }, [query]);
  useEffect(() => {
    let cancelled = false;
    getDealMedia(leads).then(rows => { if (!cancelled) setPhotos({ source: leads, rows }); }).catch(() => {
      // Keep the valid list visible when the independent media request fails.
    });
    return () => { cancelled = true; };
  }, [leads]);
  function navigate(page: number, value: string) {
    const params = new URLSearchParams();
    if (value.trim()) params.set("q", value.trim());
    if (page > 1) params.set("page", String(page));
    startTransition(() => router.replace(`/deals${params.size ? `?${params}` : ""}`, { scroll: false }));
  }
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => navigate(1, search), 300);
    return () => clearTimeout(timer);
  }, [search, query]);
  const isFiltered = search !== "";
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = currentPage;
  const mediaLoaded = photos?.source === leads;
  const visible = mediaLoaded ? photos.rows : leads;
  function resetFilters() { setSearch(""); navigate(1, ""); }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative min-w-48 flex-1 sm:max-w-[250px]">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]" />
            <Input
              type="search"
              aria-label="Search deals"
              placeholder="Search deals…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="bg-[var(--color-surface)] py-1.5 pl-9 text-[13px]"
            />
          </div>



          {isFiltered ? (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="overflow-hidden" aria-busy={pending}>
        {visible.length === 0 ? (
          <EmptyState>No deals match your search.</EmptyState>
        ) : (
          <>
            <div className="max-h-[72vh] overflow-auto">
              <div className="sticky top-0 z-10 grid grid-cols-1 items-center gap-x-4 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-xs font-semibold text-[var(--color-muted)] sm:px-5 lg:grid-cols-[minmax(0,1fr)_8rem_10rem]">
                <span>Deal</span>
                <span className="hidden text-right lg:block">Updated at</span>
                <span className="hidden lg:block">Photos</span>
              </div>
              {visible.map((lead) => {
                const projectHref = `/jobs/${encodeURIComponent(lead.job?.jobId ?? lead.leadId)}`;

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
                    className="grid cursor-pointer grid-cols-1 items-center gap-x-4 border-b border-[var(--color-border)] px-4 py-3 outline-none last:border-0 hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)] sm:px-5 lg:grid-cols-[minmax(0,1fr)_8rem_10rem]"
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
                        <span className="lg:hidden">Updated {fmtDate(lead.updatedAt)}</span>
                      </div>
                    </div>

                    <span className="hidden text-right text-xs text-[var(--color-muted)] lg:block">
                      {fmtDate(lead.updatedAt)}
                    </span>

                    <div className="hidden lg:block">
                      {mediaLoaded ? <LeadMediaPreview lead={lead} /> : <PhotoPlaceholder />}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 sm:px-5">
              <div className="text-xs text-[var(--color-muted)]">
                {((safePage - 1) * PAGE_SIZE + 1).toLocaleString("en-CA")}–
                {Math.min(safePage * PAGE_SIZE, total).toLocaleString("en-CA")} of{" "}
                {total.toLocaleString("en-CA")}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={pending || safePage <= 1}
                  onClick={() => navigate(Math.max(1, safePage - 1), query)}
                >
                  Previous
                </Button>
                <span className="text-xs tabular-nums text-[var(--color-muted)]">
                  Page {safePage} of {totalPages}
                </span>
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={pending || safePage >= totalPages}
                  onClick={() => navigate(Math.min(totalPages, safePage + 1), query)}
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
