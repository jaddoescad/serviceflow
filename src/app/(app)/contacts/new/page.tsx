import { PageHeader } from "@/components/kpi";
import { CreateContactForm } from "@/components/create-contact-form";
import { requireStaff } from "@/lib/auth";

export default async function NewContactPage() {
  await requireStaff();
  return <><PageHeader title="Create contact" subtitle="Add a customer. You can link their deals separately." /><CreateContactForm /></>;
}
