export type ProjectJobCandidate = {
  jobId: string;
  acceptedAt?: string | null;
  updatedAt?: string | null;
  isFeedVisible?: boolean | null;
  quoteStatus?: string | null;
};

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * A converted lead can have more than one historical quote. The most recently
 * accepted job is the canonical project page; timestamps and then the UUID
 * make the choice stable across the leads list and server-side redirects.
 */
export function selectCanonicalJobId(
  candidates: ProjectJobCandidate[],
): string | null {
  return (
    [...candidates]
      .filter(
        (candidate) =>
          Boolean(candidate.jobId) &&
          candidate.isFeedVisible !== false &&
          candidate.quoteStatus?.toLocaleLowerCase("en-CA") !== "superseded",
      )
      .sort(
        (left, right) =>
          timestamp(right.acceptedAt) - timestamp(left.acceptedAt) ||
          timestamp(right.updatedAt) - timestamp(left.updatedAt) ||
          left.jobId.localeCompare(right.jobId),
      )[0]?.jobId ?? null
  );
}
