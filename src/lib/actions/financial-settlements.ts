"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import {
  manualSettlementOptions,
  type ManualSettlementKind,
  type ManualSettlementResolution,
} from "@/lib/financial-settlement-status";
import { createClient } from "@/lib/supabase/server";

export type FinancialSettlementActionResult = {
  ok: boolean;
  error?: string;
};

const allowedKinds = new Set<ManualSettlementKind>(
  manualSettlementOptions.map((option) => option.value),
);

function objectValue(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function historyValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export async function setFinancialSettlementState(input: {
  transactionId: string;
  state: "needs_review" | ManualSettlementKind;
  note?: string;
}): Promise<FinancialSettlementActionResult> {
  const transactionId = input.transactionId.trim();
  if (!transactionId) return { ok: false, error: "Transaction is required." };

  const isNeedsReview = input.state === "needs_review";
  if (
    input.state !== "needs_review" &&
    !allowedKinds.has(input.state)
  ) {
    return { ok: false, error: "Choose a valid custom state." };
  }

  const note = input.note?.trim() ?? "";
  if (!isNeedsReview && note.length < 3) {
    return {
      ok: false,
      error: "Add a short note explaining why no further review is required.",
    };
  }
  if (note.length > 1000) {
    return { ok: false, error: "Keep the note under 1,000 characters." };
  }

  const profile = await requireStaff();
  const supabase = await createClient();
  const [transactionResult, labourResult, customerResult] = await Promise.all([
    supabase
      .from("financial_transactions")
      .select("id,amount,source_data")
      .eq("id", transactionId)
      .maybeSingle(),
    supabase
      .from("labour_payment_verification")
      .select("payment_status")
      .eq("financial_transaction_id", transactionId)
      .maybeSingle(),
    supabase
      .from("customer_revenue_verification")
      .select("payment_status")
      .eq("financial_transaction_id", transactionId)
      .maybeSingle(),
  ]);

  if (transactionResult.error) {
    return { ok: false, error: transactionResult.error.message };
  }
  if (labourResult.error) return { ok: false, error: labourResult.error.message };
  if (customerResult.error) {
    return { ok: false, error: customerResult.error.message };
  }
  if (!transactionResult.data) {
    return { ok: false, error: "Transaction was not found." };
  }

  const alreadyFullyMatched =
    labourResult.data?.payment_status === "fully_allocated" ||
    customerResult.data?.payment_status === "fully_allocated";
  if (!isNeedsReview && alreadyFullyMatched) {
    return {
      ok: false,
      error:
        "This transaction is already fully matched by allocations. Reverse those allocations before replacing them with a custom state.",
    };
  }

  const now = new Date().toISOString();
  const sourceData = objectValue(transactionResult.data.source_data);
  const existingResolution = objectValue(
    sourceData.manual_settlement_resolution,
  );
  const history = historyValue(sourceData.manual_settlement_resolution_history);
  if (Object.keys(existingResolution).length) {
    history.push({
      ...existingResolution,
      superseded_by: profile.user_id,
      superseded_at: now,
      superseded_reason: isNeedsReview
        ? "Returned to needs review"
        : "Replaced by another custom state",
    });
  }

  const nextSourceData: Record<string, unknown> = {
    ...sourceData,
    manual_settlement_resolution_history: history,
  };
  if (input.state === "needs_review") {
    delete nextSourceData.manual_settlement_resolution;
  } else {
    const customState = input.state;
    const option = manualSettlementOptions.find(
      (candidate) => candidate.value === customState,
    );
    if (!option) return { ok: false, error: "Choose a valid custom state." };
    const resolution: ManualSettlementResolution = {
      status: "confirmed",
      kind: customState,
      label: option.label,
      note,
      amount: Math.abs(Number(transactionResult.data.amount)),
      confirmed_by: profile.user_id,
      confirmed_at: now,
    };
    nextSourceData.manual_settlement_resolution = resolution;
  }

  const { error } = await supabase
    .from("financial_transactions")
    .update({
      source_data: nextSourceData,
      review_status: isNeedsReview ? "needs_review" : "reconciled",
    })
    .eq("id", transactionId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/financials");
  revalidatePath(`/financials/transactions/${encodeURIComponent(transactionId)}`);
  return { ok: true };
}
