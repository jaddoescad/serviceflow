import { permanentRedirect } from "next/navigation";

export default async function LegacyLeadInvoicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  permanentRedirect(`/jobs/${encodeURIComponent(decodeURIComponent(id))}/invoices`);
}
