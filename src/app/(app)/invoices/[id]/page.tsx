import { notFound } from "next/navigation";
import { InvoiceDetail } from "@/components/invoice-detail";
import { requireStaff } from "@/lib/auth";
import { getUnifiedInvoice } from "@/lib/v2-accounting";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const invoice = await getUnifiedInvoice(decodeURIComponent(id));
  if (!invoice) notFound();
  return <InvoiceDetail invoice={invoice} />;
}
