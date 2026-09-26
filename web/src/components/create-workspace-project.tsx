"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createWorkspaceProject,
  findProjectContacts,
} from "@/lib/actions/project-workspace";
import { Button, Field, Input } from "./ui";
import { CreateContactModal } from "./create-contact-form";
import { ProjectModal } from "./project-profile-panel";

export function CreateWorkspaceProject({
  initiallyOpen = false,
  onClosed,
}: { initiallyOpen?: boolean; onClosed?: () => void } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [creatingContact, setCreatingContact] = useState(false);
  const [name, setName] = useState("");
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
            setAddress("");
            setQuery("");
            setContactId("");
            setOpen(true);
          }}
        >
          + Create Project
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
        <ProjectModal title="Create Project" onClose={close}>
          <form
            className="space-y-5 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              startTransition(async () => {
                try {
                  const result = await createWorkspaceProject({
                    id: requestId.current,
                    name,
                    address,
                    contactId,
                  });
                  if (result.error) setError(result.error);
                  else {
                    setOpen(false);
                    onClosed?.();
                    router.push(`/jobs/${result.id}`);
                    router.refresh();
                  }
                } catch {
                  setError("Could not confirm project creation. Retry safely.");
                }
              });
            }}
          >
            <Field label="Project name">
              <Input
                autoFocus
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Address">
              <Input
                maxLength={500}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </Field>
            <Field label="Contact">
              <Input
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
              className="max-h-48 overflow-y-auto rounded-md border border-slate-200"
              aria-busy={searching}
            >
              {contacts.map((contact) => (
                <label
                  key={contact.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50"
                >
                  <input
                    required
                    type="radio"
                    name="contact"
                    checked={contactId === contact.id}
                    onChange={() => setContactId(contact.id)}
                  />
                  <span>
                    <span className="block font-medium">{contact.name}</span>
                    {contact.email ? (
                      <span className="text-xs text-slate-500">
                        {contact.email}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
              {!contacts.length ? (
                <p className="p-3 text-sm text-slate-500">
                  {searching ? "Searching…" : "No customers found."}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => setCreatingContact(true)}
              className="inline-block text-sm font-semibold text-blue-600"
            >
              ＋ Create a customer
            </button>
            {error ? (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="subtle"
                disabled={pending}
                onClick={close}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !contactId}>
                {pending ? "Creating…" : "Create Project"}
              </Button>
            </div>
          </form>
        </ProjectModal>
      ) : null}
    </>
  );
}
