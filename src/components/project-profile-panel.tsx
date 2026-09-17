"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input } from "@/components/ui";
import {
  updateProjectContact,
  updateProjectDescription,
} from "@/lib/actions/project-profile";
import type { ProjectContact } from "@/lib/project-data";

type OpenPanel = "contact" | "description" | null;

function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    (
      dialog?.querySelector<HTMLElement>("input,textarea") ??
      dialog?.querySelector<HTMLElement>("button") ??
      dialog
    )?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const nodes = dialog?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]",
      );
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
      window.removeEventListener("keydown", keydown);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        className={`max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl ${wide ? "max-w-3xl" : "max-w-xl"}`}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
          <div>
            <h2
              id="project-dialog-title"
              className="font-display text-xl font-semibold text-[var(--color-heading)]"
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-heading)]"
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export { Modal as ProjectModal };

function PanelHeader({ title, action }: { title: string; action: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
      <h2 className="font-display text-base font-semibold text-[var(--color-heading)]">
        {title}
      </h2>
      {action}
    </div>
  );
}

function EditButton({
  onClick,
  label = "Edit",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}>
      <span aria-hidden="true">✎</span>
      {label}
    </Button>
  );
}

function ActionError({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="rounded-lg bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[var(--color-bad)]"
    >
      {message}
    </p>
  ) : null;
}

function ContactEditor({
  projectId,
  contact,
  onClose,
}: {
  projectId: string;
  contact: ProjectContact;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(contact.name ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [address, setAddress] = useState(contact.address ?? "");
  const [customerNotes, setCustomerNotes] = useState(
    contact.customerNotes ?? "",
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateProjectContact({
          projectId,
          name,
          email,
          phone,
          address,
          customerNotes,
        });
        if (!result.ok) {
          setError(result.error ?? "Contact could not be saved.");
          return;
        }
        router.refresh();
        onClose();
      } catch {
        setError(
          "Could not save contact. Your changes are still here. Try again.",
        );
      }
    });
  }

  return (
    <Modal
      title="Edit contact"
      onClose={() => {
        if (!pending) onClose();
      }}
      wide
    >
      <form onSubmit={submit} className="space-y-5 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name">
            <Input
              value={name}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Phone">
            <Input
              value={phone}
              disabled={pending}
              onChange={(event) => setPhone(event.target.value)}
              type="tel"
              autoComplete="tel"
            />
          </Field>
          <Field label="Email">
            <Input
              value={email}
              disabled={pending}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
            />
          </Field>
          <Field label="Project / customer address">
            <Input
              value={address}
              disabled={pending}
              onChange={(event) => setAddress(event.target.value)}
              autoComplete="street-address"
            />
          </Field>
        </div>
        <Field label="Customer notes">
          <textarea
            value={customerNotes}
            disabled={pending}
            onChange={(event) => setCustomerNotes(event.target.value)}
            rows={5}
            placeholder="Add access details, preferences, or anything the team should know…"
            className="w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5 text-sm leading-6 text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-brand)]"
          />
        </Field>
        <ActionError message={error} />
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-5">
          <Button
            type="button"
            variant="subtle"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save contact"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TextEditor({
  title,
  subtitle,
  label,
  placeholder,
  initialValue,
  onClose,
  onSave,
}: {
  title: string;
  subtitle?: string;
  label: string;
  placeholder: string;
  initialValue: string | null;
  onClose: () => void;
  onSave: (value: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(initialValue ?? "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await onSave(value);
        if (!result.ok) {
          setError(result.error ?? "Changes could not be saved.");
          return;
        }
        router.refresh();
        onClose();
      } catch {
        setError("Could not save changes. Your text is still here. Try again.");
      }
    });
  }

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={() => {
        if (!pending) onClose();
      }}
      wide
    >
      <form onSubmit={submit} className="space-y-5 p-6">
        <Field label={label}>
          <textarea
            value={value}
            disabled={pending}
            onChange={(event) => setValue(event.target.value)}
            rows={12}
            autoFocus
            placeholder={placeholder}
            className="w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm leading-6 text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-brand)]"
          />
        </Field>
        <ActionError message={error} />
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-5">
          <Button
            type="button"
            variant="subtle"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectProfilePanel({
  projectId,
  contact,
  description,
  canEdit = true,
}: {
  projectId: string;
  contact: ProjectContact;
  description: string | null;
  canEdit?: boolean;
}) {
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);

  return (
    <>
      <aside className="space-y-4 self-start rounded-md bg-slate-50 p-4 xl:sticky xl:top-6">
        <Card className="overflow-hidden rounded-md! shadow-none!">
          <PanelHeader
            title="Contact Info"
            action={
              canEdit ? (
                <EditButton onClick={() => setOpenPanel("contact")} />
              ) : null
            }
          />
          <div className="space-y-2 px-5 py-5 text-sm leading-6">
            <div className="font-semibold text-[var(--color-heading)]">
              {contact.name ?? "No contact name"}
            </div>
            {contact.email ? (
              <a
                href={`mailto:${contact.email}`}
                className="block break-all text-[var(--color-brand-strong)] hover:underline"
              >
                {contact.email}
              </a>
            ) : (
              <div className="text-[var(--color-muted)]">No email</div>
            )}
            {contact.phone ? (
              <a
                href={`tel:${contact.phone}`}
                className="block text-[var(--color-brand-strong)] hover:underline"
              >
                {contact.phone}
              </a>
            ) : (
              <div className="text-[var(--color-muted)]">No phone</div>
            )}
            <div
              className={
                contact.address
                  ? "text-[var(--color-text)]"
                  : "text-[var(--color-muted)]"
              }
            >
              {contact.address ?? "No address"}
            </div>
            {contact.customerNotes ? (
              <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Customer notes
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[var(--color-text)]">
                  {contact.customerNotes}
                </p>
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="overflow-hidden rounded-md! shadow-none!">
          <PanelHeader
            title="Description"
            action={
              canEdit ? (
                <EditButton onClick={() => setOpenPanel("description")} />
              ) : null
            }
          />
          <div className="whitespace-pre-wrap px-5 py-5 text-sm leading-6 text-[var(--color-text)]">
            {description || (
              <span className="text-[var(--color-muted)]">
                No project description yet.
              </span>
            )}
          </div>
        </Card>
      </aside>

      {openPanel === "contact" ? (
        <ContactEditor
          projectId={projectId}
          contact={contact}
          onClose={() => setOpenPanel(null)}
        />
      ) : null}
      {openPanel === "description" ? (
        <TextEditor
          title="Edit project description"

          label="Description"
          placeholder="Add scope, measurements, colour details, and project instructions…"
          initialValue={description}
          onClose={() => setOpenPanel(null)}
          onSave={(value) =>
            updateProjectDescription({ projectId, description: value })
          }
        />
      ) : null}
    </>
  );
}
