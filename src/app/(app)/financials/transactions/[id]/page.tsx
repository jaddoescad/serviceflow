import Link from "next/link";
import { notFound } from "next/navigation";
import { PaymentEvidence } from "@/components/settlement-evidence";
import { Badge } from "@/components/ui";
import { PageHeader } from "@/components/kpi";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { getLabourPaymentEvidence } from "@/lib/settlements";

export const dynamic = "force-dynamic";

export default async function FinancialTransactionEvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const transactionId = decodeURIComponent(id);
  const [, payment] = await Promise.all([
    requireStaff(),
    getLabourPaymentEvidence(transactionId),
  ]);

  if (!payment) notFound();

  return (
    <>
      <div className="mb-4">
        <Link
          href="/financials"
          className="text-sm font-medium text-[var(--color-brand-strong)] hover:underline"
        >
          ← Financials
        </Link>
      </div>
      <PageHeader
        title={
          payment.transaction.counterparty ?? payment.transaction.description
        }
        subtitle={`${fmtDate(payment.transaction.posted_on)} · ${
          payment.transaction.account_name
        } •••• ${payment.transaction.account_last_four ?? "—"}`}
        actions={
          <Badge
            tone={
              payment.verification?.payment_status === "fully_allocated"
                ? "good"
                : "warn"
            }
          >
            {payment.verification?.payment_status
              ?.replaceAll("_", " ")
              .replace(/^\w/, (character) => character.toUpperCase()) ??
              "Needs review"}
          </Badge>
        }
      />
      <PaymentEvidence payment={payment} />
    </>
  );
}
