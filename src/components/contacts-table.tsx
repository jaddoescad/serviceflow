"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar, Badge, Button, Card, EmptyState, Input } from "@/components/ui";
import { fmtDate, initials } from "@/lib/format";
import type { ContactSummary } from "@/lib/contacts";

const PAGE_SIZE = 50;

export function ContactsTable({ contacts }: { contacts: ContactSummary[] }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-CA");
    const rows = needle
      ? contacts.filter((contact) =>
          [contact.name, contact.email, contact.phone, contact.address].some((value) =>
            value?.toLocaleLowerCase("en-CA").includes(needle),
          ),
        )
      : contacts;
    return [...rows].sort(
      (left, right) =>
        Date.parse(right.lastActivityAt) - Date.parse(left.lastActivityAt) ||
        left.name.localeCompare(right.name, "en-CA"),
    );
  }, [contacts, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--color-muted)]">
          One contact can have multiple separate jobs.
        </p>
        <div className="w-full sm:w-72">
          <Input
            type="search"
            aria-label="Search contacts"
            placeholder="Search contacts…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="bg-[var(--color-surface)]"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState>No contacts match this search.</EmptyState>
        ) : (
          <>
            <div className="max-h-[72vh] overflow-auto">
              {visible.map((contact) => (
                <Link
                  key={contact.id}
                  href={`/contacts/${encodeURIComponent(contact.id)}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--color-border)] px-4 py-3 outline-none last:border-0 hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)] sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(12rem,0.8fr)_auto_8rem]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar label={initials(contact.name)} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--color-heading)]">
                        {contact.name}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                        {contact.address || "No project address yet"}
                      </div>
                    </div>
                  </div>

                  <div className="hidden min-w-0 text-xs text-[var(--color-muted)] lg:block">
                    <div className="truncate">{contact.email || "No email"}</div>
                    <div className="mt-0.5 truncate">{contact.phone || "No phone"}</div>
                  </div>

                  <div className="flex items-center justify-end gap-1.5">
                    {contact.jobCount > 0 ? (
                      <Badge tone="good">
                        {contact.jobCount} {contact.jobCount === 1 ? "job" : "jobs"}
                      </Badge>
                    ) : null}
                    {contact.leadCount > 0 ? (
                      <Badge tone="brand">
                        {contact.leadCount} {contact.leadCount === 1 ? "deal" : "deals"}
                      </Badge>
                    ) : null}
                    {contact.projectCount === 0 ? <Badge>No projects</Badge> : null}
                  </div>

                  <div className="hidden text-right text-xs text-[var(--color-muted)] lg:block">
                    {fmtDate(contact.lastActivityAt)}
                  </div>
                </Link>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 sm:px-5">
              <div className="text-xs text-[var(--color-muted)]">
                {((safePage - 1) * PAGE_SIZE + 1).toLocaleString("en-CA")}–
                {Math.min(safePage * PAGE_SIZE, filtered.length).toLocaleString("en-CA")} of{" "}
                {filtered.length.toLocaleString("en-CA")}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs tabular-nums text-[var(--color-muted)]">
                  Page {safePage} of {totalPages}
                </span>
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
