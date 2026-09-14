import Link from "next/link";
import { ContactsTable } from "@/components/contacts-table";
import { PageHeader } from "@/components/kpi";
import { getCustomerContacts } from "@/lib/contacts";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const contacts = await getCustomerContacts();

  return (
    <>
      <PageHeader
        title="Contacts"
        actions={<Link href="/contacts/new" className="shrink-0 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-ink)]">Create contact</Link>}
        subtitle={`${contacts.length.toLocaleString("en-CA")} customers, with every deal and job kept separate`}
      />
      <ContactsTable contacts={contacts} />
    </>
  );
}
