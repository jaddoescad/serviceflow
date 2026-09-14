import { CreateContactModal } from "@/components/create-contact-form";
import { ContactsTable } from "@/components/contacts-table";
import { PageHeader } from "@/components/kpi";
import { getCustomerContacts } from "@/lib/contacts";

export const dynamic = "force-dynamic";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ create?: string }> }) {
  const { create } = await searchParams;
  const contacts = await getCustomerContacts();

  return (
    <>
      <PageHeader
        title="Contacts"
        actions={<CreateContactModal initiallyOpen={create === "1"} />}
        subtitle={`${contacts.length.toLocaleString("en-CA")} customers, with every deal and job kept separate`}
      />
      <ContactsTable contacts={contacts} />
    </>
  );
}
