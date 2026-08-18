export const LABOUR_COST_TARGET_PERCENT = 40;

export type LabourCostTone = "good" | "neutral" | "bad";

/**
 * Labour cost as a share of the list-backed job amount before HST.
 * The returned value is rounded to the one decimal place shown in the UI so
 * the displayed threshold and its colour can never disagree.
 */
export function labourCostPercent(
  labourSubtotalCents: number,
  jobRevenueBeforeHstCents: number | null | undefined,
): number | null {
  const labour = Number(labourSubtotalCents);
  const revenue = Number(jobRevenueBeforeHstCents);
  if (!Number.isFinite(labour) || labour < 0) return null;
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  return Math.round((labour / revenue) * 1_000) / 10;
}

export function labourCostTone(percent: number | null): LabourCostTone {
  if (percent == null || percent === LABOUR_COST_TARGET_PERCENT) return "neutral";
  return percent < LABOUR_COST_TARGET_PERCENT ? "good" : "bad";
}
