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
import { AddressInput } from "@/components/address-input";
import { Button, Field, Input, Textarea } from "@/components/ui";
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
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
        className={`max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-[var(--radius-lg)] bg-[var(--color-surface)] text-[13px] shadow-[var(--shadow-pop)] outline-none ${wide ? "max-w-3xl" : "max-w-xl"}`}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
          <div className="min-w-0">
            <h2
              id="project-dialog-title"
              className="text-[15px] font-semibold text-[var(--color-heading)]"
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-muted)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export { Modal as ProjectModal };

/** Dialog footer: hairline above, actions on the right (secondary Cancel,
 * then the primary action). Put it last inside the Modal or its form. */
export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
      {children}
    </div>
  );
}

function PanelHeader({ title, action }: { title: string; action: ReactNode }) {
  return (
    <div className="flex h-10 items-center justify-between gap-3">
      <h2 className="text-[13px] font-semibold text-[var(--color-heading)]">
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
      {label}
    </Button>
  );
}

function ActionError({ message }: { message: string | null }) {
  return message ? (
    <p
      role="alert"
      className="rounded-[var(--radius-control)] bg-[var(--color-bad-soft)] px-3 py-2 text-[13px] text-[var(--color-bad)]"
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
      <form onSubmit={submit}>
        <div className="space-y-4 p-5">
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
              <AddressInput value={address} disabled={pending} onChange={setAddress} />
            </Field>
          </div>
          <Field label="Customer notes">
            <Textarea
              value={customerNotes}
              disabled={pending}
              onChange={(event) => setCustomerNotes(event.target.value)}
              rows={5}
              placeholder="Add access details, preferences, or anything the team should know…"
              className="resize-y"
            />
          </Field>
          <ActionError message={error} />
        </div>
        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save contact"}
          </Button>
        </ModalFooter>
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
      <form onSubmit={submit}>
        <div className="space-y-4 p-5">
          <Field label={label}>
            <Textarea
              value={value}
              disabled={pending}
              onChange={(event) => setValue(event.target.value)}
              rows={12}
              autoFocus
              placeholder={placeholder}
              className="resize-y"
            />
          </Field>
          <ActionError message={error} />
        </div>
        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </ModalFooter>
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
      <aside className="self-start xl:sticky xl:top-6">
        <section className="border-b border-[var(--color-border)] pb-3">
          <PanelHeader
            title="Contact"
            action={
              canEdit ? (
                <EditButton onClick={() => setOpenPanel("contact")} />
              ) : null
            }
          />
          <div className="space-y-1 text-[13px] leading-5">
            <div className="font-medium text-[var(--color-heading)]">
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
              <div className="text-[var(--color-faint)]">No email</div>
            )}
            {contact.phone ? (
              <a
                href={`tel:${contact.phone}`}
                className="block text-[var(--color-brand-strong)] hover:underline"
              >
                {contact.phone}
              </a>
            ) : (
              <div className="text-[var(--color-faint)]">No phone</div>
            )}
            <div
              className={
                contact.address
                  ? "text-[var(--color-text)]"
                  : "text-[var(--color-faint)]"
              }
            >
              {contact.address ?? "No address"}
            </div>
            {contact.customerNotes ? (
              <div className="pt-2">
                <div className="text-xs text-[var(--color-muted)]">Customer notes</div>
                <p className="line-clamp-3 whitespace-pre-wrap text-[var(--color-text)]">
                  {contact.customerNotes}
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="pb-3">
          <PanelHeader
            title="Description"
            action={
              canEdit ? (
                <EditButton onClick={() => setOpenPanel("description")} />
              ) : null
            }
          />
          <div className="whitespace-pre-wrap text-[13px] leading-5 text-[var(--color-text)]">
            {description || (
              <span className="text-[var(--color-faint)]">
                No project description yet.
              </span>
            )}
          </div>
        </section>
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
