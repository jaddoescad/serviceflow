"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { setDealSettings } from "@/lib/actions/crm";
import type { DealOverview } from "@/lib/crm-types";
import { fmtDateTime, fmtRelativeTime, fmtTime } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";
import type { DealRecord as DealRecordData } from "@/lib/pipeline";
import { DEAL_TABS, PIPELINE_TITLES, type DealTab } from "@/lib/pipeline-types";
import type { ProjectLabel } from "@/lib/project-workspace";
import {
  AppointmentsPanel,
  AttachmentsPanel,
  CommunicationsPanel,
  InvoicesPanel,
  JOB_STATUS_LABELS,
  NotesPanel,
  ProposalsPanel,
  appointmentStatus,
  documentHref,
  proposalStatus,
} from "./deal-tabs";
import { DealDrips } from "./deal-drips";
import { PortalLinkButton } from "./portal-link-button";
import { MoveDealDialog } from "./move-deal-dialog";
import {
  BackIcon,
  CalendarIcon,
  CheckIcon,
  ChevronIcon,
  CopyIcon,
  DocumentIcon,
  Dot,
  Initials,
  LabelTags,
  MailIcon,
  PhoneIcon,
  PlusIcon,
  TagIcon,
  fmtDay,
  linkStyle,
  stageColors,
} from "./pipeline-ui";
import { ProjectLabelPicker } from "./project-label-picker";
import { Badge, Select, Tag, buttonClassName, cn } from "./ui";

/** A deal's (or job's) record page: HubSpot's layout (properties left,
 * activity center, associated records right) in the Attio style. */

/** A borderless Select that reads as a value until hovered. */
const inlineSelect =
  "-ml-1.5 h-7 w-[calc(100%+0.375rem)] cursor-pointer truncate border-transparent bg-transparent pl-1.5 text-[var(--color-heading)] hover:border-[var(--color-border-strong)] disabled:bg-transparent";
const sectionTitle = "text-sm font-semibold text-[var(--color-heading)]";

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-9 grid-cols-[96px_minmax(0,1fr)] items-center gap-2 border-b border-[var(--color-border)] py-1 last:border-b-0">
      <dt className="text-xs text-[var(--color-muted)]">{label}</dt>
      <dd className="min-w-0 text-[13px] text-[var(--color-heading)]">{children}</dd>
    </div>
  );
}

const Empty = () => <span className="text-[var(--color-faint)]">—</span>;

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      onClick={() =>
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className="shrink-0 rounded p-1 text-[var(--color-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)]"
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5 text-[var(--tag-green-text)]" /> : <CopyIcon className="h-3.5 w-3.5" />}
    </button>
  );
}

function QuickAction({ href, label, title, icon }: { href: string | null; label: string; title: string; icon: ReactNode }) {
  const body = (
    <>
      <span className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-heading)] transition-colors group-hover:bg-[var(--color-hover)]">
        {icon}
      </span>
      <span>{label}</span>
    </>
  );
  const className = "group flex flex-col items-center gap-1 text-xs text-[var(--color-muted)]";
  if (!href) {
    return (
      <span aria-disabled="true" title={title} className={cn(className, "opacity-40")}>
        {body}
      </span>
    );
  }
  return href.startsWith("/") ? (
    <Link href={href} title={title} className={className}>
      {body}
    </Link>
  ) : (
    <a href={href} title={title} className={className}>
      {body}
    </a>
  );
}

function Association({
  title,
  count,
  addHref,
  addLabel,
  children,
}: {
  title: string;
  count: number;
  addHref?: string | null;
  addLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b border-[var(--color-border)] px-4 py-3">
      <div className="flex h-7 items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="-ml-1 flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-[13px] font-semibold text-[var(--color-heading)] hover:bg-[var(--color-hover)]"
        >
          <ChevronIcon className={cn("h-3 w-3 text-[var(--color-faint)] transition-transform", open && "rotate-90")} />
          {title}
          <Tag>{count}</Tag>
        </button>
        {addHref ? (
          <Link
            href={addHref}
            aria-label={addLabel}
            title={addLabel}
            className={buttonClassName({ variant: "ghost", size: "sm", className: "w-7 px-0" })}
          >
            <PlusIcon />
          </Link>
        ) : null}
      </div>
      {open ? <div className="mt-1.5">{children}</div> : null}
    </section>
  );
}

function AssociationRow({ href, title, meta, external }: { href: string; title: ReactNode; meta: ReactNode; external?: boolean }) {
  const className =
    "-mx-2 flex min-h-8 items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 py-1 text-[13px] hover:bg-[var(--color-hover)]";
  const body = (
    <>
      <span className="min-w-0 truncate text-[var(--color-heading)]">{title}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-[var(--color-muted)]">{meta}</span>
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

/** For a sideways-scrolling strip: fades whichever end has more out of view. */
function useEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const start = element.scrollLeft > 1;
    const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);
  const style =
    edges.start || edges.end
      ? {
          maskImage: `linear-gradient(to right, ${edges.start ? "transparent, #000 2rem" : "#000"}, ${
            edges.end ? "#000 calc(100% - 2rem), transparent" : "#000"
          })`,
        }
      : undefined;
  return { ref, measure, style };
}

const None = ({ children }: { children: ReactNode }) => (
  <p className="py-1 text-[13px] text-[var(--color-faint)]">{children}</p>
);

export function DealRecord({
  deal,
  extras,
  pipeline,
  stages,
  labels,
  updatedAt,
  allLabels,
  initialTab,
}: DealRecordData & { allLabels: ProjectLabel[]; initialTab: DealTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState(initialTab);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [editingLabels, setEditingLabels] = useState(false);
  const [settings, setSettings] = useState(deal.settings);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const stageStrip = useEdgeFade<HTMLOListElement>();
  const sectionTabs = useEdgeFade<HTMLElement>();

  useEffect(() => {
    setSettings(deal.settings);
  }, [deal.settings]);

  // When the stage strip scrolls, bring the current stage into view.
  const { ref: stripRef, measure: measureStrip } = stageStrip;
  useEffect(() => {
    const strip = stripRef.current;
    const current = strip?.querySelector<HTMLElement>('[aria-current="step"]');
    if (strip && current && strip.scrollWidth > strip.clientWidth) {
      strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
    }
    measureStrip();
  }, [deal.stage?.id, stripRef, measureStrip]);

  const noun = deal.kind === "job" ? "job" : "deal";
  const colors = stageColors(stages);
  const stage = stages.find((item) => item.id === deal.stage?.id) ?? null;
  const base = `/jobs/${encodeURIComponent(deal.id)}`;
  const proposalHref = deal.leadId ? `${base}/proposals/new` : null;
  const appointmentHref = `/appointments?new=${encodeURIComponent(deal.id)}`;
  const job = extras.job;
  const now = Date.now();
  const upcoming = deal.appointments
    .filter((appointment) => appointment.status === "scheduled" && Date.parse(appointment.startsAt) >= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const balanceDue = extras.invoices
    .filter((invoice) => invoice.status !== "void")
    .reduce((sum, invoice) => sum + invoice.balanceCents, 0);
  const counts: Record<DealTab, number> = {
    communications: deal.messages.length,
    notes: deal.notes.length,
    proposals: deal.proposals.length + (job ? 1 : 0),
    invoices: extras.invoices.length,
    appointments: deal.appointments.length,
    attachments: extras.documents.length,
  };

  function changeTab(next: DealTab) {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "communications") params.delete("tab");
    else params.set("tab", next);
    window.history.replaceState(null, "", `${pathname}${params.size ? `?${params}` : ""}`);
  }

  function saveSettings(patch: Partial<DealOverview["settings"]>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    setError("");
    startTransition(async () => {
      const result = await setDealSettings({ recordId: deal.id, ...next }).catch(() => ({ ok: false, error: undefined }));
      if (!result.ok) {
        setSettings(deal.settings);
        setError(result.error ?? "Could not save. Try again.");
      }
      router.refresh();
    });
  }

  const teamSelect = (label: string, value: string | null, onChange: (id: string | null) => void) => (
    <Select
      aria-label={label}
      value={value ?? ""}
      disabled={pending}
      onChange={(event) => onChange(event.target.value || null)}
      className={cn(inlineSelect, !value && "text-[var(--color-faint)]")}
    >
      <option value="">Unassigned</option>
      {deal.team.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name}
        </option>
      ))}
    </Select>
  );

  return (
    <div data-app-content="full-bleed" className="flex min-h-[calc(100dvh-3rem)] flex-col bg-[var(--color-bg)] md:min-h-dvh xl:h-dvh">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--color-border)] px-4 py-2.5 lg:flex-nowrap lg:px-5">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] lg:max-w-[45%] lg:shrink-0">
          <Link
            href={`/pipeline/${pipeline}`}
            className="flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] py-1 pl-1 pr-1.5 text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)]"
          >
            <BackIcon />
            {PIPELINE_TITLES[pipeline]}
          </Link>
          {/* Phones show the name in the details panel right below. */}
          <span aria-hidden="true" className="text-[var(--color-faint)] max-lg:hidden">
            /
          </span>
          <span className="truncate text-base font-semibold text-[var(--color-heading)] max-lg:hidden">{deal.name}</span>
        </nav>
        <ol
          ref={stageStrip.ref}
          onScroll={stageStrip.measure}
          style={stageStrip.style}
          aria-label="Stage"
          className="no-scrollbar ml-auto flex min-w-0 max-w-full items-center gap-0.5 overflow-x-auto rounded-[var(--radius-control)] bg-[var(--color-surface-2)] p-0.5"
        >
          {stages.map((item) => {
            const current = item.id === stage?.id;
            return (
              <li key={item.id} className="shrink-0">
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  disabled={!stage || current}
                  title={current ? "Current stage" : `Move to ${item.name}`}
                  onClick={() => setMoveTo(item.id)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-xs font-medium transition-colors",
                    current
                      ? "bg-[var(--color-surface)] text-[var(--color-heading)] shadow-[var(--shadow-pop-lite)]"
                      : "text-[var(--color-muted)] enabled:hover:text-[var(--color-heading)]",
                  )}
                >
                  <Dot color={colors.get(item.id)} className="h-1.5 w-1.5" />
                  {item.name}
                </button>
              </li>
            );
          })}
        </ol>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] xl:min-h-0 xl:grid-cols-[280px_minmax(0,1fr)_280px] xl:grid-rows-[minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_300px]">
        {/* Details */}
        <aside className="border-[var(--color-border)] px-5 py-5 max-lg:border-b lg:border-r xl:overflow-y-auto">
          <Initials name={deal.name} className="h-10 w-10 text-sm" />
          <h1 className="mt-3 text-lg font-semibold leading-snug text-[var(--color-heading)]">{deal.name}</h1>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            {noun === "job" ? "Job" : "Deal"} · Created {fmtRelativeTime(deal.createdAt)}
          </p>
          <div className="mt-3 flex items-center gap-1">
            {labels.length ? (
              <button type="button" onClick={() => setEditingLabels(true)} aria-label="Edit labels" className="flex min-w-0 text-left">
                <LabelTags labels={labels} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEditingLabels(true)}
                className="-ml-1 flex items-center gap-1 rounded px-1 py-0.5 text-xs text-[var(--color-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)]"
              >
                <TagIcon className="h-3 w-3" />
                Add label
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-4 gap-1">
            <QuickAction href={proposalHref} label="Proposal" title="New proposal" icon={<DocumentIcon />} />
            <QuickAction href={appointmentHref} label="Appt" title="New appointment" icon={<CalendarIcon />} />
            <QuickAction
              href={deal.contact.phone ? `tel:${deal.contact.phone}` : null}
              label="Call"
              title={deal.contact.phone ? `Call ${deal.contact.phone}` : "No phone on file"}
              icon={<PhoneIcon />}
            />
            <QuickAction
              href={deal.contact.email ? `mailto:${deal.contact.email}` : null}
              label="Email"
              title={deal.contact.email ? `Email ${deal.contact.email}` : "No email on file"}
              icon={<MailIcon />}
            />
          </div>

          <h2 className={cn(sectionTitle, "mt-6")}>About this {noun}</h2>
          <dl className="mt-1.5">
            {/* Moving happens in the stage strip at the top; this row just reads it. */}
            <Property label="Stage">
              <span className="flex min-w-0 items-center gap-1.5">
                <Dot color={stage ? colors.get(stage.id) : undefined} />
                <span className="truncate">{stage?.name ?? "Closed"}</span>
              </span>
            </Property>
            <Property label="Value">
              {deal.valueCents ? <span className="tabular-nums">{fmtCents(deal.valueCents)}</span> : <Empty />}
            </Property>
            <Property label="Lead source">{deal.source || <Empty />}</Property>
            <Property label="Salesperson">
              {teamSelect("Salesperson", settings.salespersonId, (id) => saveSettings({ salespersonId: id }))}
            </Property>
            <Property label="Project manager">
              {teamSelect("Project manager", settings.projectManagerId, (id) => saveSettings({ projectManagerId: id }))}
            </Property>
            <Property label="Email">
              {deal.contact.email ? (
                <span className="flex items-center gap-0.5">
                  <a href={`mailto:${deal.contact.email}`} className={cn("min-w-0 truncate", linkStyle)}>
                    {deal.contact.email}
                  </a>
                  <CopyButton value={deal.contact.email} label="email" />
                </span>
              ) : (
                <Empty />
              )}
            </Property>
            <Property label="Phone">
              {deal.contact.phone ? (
                <span className="flex items-center gap-0.5">
                  <a href={`tel:${deal.contact.phone}`} className={cn("min-w-0 truncate", linkStyle)}>
                    {deal.contact.phone}
                  </a>
                  <CopyButton value={deal.contact.phone} label="phone" />
                </span>
              ) : (
                <Empty />
              )}
            </Property>
            <Property label="Address">
              {deal.address ? <span className="block py-1 leading-snug">{deal.address}</span> : <Empty />}
            </Property>
            {deal.contact.id ? (
              <Property label="Customer portal">
                <PortalLinkButton contactId={deal.contact.id} />
              </Property>
            ) : null}
            <Property label="Created">{fmtDateTime(deal.createdAt)}</Property>
            <Property label="Last updated">{fmtRelativeTime(updatedAt)}</Property>
          </dl>
          {error ? (
            <p role="alert" className="mt-2 text-xs text-[var(--tag-red-text)]">
              {error}
            </p>
          ) : null}

          <DealDrips
            recordId={deal.id}
            stageId={deal.stage?.id ?? null}
            noun={noun}
            paused={settings.dripsPaused}
            onPausedChange={(dripsPaused) => setSettings((current) => ({ ...current, dripsPaused }))}
          />
        </aside>

        {/* Activity */}
        <section className="min-w-0 lg:row-span-2 xl:row-span-1 xl:flex xl:flex-col xl:overflow-y-auto">
          <nav
            ref={sectionTabs.ref}
            onScroll={sectionTabs.measure}
            style={sectionTabs.style}
            aria-label={`${noun === "job" ? "Job" : "Deal"} sections`}
            className="no-scrollbar flex h-11 shrink-0 gap-4 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 lg:px-6 xl:sticky xl:top-0 xl:z-10"
          >
            {DEAL_TABS.map(([key, label]) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => changeTab(key)}
                  className={cn(
                    "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 text-[13px] font-medium transition-colors",
                    active
                      ? "border-[var(--color-heading)] text-[var(--color-heading)]"
                      : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-heading)]",
                  )}
                >
                  {label}
                  {counts[key] ? <Tag>{counts[key]}</Tag> : null}
                </button>
              );
            })}
          </nav>
          <div
            className={cn(
              "mx-auto w-full max-w-[820px] px-4 py-5 lg:px-6",
              // The thread fills the column with the composer at the bottom.
              tab === "communications" && "xl:flex xl:min-h-0 xl:flex-1 xl:flex-col",
            )}
          >
            {tab === "communications" ? (
              <CommunicationsPanel deal={deal} />
            ) : tab === "notes" ? (
              <NotesPanel deal={deal} autoFocus={initialTab === "notes"} />
            ) : tab === "proposals" ? (
              <ProposalsPanel deal={deal} extras={extras} stageName={stage?.name ?? null} />
            ) : tab === "invoices" ? (
              <InvoicesPanel extras={extras} />
            ) : tab === "appointments" ? (
              <AppointmentsPanel deal={deal} />
            ) : (
              <AttachmentsPanel deal={deal} extras={extras} />
            )}
          </div>
        </section>

        {/* Associated records */}
        <aside className="border-[var(--color-border)] max-lg:border-t lg:border-r lg:border-t xl:overflow-y-auto xl:border-l xl:border-r-0 xl:border-t-0">
          <Association title="Proposals" count={deal.proposals.length} addHref={proposalHref} addLabel="New proposal">
            {deal.proposals.length ? (
              deal.proposals.map((proposal) => {
                const status = proposalStatus(proposal.status);
                return (
                  <AssociationRow
                    key={proposal.id}
                    href={`${base}/proposals/${proposal.id}`}
                    title={proposal.name}
                    meta={
                      <>
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <span className="text-[var(--color-heading)]">{fmtCents(proposal.amountCents)}</span>
                      </>
                    }
                  />
                );
              })
            ) : (
              <None>No proposals yet</None>
            )}
          </Association>

          <Association title="Job" count={job ? 1 : 0}>
            {job ? (
              <AssociationRow
                href={`/jobs/${encodeURIComponent(job.id)}`}
                title={job.name}
                meta={
                  <>
                    <span>{(job.id === deal.id && stage?.name) || JOB_STATUS_LABELS[job.status] || job.status}</span>
                    <span className="text-[var(--color-heading)]">{fmtCents(job.valueCents)}</span>
                  </>
                }
              />
            ) : (
              <None>No job yet</None>
            )}
          </Association>

          <Association title="Upcoming appointments" count={upcoming.length} addHref={appointmentHref} addLabel="New appointment">
            {upcoming.length ? (
              upcoming.map((appointment) => (
                <div key={appointment.id} className="flex min-h-8 items-center justify-between gap-3 py-1 text-[13px]">
                  <span className="min-w-0">
                    <span className="block truncate text-[var(--color-heading)]">{appointment.title}</span>
                    <span className="block truncate text-xs text-[var(--color-muted)]">
                      {fmtDay(appointment.startsAt)} · {fmtTime(appointment.startsAt)}
                    </span>
                  </span>
                  <Badge tone={appointmentStatus(appointment.status).tone}>{appointmentStatus(appointment.status).label}</Badge>
                </div>
              ))
            ) : (
              <None>Nothing scheduled</None>
            )}
          </Association>

          <Association
            title="Invoices"
            count={extras.invoices.length}
            addHref={job ? `/jobs/${encodeURIComponent(job.id)}/invoices/new` : null}
            addLabel="New invoice"
          >
            {extras.invoices.length ? (
              <>
                <p className="mb-1 flex justify-between text-xs text-[var(--color-muted)]">
                  Balance due
                  <span className="font-medium tabular-nums text-[var(--color-heading)]">{fmtCents(balanceDue)}</span>
                </p>
                {extras.invoices.map((invoice) => (
                  <AssociationRow
                    key={invoice.id}
                    href={`/jobs/${encodeURIComponent(invoice.jobId)}/invoices/${invoice.id}`}
                    title={`#${invoice.number} ${invoice.name}`}
                    meta={invoice.balanceCents > 0 && invoice.status !== "void" ? `${fmtCents(invoice.balanceCents)} due` : "Paid"}
                  />
                ))}
              </>
            ) : (
              <None>No invoices yet</None>
            )}
          </Association>

          <Association title="Attachments" count={extras.documents.length}>
            {extras.documents.slice(0, 4).map((document) => (
              <AssociationRow
                key={document.id}
                href={documentHref(document)}
                external={document.kind === "file"}
                title={document.name}
                meta={fmtDay(document.createdAt)}
              />
            ))}
            {!extras.documents.length ? <None>No documents yet</None> : null}
            <div className="mt-1 flex gap-4 text-xs">
              <Link href={`${base}/documents`} className={linkStyle}>
                Documents
              </Link>
              <Link href={base} className={linkStyle}>
                Photos
              </Link>
            </div>
          </Association>
        </aside>
      </div>

      {moveTo && stage ? (
        <MoveDealDialog
          card={{ id: deal.id, name: deal.name, source: deal.source, valueCents: deal.valueCents, stageId: stage.id }}
          stages={stages}
          initialStageId={moveTo}
          noun={noun}
          onClose={() => setMoveTo(null)}
          onMoved={() => {
            setMoveTo(null);
            router.refresh();
          }}
        />
      ) : null}
      {editingLabels ? (
        <ProjectLabelPicker
          projectId={deal.id}
          labels={allLabels}
          selectedIds={labels.map((label) => label.id)}
          onClose={() => setEditingLabels(false)}
        />
      ) : null}
    </div>
  );
}
