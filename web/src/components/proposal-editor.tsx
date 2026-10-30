"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteProposal,
  deleteProposalTemplate,
  saveProposal,
  saveProposalTemplate,
  setDealCustomerLanguage,
} from "@/lib/actions/proposals";
import type { DocumentExtras } from "@/lib/documents";
import { fmtDate } from "@/lib/format";
import {
  chosenPackageId,
  depositCents,
  documentTotals,
  fmtCents,
  packageCents,
  syncPackageItems,
  type CatalogItem,
  type LineItem,
  type ProposalPackage,
} from "@/lib/line-items";
import {
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_STATUS_TONES,
  proposalDisplayStatus,
  type CompanyDocument,
  type Proposal,
  type ProposalBody,
  type ProposalTemplate,
} from "@/lib/proposal-types";
import { DocumentAttachments } from "./document-attachments";
import { ConfirmDialog, SendDocumentDialog } from "./document-dialogs";
import { DuplicateProposalDialog } from "./duplicate-proposal";
import {
  ActivityPanel,
  DocumentTotals,
  EditorColumns,
  EditorHeader,
  LineItemsEditor,
  NumberInput,
  ADD_SELECT,
  PROPERTY_CONTROL,
  PropertyRow,
  RailPanel,
  TotalRow,
  useDraft,
} from "./line-items-editor";
import { Button, Card, Field, Select, Textarea, cn } from "./ui";

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

/** When the customer can no longer approve, and the language their pages open in. */
function DetailsPanel({
  body,
  readOnly,
  leadId,
  customerLanguage,
  onChange,
}: {
  body: ProposalBody;
  readOnly: boolean;
  leadId: string;
  customerLanguage: "en" | "fr" | null;
  onChange: (patch: Partial<ProposalBody>) => void;
}) {
  const router = useRouter();
  const [language, setLanguage] = useState(customerLanguage);
  const [error, setError] = useState("");
  const [saving, startSaving] = useTransition();
  return (
    <RailPanel title="Details">
      <dl>
        <PropertyRow label="Valid until">
          <input
            type="date"
            aria-label="Valid until"
            disabled={readOnly}
            value={body.validUntil ?? ""}
            onChange={(event) => onChange({ validUntil: event.target.value || null })}
            className={cn(PROPERTY_CONTROL, !body.validUntil && "text-[var(--color-faint)]")}
          />
        </PropertyRow>
        <PropertyRow label="Customer language">
          <select
            aria-label="Customer language"
            disabled={saving}
            value={language ?? ""}
            onChange={(event) => {
              const next = (event.target.value || null) as "en" | "fr" | null;
              const previous = language;
              setLanguage(next);
              setError("");
              startSaving(async () => {
                const result = await setDealCustomerLanguage(leadId, next);
                if (!result.ok) {
                  setLanguage(previous);
                  setError(result.error ?? "Could not change the language.");
                  return;
                }
                router.refresh();
              });
            }}
            className={PROPERTY_CONTROL}
          >
            <option value="">Automatic</option>
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </PropertyRow>
      </dl>
      {error ? (
        <p role="alert" className="pb-1 text-xs text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}
    </RailPanel>
  );
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
  templates = [],
  catalog = [],
  extras = null,
  companyDocuments = [],
  calculatorLines = null,
  initialTemplateId = null,
  customerLanguage = null,
  backHref,
  backLabel,
}: {
  mode: "proposal" | "template";
  id: string;
  /** Required for proposals. */
  leadId?: string;
  /** Required for proposals: the project page the editor lives under. */
  projectId?: string;
  /** The project's name, offered as "This deal" when duplicating. */
  projectName?: string;
  isNew: boolean;
  initial: ProposalBody;
  proposal?: Proposal | null;
  templates?: ProposalTemplate[];
  catalog?: CatalogItem[];
  /** A saved proposal's attachments and latest delivery. */
  extras?: DocumentExtras | null;
  companyDocuments?: CompanyDocument[];
  calculatorLines?: { items: LineItem[]; taxRatePercent: number } | null;
  initialTemplateId?: string | null;
  /** The deal's customer's document language, when set. */
  customerLanguage?: "en" | "fr" | null;
  backHref: string;
  backLabel: string;
}) {
  const router = useRouter();
  const { body, setBody, patch, dirty, markSaved } = useDraft(initial, isNew);
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"send" | "delete" | "duplicate" | null>(null);
  const [saving, startSave] = useTransition();
  const [pending, startTransition] = useTransition();
  const isProposal = mode === "proposal";
  const status = proposal ? proposalDisplayStatus(proposal.status, proposal.validUntil) : undefined;
  const readOnly =
    isProposal &&
    !!proposal &&
    (proposal.status === "accepted" || proposal.status === "superseded" || proposal.source !== "proposal");
  const canSend = isProposal && !!proposal && !readOnly && !isNew;
  const canDelete = !readOnly && !isNew && (!isProposal || proposal?.status === "draft");
  const canDuplicate = isProposal && !!proposal && !isNew && proposal.source === "proposal";

  /** Line edits keep package lines selected only in the package shown first. */
  function setItems(items: LineItem[]) {
    patch({ items: syncPackageItems(items, body.packages, body.selectedPackageId) });
  }

  function setPackages(packages: ProposalPackage[], selectedPackageId: string | null) {
    patch({ packages, selectedPackageId, items: syncPackageItems(body.items, packages, selectedPackageId) });
  }

  async function save(): Promise<boolean> {
    setError("");
    const saved = body;
    const result = isProposal
      ? await saveProposal({ id, leadId: leadId!, body: saved, templateId })
      : await saveProposalTemplate({ id, body: saved });
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return false;
    }
    markSaved(saved);
    if (isNew) {
      router.replace(isProposal ? `/jobs/${encodeURIComponent(projectId!)}/proposals/${id}` : `/proposals/templates/${id}`);
    }
    router.refresh();
    return true;
  }

  /** An empty proposal takes the whole template; otherwise its lines and packages are added. */
  function applyTemplate(template: ProposalTemplate) {
    const items = template.items.map((item) => ({ ...item, id: crypto.randomUUID() }));
    if (body.items.length) {
      const known = new Set(body.packages.map((pack) => pack.id));
      const packages = [...body.packages, ...template.packages.filter((pack) => !known.has(pack.id))].slice(
        0,
        MAX_PACKAGES,
      );
      const selectedPackageId = chosenPackageId(packages, body.selectedPackageId ?? template.selectedPackageId);
      patch({ packages, selectedPackageId, items: syncPackageItems([...body.items, ...items], packages, selectedPackageId) });
      return;
    }
    setTemplateId(template.id);
    setBody({
      name: body.name || template.name,
      items,
      taxRatePercent: template.taxRatePercent,
      depositPercent: template.depositPercent,
      depositCents: template.depositCents,
      discountPercent: template.discountPercent,
      discountCents: template.discountCents,
      packages: template.packages,
      selectedPackageId: template.selectedPackageId,
      intro: template.intro,
      terms: template.terms,
      validUntil: body.validUntil,
    });
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

  const shownPackage = body.packages.find((pack) => pack.id === body.selectedPackageId);
  const notice =
    proposal && proposal.source !== "proposal"
      ? `Imported from ${proposal.source.startsWith("dripjobs") ? "DripJobs" : "the calculator"}. Open it there to make changes.`
      : status === "expired"
        ? `Expired ${fmtDate(proposal!.validUntil)}. The customer can no longer approve it; choose a later valid-until date and save to reopen it.`
        : null;

  return (
    <div>
      <EditorHeader
        backHref={backHref}
        backLabel={backLabel}
        name={body.name}
        placeholder={isProposal ? "Proposal name" : "Template name"}
        onNameChange={(name) => patch({ name })}
        readOnly={readOnly}
        status={status ? { label: PROPOSAL_STATUS_LABELS[status], tone: PROPOSAL_STATUS_TONES[status] } : null}
        delivery={extras?.delivery}
        customerHref={proposal?.publicToken && proposal.status !== "draft" ? `/p/${proposal.publicToken}` : null}
        actions={
          isProposal ? (
            <HeaderMenu
              items={[
                ...(canDuplicate ? [{ label: "Duplicate", onSelect: () => setDialog("duplicate") }] : []),
                ...(canDelete ? [{ label: "Delete", danger: true, onSelect: () => setDialog("delete") }] : []),
              ]}
            />
          ) : canDelete ? (
            <Button type="button" variant="ghost" disabled={saving || pending} onClick={() => setDialog("delete")}>
              Delete
            </Button>
          ) : null
        }
        primaryAction={
          canSend ? (
            <Button type="button" disabled={saving || pending} onClick={() => setDialog("send")}>
              {proposal?.status === "sent" ? "Resend" : "Send"}
            </Button>
          ) : null
        }
        save={{
          dirty,
          saving,
          disabled: saving || pending,
          onSave: () => startSave(async () => void (await save())),
        }}
        error={error}
        notice={notice}
      />

      <EditorColumns
        main={
          <>
            <LineItemsEditor
              items={body.items}
              onChange={setItems}
              readOnly={readOnly}
              catalog={catalog}
              packages={body.packages}
              footer={
                <>
                  {isProposal && templates.length ? (
                    <Select
                      aria-label="Add from a template"
                      className={ADD_SELECT}
                      value=""
                      onChange={(event) => {
                        const template = templates.find((item) => item.id === event.target.value);
                        if (template) applyTemplate(template);
                      }}
                    >
                      <option value="">Add from template…</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  {body.packages.length ? null : (
                    <Button type="button" variant="ghost" onClick={() => setPackages(...withNewPackage(body))}>
                      + Add package
                    </Button>
                  )}
                  {calculatorLines?.items.length ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        patch({
                          items: [
                            ...body.items,
                            ...calculatorLines.items.map((item) => ({ ...item, id: crypto.randomUUID() })),
                          ],
                          taxRatePercent: calculatorLines.taxRatePercent,
                        })
                      }
                    >
                      Import from calculator
                    </Button>
                  ) : null}
                </>
              }
            />
            {body.packages.length ? <PackagesPanel body={body} readOnly={readOnly} onChange={setPackages} /> : null}
          </>
        }
        rail={
          <>
            <RailPanel>
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
                <DepositField body={body} onChange={patch} readOnly={readOnly} />
              </DocumentTotals>
            </RailPanel>
            {isProposal && leadId ? (
              <DetailsPanel
                body={body}
                readOnly={readOnly}
                leadId={leadId}
                customerLanguage={customerLanguage}
                onChange={patch}
              />
            ) : null}
            {proposal && proposal.status !== "draft" ? <ActivityPanel record={proposal} /> : null}
          </>
        }
        below={
          <>
            <Card className="space-y-4 p-4">
              <Field label="Message to customer">
                <Textarea
                  rows={3}
                  maxLength={10000}
                  disabled={readOnly}
                  value={body.intro}
                  onChange={(event) => patch({ intro: event.target.value })}
                />
              </Field>
              <Field label="Terms">
                <Textarea
                  rows={5}
                  maxLength={20000}
                  disabled={readOnly}
                  value={body.terms}
                  onChange={(event) => patch({ terms: event.target.value })}
                />
              </Field>
            </Card>
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
          </>
        }
      />

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
