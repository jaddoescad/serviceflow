"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLead } from "@/lib/actions/pipeline";
import {
  createWorkspaceProject,
  findProjectContacts,
} from "@/lib/actions/project-workspace";
import { AddressInput } from "./address-input";
import { Button, Field, Input } from "./ui";
import { CreateContactModal } from "./create-contact-form";
import { ModalFooter, ProjectModal } from "./project-profile-panel";

/** Creates a job-side project, or with kind="lead" a deal in the sales pipeline. */
export function CreateWorkspaceProject({
  initiallyOpen = false,
  onClosed,
  kind = "project",
}: { initiallyOpen?: boolean; onClosed?: () => void; kind?: "project" | "lead" } = {}) {
  const router = useRouter();
  const isLead = kind === "lead";
  const [open, setOpen] = useState(initiallyOpen);
  const [creatingContact, setCreatingContact] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [address, setAddress] = useState("");
  const [query, setQuery] = useState("");
  const [contactId, setContactId] = useState("");
  const [contacts, setContacts] = useState<
    { id: string; name: string; email: string | null }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const requestId = useRef("");
  function close() {
    if (pending) return;
    setOpen(false);
    onClosed?.();
  }
  useEffect(() => {
    if (!open) return;
    if (!requestId.current) requestId.current = crypto.randomUUID();
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void findProjectContacts(query)
        .then((rows) => {
          if (!cancelled) setContacts(rows);
        })
        .catch(() => {
          if (!cancelled)
            setError("Could not find contacts. Try searching again.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);
  return (
    <>
      {!onClosed && (
        <Button
          onClick={() => {
            requestId.current = crypto.randomUUID();
            setError("");
            setName("");
            setSource("");
            setAddress("");
            setQuery("");
            setContactId("");
            setOpen(true);
          }}
        >
          {isLead ? "+ New Lead" : "+ Create Project"}
        </Button>
      )}
      {creatingContact ? (
        <CreateContactModal
          initiallyOpen
          onClosed={() => setCreatingContact(false)}
          onCreated={(contact) => {
            setContacts((current) => [
              contact,
              ...current.filter((item) => item.id !== contact.id),
            ]);
            setContactId(contact.id);
            setQuery(contact.name);
            if (!address) setAddress(contact.address);
            setCreatingContact(false);
          }}
        />
      ) : null}
      {open && !creatingContact ? (
        <ProjectModal title={isLead ? "New Lead" : "Create Project"} onClose={close}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              startTransition(async () => {
                try {
                  const result = isLead
                    ? await createLead({ id: requestId.current, contactId, address, source })
                    : await createWorkspaceProject({
                        id: requestId.current,
                        name,
                        address,
                        contactId,
                      });
                  if (result.error) setError(result.error);
                  else {
                    setOpen(false);
                    onClosed?.();
                    if (!isLead) router.push(`/jobs/${result.id}`);
                    router.refresh();
                  }
                } catch {
                  setError(`Could not confirm ${isLead ? "the lead" : "project creation"}. Retry safely.`);
                }
              });
            }}
          >
            <div className="space-y-4 p-5">
              {isLead ? null : (
                <Field label="Project name">
                  <Input
                    autoFocus
                    required
                    maxLength={200}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
              )}
              <Field label="Address">
                <AddressInput maxLength={500} value={address} onChange={setAddress} />
              </Field>
              {isLead ? (
                <Field label="Lead source">
                  <Input
                    maxLength={120}
                    placeholder="Phone Call, Organic Search…"
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                  />
                </Field>
              ) : null}
              <Field label="Contact">
                <Input
                  autoFocus={isLead}
                  type="search"
                  placeholder="Find a customer…"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setContactId("");
                  }}
                />
              </Field>
              <div
                className="max-h-48 overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)]"
                aria-busy={searching}
              >
                {contacts.map((contact) => (
                  <label
                    key={contact.id}
                    className="flex cursor-pointer items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 text-[13px] last:border-0 hover:bg-[var(--color-row-hover)] has-[:checked]:bg-[var(--color-brand-soft)]"
                  >
                    <input
                      required
                      type="radio"
                      name="contact"
                      checked={contactId === contact.id}
                      onChange={() => setContactId(contact.id)}
                    />
                    <span>
                      <span className="block font-medium text-[var(--color-heading)]">{contact.name}</span>
                      {contact.email ? (
                        <span className="text-xs text-[var(--color-muted)]">
                          {contact.email}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
                {!contacts.length ? (
                  <p className="p-3 text-[13px] text-[var(--color-muted)]">
                    {searching ? "Searching…" : "No customers found."}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setCreatingContact(true)}
                className="-ml-2 text-[var(--color-brand-strong)]"
              >
                + Create a customer
              </Button>
              {error ? (
                <p role="alert" className="text-[13px] text-[var(--color-bad)]">
                  {error}
                </p>
              ) : null}
            </div>
            <ModalFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={close}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !contactId}>
                {pending ? "Creating…" : isLead ? "Add Lead" : "Create Project"}
              </Button>
            </ModalFooter>
          </form>
        </ProjectModal>
      ) : null}
    </>
  );
}
