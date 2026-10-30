"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendDocument } from "@/lib/actions/documents";
import type { DocumentKind } from "@/lib/proposal-types";
import { ProjectModal } from "./project-profile-panel";
import { Button, Field, Input, Segmented, Textarea, buttonClassName } from "./ui";

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

type SendChannel = "email" | "sms" | "link";

const SEND_CHANNELS: { value: SendChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "sms", label: "Text" },
  { value: "link", label: "Copy link" },
];

/**
 * Sends a document in one step: emails or texts its private link, or marks it
 * sent and copies the link. Nothing changes if the message can't go out.
 */
export function SendDocumentDialog({
  kind,
  id,
  title,
  noun,
  description,
  path,
  token,
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
  dirty: boolean;
  save: () => Promise<boolean>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<SendChannel>("email");
  const [subject, setSubject] = useState(`Your ${noun} from {{company}}`);
  const [body, setBody] = useState(`Hi {{first_name}}, here's your ${noun} from {{company}}:\n{{document_link}}`);
  const [sent, setSent] = useState<{ link: string; note: string; copied: boolean } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const existingLink = token ? `${window.location.origin}${path}/${token}` : "";

  function send() {
    startTransition(async () => {
      setError("");
      if (dirty && !(await save())) {
        setError("Couldn't save your changes. Fix them and try again.");
        return;
      }
      const result = await sendDocument({ kind, id, channel, subject, body });
      if (!result.token) {
        setError(result.error ?? "Could not send.");
        return;
      }
      const link = `${window.location.origin}${path}/${result.token}`;
      const copied = channel === "link" && (await copyText(link));
      const note =
        channel === "email"
          ? "Email queued."
          : channel === "sms"
            ? "Text queued."
            : copied
              ? "Link copied. Share it with your customer."
              : "Share this link with your customer.";
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

  const linkOnly = channel === "link";
  return (
    <ProjectModal title={title} onClose={() => !pending && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="space-y-3 p-5 text-[13px]">
          <Segmented
            label="Send by"
            value={channel}
            options={SEND_CHANNELS}
            onChange={(value) => {
              setError("");
              setChannel(value);
            }}
          />
          {linkOnly ? (
            existingLink ? (
              <CopyLink link={existingLink} />
            ) : (
              <p className="text-[var(--color-muted)]">{description}</p>
            )
          ) : (
            <>
              {channel === "email" ? (
                <Field label="Subject">
                  <Input required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} />
                </Field>
              ) : null}
              <Field label="Message">
                <Textarea required rows={5} maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} />
              </Field>
            </>
          )}
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
              <Button type="submit" disabled={pending || (!linkOnly && !body.trim())}>
                {pending
                  ? "Sending…"
                  : channel === "email"
                    ? "Send email"
                    : channel === "sms"
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
