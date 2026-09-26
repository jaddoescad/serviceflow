"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { CreateContactModal } from "./create-contact-form";
import { Avatar, Button, Card, EmptyState, Input } from "@/components/ui";
import { fmtDate, initials } from "@/lib/format";
import type { ContactSummary } from "@/lib/contacts";

const PAGE_SIZE = 50;

export function ContactsTable({
  contacts,
  total,
  currentPage,
  query,
  initiallyOpen = false,
}: {
  initiallyOpen?: boolean;
  contacts: ContactSummary[];
  total: number;
  currentPage: number;
  query: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const [pending, startTransition] = useTransition();
  const previousQuery = useRef(query);
  useEffect(() => {
    const previous = previousQuery.current;
    previousQuery.current = query;
    setSearch((value) => (value.trim() === previous ? query : value));
  }, [query]);
  function navigate(page: number, value: string) {
    const params = new URLSearchParams();
    if (value.trim()) params.set("q", value.trim());
    if (page > 1) params.set("page", String(page));
    startTransition(() =>
      router.replace(`/contacts${params.size ? `?${params}` : ""}`, {
        scroll: false,
      }),
    );
  }
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => navigate(1, search), 300);
    return () => clearTimeout(timer);
  }, [search, query]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = currentPage;
  const visible = contacts;

  return (
    <>
      <header className="mb-8 flex flex-wrap items-center gap-6">
        <h1 className="text-4xl font-extrabold tracking-tight">Customers</h1>
        <div className="w-full sm:w-72">
          <Input
            type="search"
            aria-label="Search customers"
            placeholder="Search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            className="bg-[var(--color-surface)]"
          />
        </div>
        <div className="ml-auto">
          <CreateContactModal initiallyOpen={initiallyOpen} />
        </div>
      </header>

      <Card className="overflow-hidden" aria-busy={pending}>
        {visible.length === 0 ? (
          <EmptyState>No customers match this search.</EmptyState>
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
                      {contact.address && (
                        <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                          {contact.address}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="hidden min-w-0 text-xs text-[var(--color-muted)] lg:block">
                    <div className="truncate">
                      {contact.email || "No email"}
                    </div>
                    <div className="mt-0.5 truncate">
                      {contact.phone || "No phone"}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-xs text-slate-500">
                      {contact.projectCount}{" "}
                      {contact.projectCount === 1 ? "project" : "projects"}
                    </span>
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
                {Math.min(safePage * PAGE_SIZE, total).toLocaleString("en-CA")}{" "}
                of {total.toLocaleString("en-CA")}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={pending || safePage <= 1}
                  onClick={() => navigate(Math.max(1, safePage - 1), query)}
                >
                  Previous
                </Button>
                <span className="text-xs tabular-nums text-[var(--color-muted)]">
                  Page {safePage} of {totalPages}
                </span>
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={pending || safePage >= totalPages}
                  onClick={() =>
                    navigate(Math.min(totalPages, safePage + 1), query)
                  }
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
