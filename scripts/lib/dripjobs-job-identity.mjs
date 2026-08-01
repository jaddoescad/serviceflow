function proposalNumber(job) {
  const value = Number(job.proposal_id);
  return Number.isFinite(value) ? value : 0;
}

function preferredCompanyCamJob(left, right) {
  if (Boolean(left.archived) !== Boolean(right.archived)) {
    return left.archived ? 1 : -1;
  }

  return proposalNumber(right) - proposalNumber(left);
}

export function dripJobsProjectId(job) {
  if (!job?.proposal_id) {
    throw new Error("DripJobs job is missing a proposal ID.");
  }
  return `dripjobs-${job.proposal_id}`;
}

/**
 * Give every DripJobs proposal exactly one accounting-project row.
 *
 * CompanyCam is allowed to support a job, but it cannot define accounting
 * identity: it may be missing and it may be reused for a later proposal. When
 * a CompanyCam project is reused, the current/newest DripJobs proposal keeps
 * the operational ID and every other proposal receives a stable DripJobs ID.
 */
export function buildDripJobsProjectIdentity(jobs, existingProjectIds) {
  const projectIds =
    existingProjectIds instanceof Set
      ? existingProjectIds
      : new Set(existingProjectIds ?? []);
  const jobsByCompanyCamId = new Map();
  const projectIdByProposal = new Map();

  for (const job of jobs) {
    if (!job?.proposal_uuid) {
      throw new Error("DripJobs job is missing a proposal UUID.");
    }
    if (projectIdByProposal.has(job.proposal_uuid)) {
      throw new Error(`Duplicate DripJobs proposal UUID ${job.proposal_uuid}.`);
    }

    const companyCamId = job.companycam_project_id
      ? String(job.companycam_project_id)
      : null;
    if (!companyCamId) {
      projectIdByProposal.set(job.proposal_uuid, dripJobsProjectId(job));
      continue;
    }
    if (!projectIds.has(companyCamId)) {
      throw new Error(
        `DripJobs proposal ${job.proposal_id} links missing CompanyCam project ${companyCamId}.`,
      );
    }

    const group = jobsByCompanyCamId.get(companyCamId) ?? [];
    group.push(job);
    jobsByCompanyCamId.set(companyCamId, group);
  }

  const collisions = [];
  for (const [companyCamId, groupedJobs] of jobsByCompanyCamId) {
    const ordered = [...groupedJobs].sort(preferredCompanyCamJob);
    const operationalJob = ordered[0];
    projectIdByProposal.set(operationalJob.proposal_uuid, companyCamId);

    for (const historicalJob of ordered.slice(1)) {
      projectIdByProposal.set(
        historicalJob.proposal_uuid,
        dripJobsProjectId(historicalJob),
      );
    }

    if (ordered.length > 1) {
      collisions.push({
        companycam_project_id: companyCamId,
        operational_proposal_id: String(operationalJob.proposal_id),
        separated_proposal_ids: ordered
          .slice(1)
          .map((job) => String(job.proposal_id)),
      });
    }
  }

  const assignedIds = [...projectIdByProposal.values()];
  if (projectIdByProposal.size !== jobs.length) {
    throw new Error("Not every DripJobs proposal received a project identity.");
  }
  if (new Set(assignedIds).size !== assignedIds.length) {
    throw new Error("Two DripJobs proposals still share an accounting project ID.");
  }

  return { projectIdByProposal, collisions };
}
