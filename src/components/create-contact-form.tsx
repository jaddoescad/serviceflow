"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { createContact } from "@/lib/actions/contacts";

export function CreateContactModal({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef<string | null>(null);
  const [open, setOpen] = useState(initiallyOpen);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function close() {
    if (pending) return;
    dialog.current?.close();
    setOpen(false);
    if (initiallyOpen) router.replace("/contacts", { scroll: false });
  }

  return <>
    <Button onClick={() => { requestId.current = null; setError(null); setOpen(true); }} className="shrink-0">+ Create contact</Button>
    {open ? <dialog ref={dialog} aria-labelledby="create-contact-title" aria-describedby="create-contact-description"
      onCancel={event => { event.preventDefault(); close(); }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[520px] overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-text)] shadow-2xl backdrop:bg-slate-950/45">
      <button type="button" aria-label="Close create contact" disabled={pending} onClick={close} className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg text-2xl text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:opacity-40">×</button>
      <header className="px-6 pb-6 pt-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-7 w-7"><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M19 7v6m-3-3h6"/></svg>
        </div>
        <h2 id="create-contact-title" className="font-display text-2xl font-semibold tracking-tight text-[var(--color-heading)]">Create contact</h2>
        <p id="create-contact-description" className="mt-2 text-sm text-[var(--color-muted)]">Add a customer to your contacts.</p>
      </header>
      <form onSubmit={event => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(event.currentTarget);
        requestId.current ??= crypto.randomUUID();
        const input = { id: requestId.current, name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), phone: String(data.get("phone") ?? ""), address: String(data.get("address") ?? "") };
        setError(null);
        startTransition(async () => {
          try {
            const result = await createContact(input);
            if (result.error || !result.id) { setError(result.error ?? "Could not create contact."); return; }
            dialog.current?.close();
            setOpen(false);
            if (initiallyOpen) router.replace("/contacts", { scroll: false });
            router.refresh();
          } catch { setError("Could not save the contact. Please try again."); }
        });
      }}>
        <fieldset disabled={pending} className="space-y-5 px-6 pb-6">
          <Field label="Name *"><Input name="name" required maxLength={160} autoComplete="name" autoFocus /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Email (optional)"><Input name="email" type="email" maxLength={320} autoComplete="email" /></Field>
            <Field label="Phone (optional)"><Input name="phone" type="tel" maxLength={60} autoComplete="tel" /></Field>
          </div>
          <Field label="Address (optional)"><Input name="address" maxLength={500} autoComplete="street-address" /></Field>
        </fieldset>
        {error ? <p role="alert" className="px-6 pb-4 text-sm text-[var(--color-bad)]">{error}</p> : null}
        <footer className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] px-6 py-5">
          <Button type="button" variant="ghost" onClick={close} disabled={pending}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create contact"}</Button>
        </footer>
      </form>
    </dialog> : null}
  </>;
}
