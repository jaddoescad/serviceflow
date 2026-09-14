export type JobsTableSortRow = {
  name: string;
  jobStartedOn: string | null;
  labourClosedAt: string | null;
  lastClockIn: string | null;
};

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Surface open jobs with real labour activity without disturbing the
 * established start-date ordering for every other job. Clock activity is the
 * ordering signal.
 */
export function compareJobsTableRows(
  left: JobsTableSortRow,
  right: JobsTableSortRow,
): number {
  const leftIsOpen = !left.labourClosedAt;
  const rightIsOpen = !right.labourClosedAt;
  const leftHasOpenClockActivity = leftIsOpen && Boolean(left.lastClockIn);
  const rightHasOpenClockActivity = rightIsOpen && Boolean(right.lastClockIn);

  if (leftHasOpenClockActivity !== rightHasOpenClockActivity) {
    return leftHasOpenClockActivity ? -1 : 1;
  }

  if (leftHasOpenClockActivity && rightHasOpenClockActivity) {
    const clockActivityDelta = timestamp(right.lastClockIn) - timestamp(left.lastClockIn);
    if (clockActivityDelta !== 0) return clockActivityDelta;
  }

  const jobStartDelta = timestamp(right.jobStartedOn) - timestamp(left.jobStartedOn);
  if (jobStartDelta !== 0) return jobStartDelta;

  return left.name.localeCompare(right.name, "en-CA");
}
