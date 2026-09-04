export type CompletedLabourPeriodRow = {
  completedOn: string | null;
  amountBeforeTax: number | null;
  labourCost: number;
  labourExcluded: boolean;
};

export type CompletedLabourPeriodSummary = {
  count: number;
  jobValue: number;
  labourCost: number;
  sharePercent: number | null;
};

/** Revenue-weighted labour share for costed jobs completed in an inclusive date window. */
export function summarizeCompletedLabourPeriod(
  rows: readonly CompletedLabourPeriodRow[],
  fromDay: string,
  throughDay: string,
): CompletedLabourPeriodSummary {
  let count = 0;
  let jobValue = 0;
  let labourCost = 0;

  for (const row of rows) {
    const completedOn = row.completedOn?.slice(0, 10) ?? null;
    if (
      !completedOn ||
      completedOn < fromDay ||
      completedOn > throughDay ||
      row.labourExcluded ||
      row.amountBeforeTax == null ||
      row.amountBeforeTax <= 0 ||
      row.labourCost <= 0
    ) {
      continue;
    }

    count += 1;
    jobValue += row.amountBeforeTax;
    labourCost += row.labourCost;
  }

  return {
    count,
    jobValue,
    labourCost,
    sharePercent: jobValue > 0 ? (labourCost / jobValue) * 100 : null,
  };
}
