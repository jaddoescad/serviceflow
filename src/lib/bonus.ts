export type BonusContributor = {
  id: string;
  name: string;
  hours: number;
};

export type BonusAllocation = BonusContributor & {
  sharePercent: number;
  bonusAmount: number;
};

export type BonusAllocationResult = {
  totalHours: number;
  allocations: BonusAllocation[];
};

/** Positive amount left inside a percentage-based labour allowance. */
export function calculateBonusPool(
  jobAmountBeforeTax: number | null,
  painterCost: number,
  allowancePercent: number,
): number | null {
  if (
    jobAmountBeforeTax == null ||
    !Number.isFinite(jobAmountBeforeTax) ||
    !Number.isFinite(painterCost) ||
    !Number.isFinite(allowancePercent)
  ) {
    return null;
  }

  const remaining =
    jobAmountBeforeTax * (allowancePercent / 100) - Math.max(0, painterCost);
  return Math.max(0, Math.round((remaining + Number.EPSILON) * 100) / 100);
}

/**
 * Splits a currency pool in proportion to contributed hours.
 *
 * Currency is allocated in whole cents using the largest-remainder method so
 * the displayed painter amounts always add back to the displayed bonus pool.
 */
export function allocateBonusByHours(
  bonusPool: number,
  contributors: BonusContributor[],
): BonusAllocationResult {
  const eligible = contributors
    .filter(
      (contributor) =>
        Number.isFinite(contributor.hours) && contributor.hours > 0,
    )
    .map((contributor) => ({
      ...contributor,
      hours: Math.max(0, contributor.hours),
    }));
  const totalHours = eligible.reduce(
    (sum, contributor) => sum + contributor.hours,
    0,
  );

  if (totalHours <= 0) {
    return { totalHours: 0, allocations: [] };
  }

  const poolCents = Math.max(
    0,
    Math.round((Number.isFinite(bonusPool) ? bonusPool : 0) * 100),
  );
  const provisional = eligible.map((contributor, index) => {
    const share = contributor.hours / totalHours;
    const rawCents = poolCents * share;
    const cents = Math.floor(rawCents);
    return {
      contributor,
      index,
      share,
      cents,
      remainder: rawCents - cents,
    };
  });
  let centsLeft =
    poolCents -
    provisional.reduce((sum, allocation) => sum + allocation.cents, 0);

  const remainderOrder = [...provisional].sort(
    (left, right) =>
      right.remainder - left.remainder ||
      left.contributor.id.localeCompare(right.contributor.id),
  );
  for (const allocation of remainderOrder) {
    if (centsLeft <= 0) break;
    provisional[allocation.index].cents += 1;
    centsLeft -= 1;
  }

  return {
    totalHours,
    allocations: provisional
      .map(({ contributor, share, cents }) => ({
        ...contributor,
        sharePercent: share * 100,
        bonusAmount: cents / 100,
      }))
      .sort(
        (left, right) =>
          right.hours - left.hours ||
          left.name.localeCompare(right.name, "en-CA"),
      ),
  };
}
