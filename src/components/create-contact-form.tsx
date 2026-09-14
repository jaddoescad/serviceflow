"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input } from "@/components/ui";
import { createContact } from "@/lib/actions/contacts";

export function CreateContactForm() {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <Card className="max-w-xl p-5">
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
          router.push(`/contacts/${result.id}`);
          router.refresh();
        } catch { setError("Could not save the contact. Please try again."); }
      });
    }}>
      <fieldset disabled={pending} className="space-y-4">
        <Field label="Name"><Input name="name" required maxLength={160} autoComplete="name" autoFocus placeholder="Contact name" /></Field>
        <Field label="Email (optional)"><Input name="email" type="email" maxLength={320} autoComplete="email" placeholder="name@example.com" /></Field>
        <Field label="Phone (optional)"><Input name="phone" type="tel" maxLength={60} autoComplete="tel" /></Field>
        <Field label="Address (optional)"><Input name="address" maxLength={500} autoComplete="street-address" /></Field>
      </fieldset>
      {error ? <p role="alert" className="mt-4 text-sm text-[var(--color-bad)]">{error}</p> : null}
      <div className="mt-6 flex items-center justify-end gap-4">
        {pending ? null : <Link href="/contacts" className="text-sm text-[var(--color-muted)]">Cancel</Link>}
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create contact"}</Button>
      </div>
    </form>
  </Card>;
}
