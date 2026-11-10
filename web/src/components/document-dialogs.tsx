"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendDocument } from "@/lib/actions/documents";
import type { DocumentKind } from "@/lib/proposal-types";
import { ProjectModal } from "./project-profile-panel";
import { MailIcon, PhoneIcon } from "./pipeline-ui";
import { Button, Field, Input, Select, Textarea, buttonClassName } from "./ui";

// Dialog layout: 13px body with p-5, then a hairline footer with
// right-aligned buttons (secondary first, the main action last).

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
      {children}
    </div>
  );
}

function DialogError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-[13px] text-[var(--color-bad)]">
      {message}
    </p>
  ) : null;
}

function copyText(text: string): Promise<boolean> {
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

/** A read-only link with Copy and Open. */
export function CopyLink({ link, copied: initiallyCopied = false }: { link: string; copied?: boolean }) {
  const [copied, setCopied] = useState(initiallyCopied);
  return (
    <div className="flex items-center gap-2">
      <Input aria-label="Link" readOnly value={link} onFocus={(event) => event.target.select()} />
      <Button type="button" variant="subtle" className="shrink-0" onClick={() => void copyText(link).then(setCopied)}>
        {copied ? "Copied" : "Copy"}
      </Button>
      <a href={link} target="_blank" rel="noreferrer" className={buttonClassName({ variant: "ghost", className: "shrink-0" })}>
        Open ↗
      </a>
    </div>
  );
}

type Delivery = "both" | "email" | "sms" | "link";

const DELIVERY_LABELS: Record<Delivery, string> = {
  both: "Email and text",
  email: "Email only",
  sms: "Text only",
  link: "Don't send — mark sent and copy the link",
};

const NEXT_STEP: Record<DocumentKind, string> = {
  proposal: "review it and accept it online",
  change_order: "review and sign it online",
  invoice: "see what's owing",
};

export type SendRecipient = { name: string | null; email: string | null; phone: string | null };

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "{{first_name}}";
}

/** Default messages, written out with what's known so they read as sent. */
function defaultMessages(
  kind: DocumentKind,
  noun: string,
  link: string,
  customer: SendRecipient | null,
  company: { name: string; phone: string | null } | null,
) {
  const hi = `Hi ${firstName(customer?.name)}`;
  const from = company?.name || "{{company}}";
  const call = company?.phone ? ` or call us at ${company.phone}` : "";
  return {
    subject: `Your ${noun} from ${from}`,
    email:
      `${hi},\n\n` +
      `Thank you for considering ${from}. Your ${noun} is ready — you can ${NEXT_STEP[kind]} here:\n\n` +
      `${link}\n\n` +
      `If you have any questions, just reply to this email${call}.\n\n` +
      `Thanks,\n${from}`,
    sms: `${hi}, it's ${from}. Here's your ${noun}: ${link}`,
  };
}

function MessageSection({
  icon,
  title,
  to,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  to: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--color-heading)]">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--color-surface-2)] text-[var(--color-muted)]">
          {icon}
        </span>
        {title}
      </h3>
      {to ? (
        <Field label="To">
          <Input readOnly value={to} className="bg-[var(--color-surface-2)] text-[var(--color-muted)]" />
        </Field>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Sends a document by email, text or both, or only marks it sent and copies
 * its private link. Nothing changes if the first message can't go out.
 */
export function SendDocumentDialog({
  kind,
  id,
  title,
  noun,
  description,
  path,
  token,
  customer = null,
  company = null,
  dirty,
  save,
  onClose,
}: {
  kind: DocumentKind;
  id: string;
  title: string;
  noun: string;
  /** What marking it sent does, shown when only copying the link. */
  description: string;
  /** Public route prefix, e.g. "/p". */
  path: string;
  /** Already sent: copying the link needs no resend. */
  token: string | null;
  /** Who it goes to, when known: shown as "To" and used to pick the default. */
  customer?: SendRecipient | null;
  company?: { name: string; phone: string | null } | null;
  dirty: boolean;
  save: () => Promise<boolean>;
  onClose: () => void;
}) {
  const router = useRouter();
  const existingLink = token ? `${window.location.origin}${path}/${token}` : "";
  // Unknown customer (no details passed): let the server check what's on file.
  const hasEmail = customer ? Boolean(customer.email?.trim()) : true;
  const hasPhone = customer ? Boolean(customer.phone?.trim()) : true;
  const [delivery, setDelivery] = useState<Delivery>(
    hasEmail && hasPhone ? "both" : hasEmail ? "email" : hasPhone ? "sms" : "link",
  );
  const [defaults] = useState(() => defaultMessages(kind, noun, existingLink || "{{document_link}}", customer, company));
  const [subject, setSubject] = useState(defaults.subject);
  const [emailBody, setEmailBody] = useState(defaults.email);
  const [smsBody, setSmsBody] = useState(defaults.sms);
  const [sent, setSent] = useState<{ link: string; note: string; copied: boolean } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const withEmail = delivery === "both" || delivery === "email";
  const withSms = delivery === "both" || delivery === "sms";
  const linkOnly = delivery === "link";

  function send() {
    startTransition(async () => {
      setError("");
      if (dirty && !(await save())) {
        setError("Couldn't save your changes. Fix them and try again.");
        return;
      }
      const result = await sendDocument({
        kind,
        id,
        email: withEmail ? { subject, body: emailBody } : undefined,
        sms: withSms ? { body: smsBody } : undefined,
      });
      if (!result.token) {
        setError(result.error ?? "Could not send.");
        return;
      }
      const link = `${window.location.origin}${path}/${result.token}`;
      const copied = linkOnly && (await copyText(link));
      const queued =
        result.sent.length === 2 ? "Email and text queued." : result.sent[0] === "email" ? "Email queued." : "Text queued.";
      const note = result.error
        ? `${queued} The ${result.sent.includes("email") ? "text" : "email"} wasn't sent: ${result.error}`
        : linkOnly
          ? copied
            ? "Link copied. Share it with your customer."
            : "Share this link with your customer."
          : queued;
      setSent({ link, copied, note });
      router.refresh();
    });
  }

  if (sent) {
    return (
      <ProjectModal title={title} onClose={onClose}>
        <div className="space-y-2 p-5 text-[13px]">
          <p className="text-[var(--color-muted)]">{sent.note}</p>
          <CopyLink link={sent.link} copied={sent.copied} />
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </ProjectModal>
    );
  }

  const missing = (value: boolean, what: string) => (value ? "" : ` (no ${what} on file)`);
  return (
    <ProjectModal title={title} wide onClose={() => !pending && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="space-y-4 p-5 text-[13px]">
          <Field label="Send by">
            <Select
              className="w-full"
              value={delivery}
              onChange={(event) => {
                setError("");
                setDelivery(event.target.value as Delivery);
              }}
            >
              <option value="both" disabled={!hasEmail || !hasPhone}>
                {DELIVERY_LABELS.both}
                {missing(hasEmail && hasPhone, !hasEmail && !hasPhone ? "email or phone number" : hasEmail ? "phone number" : "email")}
              </option>
              <option value="email" disabled={!hasEmail}>
                {DELIVERY_LABELS.email}
                {missing(hasEmail, "email")}
              </option>
              <option value="sms" disabled={!hasPhone}>
                {DELIVERY_LABELS.sms}
                {missing(hasPhone, "phone number")}
              </option>
              <option value="link">{DELIVERY_LABELS.link}</option>
            </Select>
          </Field>

          {withSms ? (
            <MessageSection icon={<PhoneIcon className="h-3.5 w-3.5" />} title="Text message" to={customer?.phone?.trim() || null}>
              <Field label="Message">
                <Textarea
                  required
                  rows={3}
                  maxLength={1600}
                  value={smsBody}
                  onChange={(event) => setSmsBody(event.target.value)}
                  className="resize-y"
                />
              </Field>
            </MessageSection>
          ) : null}

          {withEmail ? (
            <MessageSection
              icon={<MailIcon className="h-3.5 w-3.5" />}
              title="Email"
              to={customer?.email?.trim() ? `${customer.name?.trim() ? `${customer.name.trim()} ` : ""}<${customer.email.trim()}>` : null}
            >
              <Field label="Subject">
                <Input required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} />
              </Field>
              <Field label="Message">
                <Textarea
                  required
                  rows={12}
                  maxLength={5000}
                  value={emailBody}
                  onChange={(event) => setEmailBody(event.target.value)}
                  className="resize-y"
                />
              </Field>
            </MessageSection>
          ) : null}

          {linkOnly ? (
            existingLink ? (
              <CopyLink link={existingLink} />
            ) : (
              <p className="text-[var(--color-muted)]">{description}</p>
            )
          ) : null}
          <DialogError message={error} />
        </div>
        <DialogFooter>
          {linkOnly && existingLink ? (
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="subtle" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || (withEmail && !emailBody.trim()) || (withSms && !smsBody.trim())}
              >
                {pending
                  ? "Sending…"
                  : delivery === "both"
                    ? "Send email & text"
                    : delivery === "email"
                      ? "Send email"
                      : delivery === "sms"
                        ? "Send text"
                        : "Mark sent & copy link"}
              </Button>
            </>
          )}
        </DialogFooter>
      </form>
    </ProjectModal>
  );
}

/** Confirmation for deleting, voiding or cancelling a document. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  pending,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  pending: boolean;
  error: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ProjectModal title={title} onClose={() => !pending && onClose()}>
      <div className="space-y-3 p-5 text-[13px]">
        <p className="text-[var(--color-text)]">{message}</p>
        <DialogError message={error} />
      </div>
      <DialogFooter>
        <Button type="button" variant="subtle" disabled={pending} onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button type="button" variant="danger" disabled={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </ProjectModal>
  );
}
