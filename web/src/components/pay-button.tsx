"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getPublicPaymentOptions } from "@/lib/actions/billing";
import type { PublicPaymentOptions } from "@/lib/billing-types";
import type { DocumentStrings } from "@/lib/customer-i18n";
import { cn } from "./ui";

// "Pay $X now" on a customer's invoice link, or on an accepted proposal's link
// (it pays the deposit invoice). It opens Stripe Checkout through
// /api/pay/<token> and shows nothing when the company doesn't take cards.
// Wording follows the page's language (customer-i18n.ts).

export function PayButton({ token, t, className }: { token: string; t: DocumentStrings; className?: string }) {
  const router = useRouter();
  const [options, setOptions] = useState<PublicPaymentOptions | null>(null);
  const [returned, setReturned] = useState<{ paid: boolean; error: string | null }>({ paid: false, error: null });
  const [submitting, setSubmitting] = useState(false);
  const [path, setPath] = useState("");

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search);
    const paid = query.get("paid") === "1";
    setPath(window.location.pathname);
    setReturned({ paid, error: query.get("pay_error") });
    getPublicPaymentOptions(token).then(
      (value) => active && setOptions(value),
      () => active && setOptions(null),
    );
    // Stripe's webhook usually lands within seconds of the redirect back.
    const refresh = paid ? window.setTimeout(() => router.refresh(), 4000) : undefined;
    return () => {
      active = false;
      window.clearTimeout(refresh);
    };
  }, [token, router]);

  // Coming back from Stripe with the browser's Back button restores this page as it was left.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => event.persisted && setSubmitting(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  if (returned.paid) {
    return (
      <p role="status" className={cn("text-[13px] font-semibold text-[#15803d] print:hidden", className)}>
        {t.pay.received}
      </p>
    );
  }
  if (!options) return null;
  if (!options.payable) {
    return options.reason === "locked" ? (
      <p className={cn("text-[13px] text-[var(--color-muted)] print:hidden", className)}>{t.pay.refused.locked}</p>
    ) : null;
  }
  const error = returned.error ? (t.pay.refused[returned.error] ?? t.pay.refused.failed) : null;
  return (
    <form
      method="post"
      action={`/api/pay/${encodeURIComponent(token)}`}
      onSubmit={() => setSubmitting(true)}
      className={cn("space-y-1.5 print:hidden", className)}
    >
      <input type="hidden" name="from" value={path} />
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#16a34a] px-5 text-sm font-semibold text-white outline-none transition-colors hover:bg-[#15803d] focus-visible:shadow-[var(--focus-ring)] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
      >
        {submitting ? t.pay.opening : t.pay.now(t.money(options.chargeCents))}
      </button>
      <p className="text-xs text-[var(--color-muted)]">
        {options.feeCents
          ? t.pay.fee(Number(options.feePercent).toLocaleString(t.locale), t.money(options.feeCents))
          : t.pay.secure}
      </p>
      {error ? (
        <p role="alert" className="text-[13px] text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
