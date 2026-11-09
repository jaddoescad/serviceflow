"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteProposal,
  deleteProposalTemplate,
  saveProposal,
  saveProposalTemplate,
} from "@/lib/actions/proposals";
import type { DocumentExtras } from "@/lib/documents";
import { proposalHref } from "@/lib/pipeline-types";
import {
  chosenPackageId,
  depositCents,
  documentTotals,
  fmtCents,
  isAddOn,
  lineTotalCents,
  newLineItem,
  packageCents,
  syncPackageItems,
  type LineItem,
  type ProposalPackage,
} from "@/lib/line-items";
import {
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_STATUS_TONES,
  type CompanyDocument,
  type Proposal,
  type ProposalBody,
} from "@/lib/proposal-types";
import type { DealOverview } from "@/lib/crm-types";
import { NotesPanel } from "./deal-tabs";
import { ItemDescription, ItemDescriptionEditor } from "./item-description";
import { DocumentAttachments } from "./document-attachments";
import { ConfirmDialog, SendDocumentDialog } from "./document-dialogs";
import { DuplicateProposalDialog } from "./duplicate-proposal";
import { ActivityPanel, DeliveryNote, DocumentTotals, NumberInput, TotalRow, useDraft } from "./line-items-editor";
import { BackIcon, ChevronIcon, Initials, MailIcon, PhoneIcon } from "./pipeline-ui";
import { Badge, Button, Card, Select, buttonClassName, cn } from "./ui";
import Link from "next/link";

type DepositKind = "none" | "percent" | "amount";

const MAX_PACKAGES = 6;
const PACKAGE_NAMES = ["Good", "Better", "Best"];

function DepositField({
  body,
  onChange,
  readOnly,
}: {
  body: ProposalBody;
  onChange: (patch: Partial<ProposalBody>) => void;
  readOnly: boolean;
}) {
  const kind: DepositKind =
    body.depositCents != null ? "amount" : body.depositPercent != null ? "percent" : "none";
  if (readOnly && kind === "none") return null;
  const total = documentTotals(body.items, body.taxRatePercent, {
    percent: body.discountPercent,
    cents: body.discountCents,
  }).totalCents;
  const due = depositCents(total, { percent: body.depositPercent, cents: body.depositCents });
  return (
    <div className="mt-1 border-t border-[var(--color-border)] pt-1">
      {readOnly ? null : (
        <div className="flex min-h-9 items-center justify-between gap-2 text-[13px]">
          <dt className="text-[var(--color-muted)]">Deposit</dt>
          <dd className="flex items-center gap-1.5">
            {kind === "none" ? null : (
              <span className={kind === "percent" ? "w-16" : "w-24"}>
                {kind === "percent" ? (
                  <NumberInput
                    aria-label="Deposit percent"
                    min={0}
                    max={100}
                    value={body.depositPercent ?? 0}
                    onChange={(depositPercent) => onChange({ depositPercent })}
                  />
                ) : (
                  <NumberInput
                    aria-label="Deposit amount"
                    scale={100}
                    decimals={2}
                    min={0}
                    value={body.depositCents ?? 0}
                    onChange={(cents) => onChange({ depositCents: cents })}
                  />
                )}
              </span>
            )}
            <Select
              aria-label="Deposit type"
              value={kind}
              onChange={(event) => {
                const next = event.target.value as DepositKind;
                onChange(
                  next === "none"
                    ? { depositPercent: null, depositCents: null }
                    : next === "percent"
                      ? { depositPercent: body.depositPercent ?? 25, depositCents: null }
                      : { depositPercent: null, depositCents: body.depositCents ?? due },
                );
              }}
            >
              <option value="none">None</option>
              <option value="percent">%</option>
              <option value="amount">$</option>
            </Select>
          </dd>
        </div>
      )}
      {kind === "none" ? null : (
        <TotalRow
          label={`Deposit due${kind === "percent" ? ` (${body.depositPercent}%)` : ""}`}
          cents={due}
          variant="strong"
        />
      )}
    </div>
  );
}

const PACKAGE_FIELD =
  "h-8 w-full min-w-0 rounded-[var(--radius-control)] border border-transparent bg-transparent px-2 text-[13px] outline-none placeholder:text-[var(--color-faint)] hover:border-[var(--color-border-strong)] focus:border-[var(--color-brand)] focus:bg-[var(--color-surface)] focus:shadow-[var(--focus-ring)] disabled:hover:border-transparent";

/** Good / Better / Best: lines assigned to a package count only when the customer picks it. */
function PackagesPanel({
  body,
  readOnly,
  onChange,
}: {
  body: ProposalBody;
  readOnly: boolean;
  onChange: (packages: ProposalPackage[], selectedPackageId: string | null) => void;
}) {
  const name = useId();
  function update(id: string, patch: Partial<ProposalPackage>) {
    onChange(
      body.packages.map((pack) => (pack.id === id ? { ...pack, ...patch } : pack)),
      body.selectedPackageId,
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-[var(--color-border)] px-4">
        <h2 className="text-[13px] font-semibold text-[var(--color-heading)]">Packages</h2>
        <span className="text-xs text-[var(--color-muted)]">The customer picks one</span>
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {body.packages.map((pack) => {
          const count = body.items.filter((item) => item.packageId === pack.id).length;
          return (
            <li key={pack.id} className="group flex items-start gap-2 px-3 py-2">
              <label className="flex h-8 shrink-0 items-center px-1" title="Shown first to the customer">
                <input
                  type="radio"
                  name={name}
                  aria-label={`Show ${pack.name || "this package"} first`}
                  disabled={readOnly}
                  checked={body.selectedPackageId === pack.id}
                  onChange={() => onChange(body.packages, pack.id)}
                />
              </label>
              <div className="min-w-0 flex-1">
                <input
                  aria-label="Package name"
                  placeholder="Package name"
                  maxLength={80}
                  disabled={readOnly}
                  value={pack.name}
                  onChange={(event) => update(pack.id, { name: event.target.value })}
                  className={cn(PACKAGE_FIELD, "font-medium text-[var(--color-heading)]")}
                />
                <input
                  aria-label="Package description"
                  placeholder="Add a short description"
                  maxLength={1000}
                  disabled={readOnly}
                  value={pack.description}
                  onChange={(event) => update(pack.id, { description: event.target.value })}
                  className={cn(PACKAGE_FIELD, "h-7 text-xs text-[var(--color-muted)]")}
                />
              </div>
              <div className="flex h-8 shrink-0 items-center gap-3 text-xs tabular-nums text-[var(--color-muted)]">
                <span>{count === 1 ? "1 line" : `${count} lines`}</span>
                <span className="w-24 text-right text-[13px] font-medium text-[var(--color-heading)]">
                  {fmtCents(packageCents(body.items, pack.id))}
                </span>
              </div>
              {readOnly ? null : (
                <button
                  type="button"
                  aria-label={`Remove ${pack.name || "package"}`}
                  title="Remove package (its lines stay as regular lines)"
                  onClick={() => {
                    const packages = body.packages.filter((other) => other.id !== pack.id);
                    onChange(packages, chosenPackageId(packages, body.selectedPackageId));
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-base text-[var(--color-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-bad)] focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {readOnly || body.packages.length >= MAX_PACKAGES ? null : (
        <div className="border-t border-[var(--color-border)] px-3 py-2">
          <Button type="button" variant="ghost" onClick={() => onChange(...withNewPackage(body))}>
            + Add package
          </Button>
        </div>
      )}
    </Card>
  );
}

function withNewPackage(body: ProposalBody): [ProposalPackage[], string | null] {
  const packages = [
    ...body.packages,
    {
      id: crypto.randomUUID(),
      name: PACKAGE_NAMES[body.packages.length] ?? `Package ${body.packages.length + 1}`,
      description: "",
    },
  ];
  return [packages, chosenPackageId(packages, body.selectedPackageId)];
}

/** A small "More" menu in the editor header. */
function HeaderMenu({ items }: { items: { label: string; danger?: boolean; onSelect: () => void }[] }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  if (!items.length) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        aria-label="More actions"
        popoverTarget={id}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setPosition({ top: bounds.bottom + 4, left: Math.max(8, bounds.right - 176) });
        }}
      >
        ···
      </Button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        style={position}
        className="fixed m-0 w-44 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-[13px] shadow-[var(--shadow-pop)]"
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              menu.current?.hidePopover();
              item.onSelect();
            }}
            className={cn(
              "flex h-8 w-full items-center rounded-[var(--radius-control)] px-2.5 text-left hover:bg-[var(--color-hover)]",
              item.danger ? "text-[var(--color-bad)]" : "text-[var(--color-text)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

/** Text you type straight into the sheet: plain until hovered or focused. */
const CELL =
  "w-full min-w-0 rounded-[var(--radius-control)] border border-transparent bg-transparent px-2 outline-none placeholder:text-[var(--color-faint)] hover:border-[var(--color-border-strong)] focus:border-[var(--color-brand)] focus:bg-[var(--color-surface)] focus:shadow-[var(--focus-ring)]";
const COLUMNS = "sm:grid-cols-[minmax(0,1fr)_4.5rem_7rem_7rem_1.75rem]";
const SECTION_TITLE = "text-[15px] font-semibold text-[var(--color-heading)]";
const ADD_LINK =
  "mt-2 inline-flex h-8 items-center gap-1 rounded-[var(--radius-control)] px-2 text-[13px] font-medium outline-none hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)]";

/** The lines of one group (the work itself, or the optional extras). */
function Lines({
  items,
  packages,
  readOnly,
  onUpdate,
  onRemove,
}: {
  items: LineItem[];
  packages: ProposalPackage[];
  readOnly: boolean;
  onUpdate: (id: string, patch: Partial<LineItem>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <ul>
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "group grid grid-cols-[1fr_1fr_1fr_1.75rem] items-start gap-x-2 gap-y-1 border-b border-[var(--color-border)] py-3 last:border-0",
            COLUMNS,
          )}
        >
          <div className="col-span-full min-w-0 sm:col-span-1">
            {readOnly ? (
              <>
                <div className="px-2 text-[15px] font-semibold leading-8 text-[var(--color-heading)]">{item.name}</div>
                {isAddOn(item) ? (
                  <p className="mt-1 px-2 text-xs text-[var(--color-muted)]">{item.selected ? "Chosen" : "Not chosen"}</p>
                ) : null}
              </>
            ) : (
              <>
                <input
                  aria-label="Item name"
                  placeholder="Item name"
                  maxLength={200}
                  value={item.name}
                  onChange={(event) => onUpdate(item.id, { name: event.target.value })}
                  className={cn(CELL, "h-8 text-[15px] font-semibold text-[var(--color-heading)]")}
                />
                {packages.length && !isAddOn(item) ? (
                  <select
                    aria-label="Package"
                    value={item.packageId ?? ""}
                    onChange={(event) =>
                      onUpdate(
                        item.id,
                        event.target.value
                          ? { packageId: event.target.value, optional: true }
                          : { packageId: null, optional: false, selected: true },
                      )
                    }
                    className="mt-1 h-6 rounded-[var(--radius-control)] border border-transparent bg-transparent px-1.5 text-xs text-[var(--color-muted)] outline-none hover:border-[var(--color-border-strong)] focus:border-[var(--color-brand)]"
                  >
                    <option value="">Every package</option>
                    {packages.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {pack.name || "Untitled package"}
                      </option>
                    ))}
                  </select>
                ) : null}
              </>
            )}
          </div>
          {readOnly ? (
            <>
              <div className="px-2 text-right text-sm leading-8 tabular-nums">{item.quantity}</div>
              <div className="px-2 text-right text-sm leading-8 tabular-nums">{fmtCents(item.unitPriceCents)}</div>
            </>
          ) : (
            <>
              <NumberInput
                look="cell"
                aria-label="Quantity"
                value={item.quantity}
                onChange={(quantity) => onUpdate(item.id, { quantity })}
              />
              <NumberInput
                look="cell"
                aria-label="Price"
                scale={100}
                decimals={2}
                value={item.unitPriceCents}
                onChange={(unitPriceCents) => onUpdate(item.id, { unitPriceCents })}
              />
            </>
          )}
          <div className="px-2 text-right text-sm font-semibold leading-8 tabular-nums text-[var(--color-heading)]">
            {fmtCents(lineTotalCents(item))}
          </div>
          {readOnly ? (
            <span />
          ) : (
            <button
              type="button"
              aria-label={`Remove ${item.name || "item"}`}
              title="Remove"
              onClick={() => onRemove(item.id)}
              className="flex h-8 w-7 items-center justify-center rounded-[var(--radius-control)] text-base text-[var(--color-faint)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-bad)] focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            >
              ×
            </button>
          )}
          {/* The description runs the full width of the row, under the name and amounts. */}
          {readOnly ? (
            item.description ? <ItemDescription text={item.description} className="col-span-full px-2" /> : null
          ) : (
            <div className="col-span-full min-w-0">
              <ItemDescriptionEditor value={item.description} onChange={(description) => onUpdate(item.id, { description })} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function depositSummary(body: ProposalBody): string {
  if (body.depositPercent != null) return `${body.depositPercent}% deposit`;
  if (body.depositCents != null) return `${fmtCents(body.depositCents)} deposit`;
  return "No deposit";
}

export function ProposalEditor({
  mode,
  id,
  leadId,
  projectId,
  projectName,
  isNew,
  initial,
  proposal,
  deal = null,
  extras = null,
  companyDocuments = [],
  initialTemplateId = null,
  backHref,
  backLabel,
}: {
  mode: "proposal" | "template";
  id: string;
  /** Required for proposals. */
  leadId?: string;
  /** Required for proposals: the deal (or job) the proposal belongs to. */
  projectId?: string;
  /** The project's name, offered as "This deal" when duplicating. */
  projectName?: string;
  isNew: boolean;
  initial: ProposalBody;
  proposal?: Proposal | null;
  /** Proposals: the deal, for the customer header and its notes. */
  deal?: DealOverview | null;
  /** A saved proposal's attachments and latest delivery. */
  extras?: DocumentExtras | null;
  companyDocuments?: CompanyDocument[];
  initialTemplateId?: string | null;
  backHref: string;
  backLabel: string;
}) {
  const router = useRouter();
  const { body, patch, dirty, markSaved } = useDraft(initial, isNew);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"send" | "delete" | "duplicate" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [pending, startTransition] = useTransition();
  const isProposal = mode === "proposal";
  const status = proposal?.status;
  // Once the customer has accepted, changes go through a change order.
  const readOnly = isProposal && !!proposal && (proposal.status === "accepted" || proposal.status === "superseded");
  const canSend = isProposal && !!proposal && !readOnly && !isNew;
  const canDelete = !readOnly && !isNew && (!isProposal || proposal?.status === "draft");
  const canDuplicate = isProposal && !!proposal && !isNew;
  const busy = saving || pending;

  /** Line edits keep package lines selected only in the package shown first. */
  function setItems(items: LineItem[]) {
    patch({ items: syncPackageItems(items, body.packages, body.selectedPackageId) });
  }
  const updateItem = (itemId: string, next: Partial<LineItem>) =>
    setItems(body.items.map((item) => (item.id === itemId ? { ...item, ...next } : item)));
  const removeItem = (itemId: string) => setItems(body.items.filter((item) => item.id !== itemId));

  function setPackages(packages: ProposalPackage[], selectedPackageId: string | null) {
    patch({ packages, selectedPackageId, items: syncPackageItems(body.items, packages, selectedPackageId) });
  }

  async function save(): Promise<boolean> {
    setError("");
    const saved = body;
    const result = isProposal
      ? await saveProposal({ id, leadId: leadId!, body: saved, templateId: initialTemplateId })
      : await saveProposalTemplate({ id, body: saved });
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return false;
    }
    markSaved(saved);
    if (isNew) {
      router.replace(isProposal ? proposalHref(projectId!, id) : `/proposals/templates/${id}`);
    }
    router.refresh();
    return true;
  }

  function remove() {
    startTransition(async () => {
      const result = isProposal ? await deleteProposal(id) : await deleteProposalTemplate(id);
      if (!result.ok) {
        setError(result.error ?? "Could not delete.");
        return;
      }
      router.push(backHref);
      router.refresh();
    });
  }

  const work = body.items.filter((item) => !isAddOn(item));
  const optional = body.items.filter(isAddOn);
  const shownPackage = body.packages.find((pack) => pack.id === body.selectedPackageId);
  const total = documentTotals(body.items, body.taxRatePercent, {
    percent: body.discountPercent,
    cents: body.discountCents,
  }).totalCents;
  const due = depositCents(total, { percent: body.depositPercent, cents: body.depositCents });
  const notice = readOnly
    ? "The customer accepted this proposal, so it can no longer be changed. Add a change order for anything new."
    : null;
  const contact = deal?.contact;

  return (
    <div className="mx-auto max-w-[920px] pb-16">
      <header className="page-bar flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--color-border)] py-2.5">
        <Link
          href={backHref}
          className="flex min-w-0 items-center gap-1 rounded-[var(--radius-control)] py-1 pr-1.5 text-[13px] text-[var(--color-muted)] hover:text-[var(--color-heading)]"
        >
          <BackIcon />
          <span className="truncate">{backLabel}</span>
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {status ? <Badge tone={PROPOSAL_STATUS_TONES[status]}>{PROPOSAL_STATUS_LABELS[status]}</Badge> : null}
          {extras?.delivery ? <DeliveryNote delivery={extras.delivery} /> : null}
          {proposal ? (
            <a
              href={`/preview/proposals/${proposal.id}`}
              target="_blank"
              rel="noreferrer"
              className={buttonClassName({ variant: "ghost" })}
            >
              Customer view <span aria-hidden="true">↗</span>
            </a>
          ) : null}
          {readOnly ? null : (
            <Button
              type="button"
              variant={canSend || !dirty ? "subtle" : "primary"}
              disabled={busy || !dirty}
              onClick={() => startSave(async () => void (await save()))}
            >
              {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
          )}
          {canSend ? (
            <Button type="button" disabled={busy} onClick={() => setDialog("send")}>
              {proposal?.status === "sent" ? "Send again" : "Send"}
            </Button>
          ) : null}
          <HeaderMenu
            items={[
              ...(canDuplicate ? [{ label: "Duplicate", onSelect: () => setDialog("duplicate") }] : []),
              ...(canDelete ? [{ label: "Delete", danger: true, onSelect: () => setDialog("delete") }] : []),
            ]}
          />
        </div>
      </header>

      {error ? (
        <p role="alert" className="mt-4 rounded-[var(--radius)] bg-[var(--color-bad-soft)] px-3 py-2 text-[13px] text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}

      {isProposal && deal ? (
        <section aria-label="Customer" className="mt-6">
          <div className="flex items-center gap-4">
            <Initials name={deal.name} className="h-14 w-14 text-lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={backHref} className="truncate text-[22px] font-bold leading-tight text-[var(--color-heading)] hover:underline">
                  {deal.name}
                </Link>
                {contact?.phone ? (
                  <a
                    href={`tel:${contact.phone}`}
                    aria-label={`Call ${contact.phone}`}
                    title={`Call ${contact.phone}`}
                    className={buttonClassName({ variant: "secondary", className: "w-8 rounded-full px-0" })}
                  >
                    <PhoneIcon />
                  </a>
                ) : null}
                {contact?.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    aria-label={`Email ${contact.email}`}
                    title={`Email ${contact.email}`}
                    className={buttonClassName({ variant: "secondary", className: "w-8 rounded-full px-0" })}
                  >
                    <MailIcon />
                  </a>
                ) : null}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[var(--color-muted)]">
                {deal.address ? <span>{deal.address}</span> : null}
                {contact?.phone ? <span>{contact.phone}</span> : null}
                {contact?.email ? <span className="[overflow-wrap:anywhere]">{contact.email}</span> : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {notice ? (
        <p className="mt-4 rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-muted)]">{notice}</p>
      ) : null}

      <div className="mt-5 space-y-4">
        <Card className="px-4 py-5 sm:px-7 sm:py-7">
          <input
            aria-label={isProposal ? "Proposal name" : "Template name"}
            placeholder={isProposal ? "Proposal name" : "Template name"}
            maxLength={120}
            disabled={readOnly}
            value={body.name}
            onChange={(event) => patch({ name: event.target.value })}
            className={cn(CELL, "-ml-2 h-10 text-[24px] font-bold tracking-tight text-[var(--color-heading)] disabled:hover:border-transparent")}
          />

          <div
            className={cn(
              "mt-5 hidden gap-x-2 border-b border-[var(--color-border)] pb-2 text-xs font-medium text-[var(--color-faint)] sm:grid",
              COLUMNS,
            )}
          >
            <span className="px-2">Item</span>
            <span className="px-2 text-right">Qty</span>
            <span className="px-2 text-right">Price</span>
            <span className="px-2 text-right">Total</span>
          </div>
          <Lines items={work} packages={body.packages} readOnly={readOnly} onUpdate={updateItem} onRemove={removeItem} />
          {readOnly ? null : (
            <button
              type="button"
              onClick={() => setItems([...body.items, newLineItem()])}
              className={cn(ADD_LINK, "text-[var(--color-brand-strong)]")}
            >
              + Add item
            </button>
          )}

          {optional.length || !readOnly ? (
            <div className="mt-6 rounded-[var(--radius-lg)] bg-[var(--color-warn-soft)] px-3 pb-2 pt-4 sm:px-4">
              <div className="flex flex-wrap items-baseline gap-x-2 px-2">
                <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-warn)]">Optional</h3>
                <span className="text-[13px] text-[var(--color-muted)]">The customer can add these. Not in the total.</span>
              </div>
              <Lines items={optional} packages={[]} readOnly={readOnly} onUpdate={updateItem} onRemove={removeItem} />
              {readOnly ? null : (
                <button
                  type="button"
                  onClick={() => setItems([...body.items, newLineItem({ optional: true, selected: false })])}
                  className={cn(ADD_LINK, "mt-1 text-[var(--color-warn)]")}
                >
                  + Add optional item
                </button>
              )}
            </div>
          ) : null}

          <div className="ml-auto mt-6 w-full max-w-xs">
            <DocumentTotals
              items={body.items}
              taxRatePercent={body.taxRatePercent}
              onTaxRateChange={(taxRatePercent) => patch({ taxRatePercent })}
              readOnly={readOnly}
              discount={{
                value: { percent: body.discountPercent, cents: body.discountCents },
                onChange: (discount) => patch({ discountPercent: discount.percent, discountCents: discount.cents }),
              }}
            >
              {shownPackage ? (
                <div className="flex min-h-8 items-center text-xs text-[var(--color-faint)]">
                  <dt>Totals show the {shownPackage.name || "first"} package</dt>
                </div>
              ) : null}
              {due ? (
                <TotalRow
                  label={`Deposit${body.depositPercent != null ? ` (${body.depositPercent}%)` : ""}`}
                  cents={due}
                />
              ) : null}
            </DocumentTotals>
          </div>
        </Card>

        {body.packages.length ? <PackagesPanel body={body} readOnly={readOnly} onChange={setPackages} /> : null}

        {isProposal && deal ? (
          <Card className="px-4 py-5 sm:px-7">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className={SECTION_TITLE}>Notes</h2>
              <span className="text-xs text-[var(--color-muted)]">From the deal. The customer never sees these.</span>
            </div>
            <NotesPanel deal={deal} autoFocus={false} />
          </Card>
        ) : null}

        {proposal && extras ? (
          <DocumentAttachments
            kind="proposal"
            documentId={proposal.id}
            orgId={extras.orgId}
            projectId={projectId!}
            assets={extras.assets}
            readOnly={readOnly}
            companyDocuments={{ include: proposal.includeCompanyDocuments, documents: companyDocuments }}
          />
        ) : null}

        {proposal && proposal.status !== "draft" ? <ActivityPanel record={proposal} /> : null}

        {readOnly ? null : (
          <Card className="px-4 sm:px-7">
            <button
              type="button"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="flex w-full items-center gap-3 py-4 text-left outline-none"
            >
              <h2 className={SECTION_TITLE}>Settings</h2>
              <span className="flex-1 text-[13px] text-[var(--color-muted)]">{depositSummary(body)}</span>
              <ChevronIcon className={cn("h-4 w-4 shrink-0 text-[var(--color-muted)] transition-transform", settingsOpen ? "-rotate-90" : "rotate-90")} />
            </button>
            {settingsOpen ? (
              <dl className="pb-3">
                <DepositField body={body} onChange={patch} readOnly={readOnly} />
              </dl>
            ) : null}
          </Card>
        )}
      </div>

      {dialog === "send" && proposal ? (
        <SendDocumentDialog
          kind="proposal"
          id={proposal.id}
          title="Send proposal"
          noun="proposal"
          description="Marks the proposal sent, moves the deal to Proposal(s) Sent and copies the link where your customer accepts, signs or declines."
          path="/p"
          token={proposal.status === "sent" ? proposal.publicToken : null}
          dirty={dirty}
          save={save}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "duplicate" && proposal ? (
        <DuplicateProposalDialog
          proposalId={proposal.id}
          projectId={projectId!}
          projectName={projectName ?? backLabel}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "delete" ? (
        <ConfirmDialog
          title={isProposal ? "Delete proposal" : "Delete template"}
          message={`Delete “${body.name || "Untitled"}”? This can’t be undone.`}
          confirmLabel="Delete"
          pending={pending}
          error={error}
          onConfirm={remove}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
