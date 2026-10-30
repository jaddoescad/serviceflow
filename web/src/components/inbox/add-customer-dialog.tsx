"use client";

import { useRef, useState, useTransition } from "react";
import { createContact } from "@/lib/actions/contacts";
import { linkConversationContact } from "@/lib/actions/inbox";
import { createLead } from "@/lib/actions/pipeline";
import { fmtHandle } from "@/lib/inbox-format";
import { Switch } from "../pipeline-ui";
import { ModalFooter, ProjectModal } from "../project-profile-panel";
import { AddressInput } from "../address-input";
import { Button, Field, Input } from "../ui";

/** Turns a number (or address) that isn't a customer yet into one. Their
 * conversation moves onto the new customer, with a new deal in the first
 * sales column unless that's switched off. */
export function AddCustomerDialog({
  conversationId,
  handle,
  suggestedName,
  onClose,
  onAdded,
}: {
  conversationId: string;
  handle: string | null;
  /** Quo's name for the number, if it has one. */
  suggestedName: string | null;
  onClose: () => void;
  onAdded: (conversationId: string) => void;
}) {
  const isEmail = Boolean(handle?.includes("@"));
  const [name, setName] = useState(suggestedName ?? "");
  const [email, setEmail] = useState(isEmail ? handle ?? "" : "");
  const [address, setAddress] = useState("");
  const [withDeal, setWithDeal] = useState(true);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // Kept across retries so a second press doesn't make a second customer or deal.
  const ids = useRef({ contact: crypto.randomUUID(), deal: crypto.randomUUID() });

  function save() {
    setError("");
    startTransition(async () => {
      const contact = await createContact({
        id: ids.current.contact,
        name: name.trim(),
        email: email.trim(),
        phone: isEmail ? "" : handle ?? "",
        address: address.trim(),
      });
      if (!contact.id) {
        setError(contact.error ?? "Could not add the customer.");
        return;
      }
      if (withDeal) {
        const deal = await createLead({ id: ids.current.deal, contactId: contact.id, address: address.trim(), source: "Quo" });
        if (!deal.id) {
          setError(deal.error ?? "Could not create the deal.");
          return;
        }
      }
      const linked = await linkConversationContact(conversationId, contact.id);
      if (!linked.ok || !linked.conversationId) {
        setError(linked.error ?? "Could not move the conversation.");
        return;
      }
      onAdded(linked.conversationId);
    });
  }

  return (
    <ProjectModal title="Add as customer" subtitle={fmtHandle(handle)} onClose={() => !pending && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) save();
        }}
      >
        <div className="space-y-3 p-5">
          <Field label="Name">
            <Input autoFocus required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          {isEmail ? null : (
            <Field label="Email">
              <Input type="email" maxLength={200} value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
          )}
          <Field label="Address">
            <AddressInput maxLength={500} value={address} onChange={setAddress} />
          </Field>
          <div className="flex items-center justify-between gap-3 pt-1 text-[13px] text-[var(--color-text)]">
            Also create a deal
            <Switch label="Also create a deal" checked={withDeal} disabled={pending} onChange={setWithDeal} />
          </div>
          {error ? (
            <p role="alert" className="text-xs text-[var(--tag-red-text)]">
              {error}
            </p>
          ) : null}
        </div>
        <ModalFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Adding…" : "Add customer"}
          </Button>
        </ModalFooter>
      </form>
    </ProjectModal>
  );
}
