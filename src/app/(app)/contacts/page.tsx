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
        subtitle={`${contacts.length.toLocaleString("en-CA")} customers, with every lead and job kept separate`}
      />
      <ContactsTable contacts={contacts} />
    </>
  );
}
