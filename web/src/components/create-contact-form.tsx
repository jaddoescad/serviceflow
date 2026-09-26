"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { createContact, updateCustomer } from "@/lib/actions/contacts";

export type CreatedContact = {
  id: string;
  name: string;
  email: string | null;
  address: string;
};

export function CreateContactModal({
  initiallyOpen = false,
  onCreated,
  onClosed,
  customer,
  hideTrigger = false,
}: {
  initiallyOpen?: boolean;
  onCreated?: (contact: CreatedContact) => void;
  onClosed?: () => void;
  customer?: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  hideTrigger?: boolean;
}) {
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
    element?.querySelector<HTMLInputElement>("input")?.focus();
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
    if (onClosed) onClosed();
    else if (initiallyOpen && !customer)
      router.replace("/contacts", { scroll: false });
  }

  return (
    <>
      {!onCreated && !hideTrigger ? (
        <Button
          onClick={() => {
            requestId.current = null;
            setError(null);
            setOpen(true);
          }}
          className="shrink-0"
        >
          {customer ? "Edit Customer" : "＋ Customer"}
        </Button>
      ) : null}
      {open ? (
        <dialog
          ref={dialog}
          aria-labelledby="create-contact-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[600px] overflow-hidden rounded-xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/60"
        >
          <form
            className="flex max-h-[calc(100dvh-2rem)] flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              if (pending) return;
              const data = new FormData(event.currentTarget);
              requestId.current ??= crypto.randomUUID();
              const input = {
                id: customer?.id ?? requestId.current,
                name: String(data.get("name") ?? ""),
                email: String(data.get("email") ?? ""),
                phone: String(data.get("phone") ?? ""),
                address: String(data.get("address") ?? ""),
              };
              setError(null);
              startTransition(async () => {
                try {
                  const result = await (customer
                    ? updateCustomer(input)
                    : createContact(input));
                  if (result.error || !result.id) {
                    setError(result.error ?? "Could not save customer.");
                    return;
                  }
                  dialog.current?.close();
                  setOpen(false);
                  if (onCreated)
                    onCreated({
                      id: result.id,
                      name: input.name.trim(),
                      email: input.email.trim() || null,
                      address: input.address.trim(),
                    });
                  else {
                    if (customer) onClosed?.();
                    if (initiallyOpen && !customer)
                      router.replace("/contacts", { scroll: false });
                    router.refresh();
                  }
                } catch {
                  setError(
                    "Could not save the customer. Your entries are still here; try again.",
                  );
                }
              });
            }}
          >
            <header className="flex shrink-0 items-center justify-between px-8 pb-5 pt-7">
              <h2 id="create-contact-title" className="text-xl font-bold">
                {customer ? "Edit Customer" : "Customer"}
              </h2>
              <button
                type="button"
                aria-label="Close customer form"
                disabled={pending}
                onClick={close}
                className="flex h-8 w-8 items-center justify-center text-2xl text-slate-500 disabled:opacity-40"
              >
                ×
              </button>
            </header>
            <div className="min-h-0 overflow-y-auto px-8 pb-8">
              <fieldset disabled={pending}>
                <legend className="mb-4 text-sm font-semibold">
                  Contact Details
                </legend>
                <div className="space-y-5 rounded border border-slate-200 p-4">
                  <Field label="Name *">
                    <Input
                      name="name"
                      defaultValue={customer?.name ?? ""}
                      required
                      maxLength={160}
                      autoComplete="name"
                      autoFocus
                    />
                  </Field>
                  <Field label="Phone">
                    <Input
                      name="phone"
                      defaultValue={customer?.phone ?? ""}
                      type="tel"
                      maxLength={60}
                      autoComplete="tel"
                      placeholder="(555) 555-5555"
                    />
                  </Field>
                  <Field label="Email">
                    <Input
                      name="email"
                      defaultValue={customer?.email ?? ""}
                      type="email"
                      maxLength={320}
                      autoComplete="email"
                      placeholder="email@address.com"
                    />
                  </Field>
                </div>
                <div className="mt-7">
                  <Field label="Address">
                    <Input
                      name="address"
                      defaultValue={customer?.address ?? ""}
                      maxLength={500}
                      autoComplete="street-address"
                    />
                  </Field>
                </div>
              </fieldset>
              {error ? (
                <p role="alert" className="mt-4 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
            </div>
            <footer className="flex shrink-0 justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <Button
                type="button"
                variant="subtle"
                onClick={close}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending
                  ? "Saving…"
                  : customer
                    ? "Save Customer"
                    : "Save New Customer"}
              </Button>
            </footer>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
