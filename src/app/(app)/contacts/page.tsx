import { ContactsTable } from "@/components/contacts-table";
import { getCustomerContactsPage } from "@/lib/contacts";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string; q?: string; page?: string }>;
}) {
  const { create, q, page: pageParam } = await searchParams;
  const query = (q ?? "").slice(0, 200);
  const requestedPage = Math.max(
    1,
    Math.min(1000000, Number.parseInt(pageParam ?? "1", 10) || 1),
  );
  const { rows: contacts, total } = await getCustomerContactsPage(
    query,
    requestedPage,
  );
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / 50)));

  return (
    <section className="workspace-page">
      <ContactsTable
        initiallyOpen={create === "1"}
        contacts={contacts}
        total={total}
        currentPage={page}
        query={query}
      />
    </section>
  );
}
