"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createContact, searchCustomers } from "@/lib/actions/contacts";
import { createLead } from "@/lib/actions/pipeline";
import type { CustomerRow } from "@/lib/customer-list";
import { AddressInput } from "./address-input";
import { SearchIcon } from "./pipeline-ui";
import { ModalFooter, ProjectModal } from "./project-profile-panel";
import { Button, Input, Select, cn } from "./ui";

const LEAD_SOURCES = [
  "Phone Call",
  "Google",
  "Organic Search",
  "Facebook",
  "Instagram",
  "Word of Mouth",
  "Mail",
  "Website",
  "Other",
];

// A filled-in customer's details stay readable while locked.
const lockedClass = "disabled:text-[var(--color-text)]";

export type NewDeal = { id: string; name: string; address: string };

function DealField({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-text)]">
        {label}
        {required ? <span className="ml-0.5 text-[var(--color-bad)]">*</span> : null}
      </span>
      {children}
    </label>
  );
}

/** Finds someone already in the customer list. Its results float over the form. */
function CustomerSearch({ onPick }: { onPick: (customer: CustomerRow) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerRow[]>([]);
  // Shown in place of results: nothing found, or the search failed.
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
    if (query.trim().length < 2) {
      setResults([]);
      setMessage("");
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchCustomers(query).then(
        (rows) => {
          if (cancelled) return;
          setResults(rows);
          setMessage(rows.length ? "" : "No customers found.");
        },
        () => {
          if (cancelled) return;
          setResults([]);
          setMessage("Could not search. Try again.");
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const expanded = open && (results.length > 0 || Boolean(message));

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted)]" />
      <Input
        role="combobox"
        autoComplete="off"
        aria-label="Search existing customers"
        aria-expanded={expanded}
        placeholder="Search existing customers"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Never submits the deal form from here.
            event.preventDefault();
            if (expanded && results[active]) onPick(results[active]);
          } else if (expanded && event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((index) => Math.max(0, Math.min(results.length - 1, index + step)));
          }
        }}
        className="h-10 rounded-none border-0 bg-transparent pl-11 pr-5 focus:bg-[var(--color-surface-2)] focus:shadow-none"
      />
      {expanded ? (
        <div className="absolute inset-x-3 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-pop)]">
          {message ? <p className="px-2 py-1.5 text-[13px] text-[var(--color-muted)]">{message}</p> : null}
          {results.map((customer, index) => {
            const details = [customer.phone, customer.email, customer.address].filter(Boolean).join(" · ");
            return (
              <button
                key={customer.id}
                type="button"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(customer)}
                className={cn(
                  "block w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-hover)]",
                  active === index && "bg-[var(--color-hover)]",
                )}
              >
                <span className="block truncate text-[13px] font-medium text-[var(--color-heading)]">{customer.name}</span>
                {details ? <span className="block truncate text-xs text-[var(--color-muted)]">{details}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function NewDealDialog({ onClose, onBook }: { onClose: () => void; onBook: (deal: NewDeal) => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [source, setSource] = useState("");
  // Set when the deal is for someone found in the search.
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const nameInput = useRef<HTMLInputElement>(null);
  // Kept across retries so a second press doesn't make a second customer or deal.
  const ids = useRef({ contact: crypto.randomUUID(), deal: crypto.randomUUID() });

  // Most deals are for new customers, so start in Name rather than the search.
  useEffect(() => {
    if (!customer) nameInput.current?.focus();
  }, [customer]);

  function fill(next: CustomerRow | null) {
    setCustomer(next);
    setName(next?.name ?? "");
    setPhone(next?.phone ?? "");
    setEmail(next?.email ?? "");
    setAddress(next?.address ?? "");
  }

  function save(book: boolean) {
    setError("");
    startTransition(async () => {
      try {
        let contactId = customer?.id;
        if (!contactId) {
          const created = await createContact({
            id: ids.current.contact,
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim(),
            address: address.trim(),
          });
          if (!created.id) {
            setError(created.error ?? "Could not add the customer.");
            return;
          }
          contactId = created.id;
        }
        const deal = await createLead({ id: ids.current.deal, contactId, address: address.trim(), source });
        if (!deal.id) {
          setError(deal.error ?? "Could not add the deal.");
          return;
        }
        router.refresh();
        onClose();
        if (book) onBook({ id: deal.id, name: name.trim(), address: address.trim() });
      } catch {
        setError("Could not confirm the deal. Retry safely.");
      }
    });
  }

  return (
    <ProjectModal narrow title="New Deal" onClose={() => !pending && onClose()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(false);
        }}
      >
        <fieldset disabled={pending} className="min-w-0">
          <div className="border-b border-[var(--color-border)]">
            {customer ? (
              <div className="flex h-10 items-center justify-between gap-3 pl-5 pr-3">
                <span className="text-[13px] text-[var(--color-muted)]">Existing customer</span>
                <button
                  autoFocus
                  type="button"
                  className="rounded-[var(--radius-control)] px-2 py-1 text-xs font-medium text-[var(--color-muted)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]"
                  onClick={() => fill(null)}
                >
                  Clear
                </button>
              </div>
            ) : (
              <CustomerSearch onPick={fill} />
            )}
          </div>
          <div className="space-y-3 px-5 py-4">
            <DealField label="Name" required>
              <Input
                ref={nameInput}
                required
                disabled={Boolean(customer)}
                maxLength={160}
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={lockedClass}
              />
            </DealField>
            <div className="grid gap-3 sm:grid-cols-2">
              <DealField label="Phone">
                <Input
                  type="tel"
                  disabled={Boolean(customer)}
                  maxLength={60}
                  autoComplete="off"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className={lockedClass}
                />
              </DealField>
              <DealField label="Email">
                <Input
                  type="email"
                  disabled={Boolean(customer)}
                  maxLength={320}
                  autoComplete="off"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={lockedClass}
                />
              </DealField>
            </div>
            <DealField label="Address">
              <AddressInput maxLength={500} value={address} onChange={setAddress} />
            </DealField>
            <DealField label="Lead source">
              <span className="relative block">
                <Select
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  className={cn("w-full appearance-none pl-2.5 pr-8", !source && "text-[var(--color-faint)]")}
                >
                  <option value="">Choose a source</option>
                  {LEAD_SOURCES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted)]"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </DealField>
            {error ? (
              <p role="alert" className="text-[13px] text-[var(--color-bad)]">
                {error}
              </p>
            ) : null}
          </div>
        </fieldset>
        <ModalFooter>
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose} className="-ml-3 mr-auto">
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={(event) => {
              if (event.currentTarget.form?.reportValidity()) save(true);
            }}
          >
            Add &amp; Book Appointment
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add Deal"}
          </Button>
        </ModalFooter>
      </form>
    </ProjectModal>
  );
}

/** Adds a deal to the sales pipeline, for a new customer unless an existing
 * one is searched for. `onBook` takes over when the deal gets an appointment next. */
export function NewDealButton({ onBook }: { onBook: (deal: NewDeal) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ New Deal</Button>
      {open ? <NewDealDialog onClose={() => setOpen(false)} onBook={onBook} /> : null}
    </>
  );
}
