import { cache } from "react";
import { loadGalleryPage } from "@/lib/actions/gallery-page";
import { DEFAULT_GALLERY_FILTERS } from "@/lib/gallery-page";
import {
  getEmployees,
  getEmployeePayRates,
  getLabourTasksForProject,
  getProjectAssignments,
  getProjectBudgetRows,
  getProjectById,
  getProjectTimeEntries,
} from "@/lib/queries";
import { requireStaff, requireMember } from "@/lib/auth";
import {
  LABOUR_ALERT_PERCENT,
  LABOUR_MAX_PERCENT,
  projectDetails,
  projectTaskProgress,
  rollupProjects,
  type BudgetUse,
  type ProjectRollup,
} from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { selectCanonicalJobId } from "@/lib/project-routing";

const DAY = 24 * 60 * 60 * 1000;

type JsonRecord = Record<string, unknown>;

export type ProjectMediaItem = {
  id: string;
  mediaType: "image" | "video";
  mimeType: string;
  originalFilename: string | null;
  durationMs: number | null;
  capturedAt: string | null;
  createdAt: string;
  creatorName: string | null;
  description: string | null;
  tags: string[];
  revision: string | null;
  trashRevision: string | null;
};

export type ProjectContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  customerNotes: string | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function usefulAddress(value: unknown): string | null {
  const address = firstText(value);
  if (!address || /^(ca|canada)$/i.test(address)) return null;
  return address;
}

function relatedRow(value: unknown): JsonRecord {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function leadAddress(lead: JsonRecord): string | null {
  return (
    usefulAddress(lead.address) ??
    firstText(
      [lead.city, lead.province, lead.postal_code]
        .filter((value) => typeof value === "string" && value.trim())
        .join(", "),
    )
  );
}

function leadContact(lead: JsonRecord): ProjectContact {
  const contact = relatedRow(lead.contact);
  const contactMetadata = asRecord(contact.metadata);
  return {
    name: firstText(contact.name),
    email: firstText(contact.email),
    phone: firstText(contact.phone),
    address: leadAddress(lead),
    customerNotes: firstText(contactMetadata.customer_notes),
  };
}

function emptyLeadRollup(
  projectId: string,
  presentation: Awaited<ReturnType<typeof getProjectPresentation>>,
): ProjectRollup {
  return {
    projectId,
    name: presentation?.name ?? "Unnamed lead",
    address: presentation?.address ?? null,
    jobStartedOn: null,
    productionMonth: null,
    labourExcluded: false,
    loggedHours: 0,
    budgetedHours: null,
    amountBeforeTax: null,
    hourlyRate: null,
    remainingHours: null,
    percentUsed: null,
    status: "none",
    crewHoursPercent: LABOUR_MAX_PERCENT,
    costTargetPercent: LABOUR_ALERT_PERCENT,
    laborCost: null,
    budgetCost: null,
    labourAllowanceLow: null,
    labourAllowanceHigh: null,
    clockedWageCost: 0,
    labourCostSource: "clocked_hours",
    wageCost: 0,
    wageSharePercent: null,
    allowanceUsedLowPercent: null,
    allowanceUsedHighPercent: null,
    remainingLabourLow: null,
    remainingLabourHigh: null,
    unpricedHours: 0,
    assignedCount: 0,
    lastActivity: null,
    lastClockIn: null,
    clockedHours: 0,
    labourClosedAt: null,
    labourBucket: "idle",
  };
}

const CONTACT_FIELDS = "name,email,phone,metadata";
const LEAD_FIELDS = `address,city,province,postal_code,metadata,contact:contacts(${CONTACT_FIELDS})`;

/**
 * Shared presentation fields for both unconverted leads and operational jobs.
 * The id may be either, so the job (with its source lead embedded) and the
 * lead lookups run in one parallel wave rather than one after another.
 */
export const getProjectPresentation = cache(async (projectId: string) => {
  const supabase = await createClient();
  const [
    { data: workspace },
    { data: job, error },
    { data: lead, error: leadError },
    { data: quotes, error: quotesError },
  ] = await Promise.all([
    supabase
      .from("project_workspace")
      .select("name,description")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select(
        `id,name,status,formatted_address,address_line_1,metadata,contact:contacts(${CONTACT_FIELDS}),lead:leads(${LEAD_FIELDS})`,
      )
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("leads")
      .select(`id,status,${LEAD_FIELDS}`)
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("quotes")
      .select("id,status,accepted_at,updated_at,job:jobs(id,is_feed_visible)")
      .eq("lead_id", projectId)
      .order("accepted_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false }),
    requireMember(),
  ]);

  if (error) throw new Error(`project presentation: ${error.message}`);

  if (!job) {
    if (leadError) throw new Error(`lead presentation: ${leadError.message}`);
    if (quotesError)
      throw new Error(`lead project jobs lookup: ${quotesError.message}`);
    if (!lead) return null;

    const leadRecord = asRecord(lead);
    const contact = leadContact(leadRecord);
    const metadata = asRecord(lead.metadata);
    const candidates = (quotes ?? []).flatMap((quote: any) => {
      const jobs = Array.isArray(quote.job)
        ? quote.job
        : quote.job
          ? [quote.job]
          : [];
      return jobs.map((relatedJob: any) => ({
        jobId: String(relatedJob.id),
        acceptedAt: quote.accepted_at,
        updatedAt: quote.updated_at,
        isFeedVisible: relatedJob.is_feed_visible,
        quoteStatus: quote.status,
      }));
    });

    return {
      name: workspace?.name ?? contact.name ?? "Unnamed lead",
      status: firstText(lead.status),
      address: contact.address,
      description:
        workspace?.description ??
        firstText(
          metadata.project_description,
          metadata.companycam_description,
          metadata.description,
          metadata.scope_description,
        ),
      contact,
      isLead: true,
      canonicalJobId: selectCanonicalJobId(candidates),
    };
  }

  const sourceLead = relatedRow(job.lead);
  const leadMetadata = asRecord(sourceLead.metadata);
  const metadata = asRecord(job.metadata);
  const linkedContact = leadContact(sourceLead);
  const directContact = relatedRow(job.contact);
  const directContactMetadata = asRecord(directContact.metadata);
  const address =
    usefulAddress(job.formatted_address) ??
    usefulAddress(job.address_line_1) ??
    linkedContact.address;
  const contact: ProjectContact = {
    name: firstText(directContact.name, linkedContact.name),
    email: firstText(directContact.email, linkedContact.email),
    phone: firstText(directContact.phone, linkedContact.phone),
    address,
    customerNotes: firstText(
      directContactMetadata.customer_notes,
      linkedContact.customerNotes,
    ),
  };
  return {
    name: workspace?.name ?? job.name,
    status: firstText(job.status),
    address,
    description:
      workspace?.description ??
      firstText(
        metadata.project_description,
        metadata.companycam_description,
        metadata.description,
        metadata.scope_description,
        leadMetadata.project_description,
        leadMetadata.companycam_description,
        leadMetadata.description,
      ),
    contact,
    isLead: false,
    canonicalJobId: null,
  };
});

export const getProjectMediaData = cache(async (projectId: string) => {
  const [presentation, galleryPage] = await Promise.all([
    getProjectPresentation(projectId),
    loadGalleryPage(projectId, DEFAULT_GALLERY_FILTERS),
  ]);
  if (!presentation) return null;
  return { ...presentation, media: galleryPage.items, galleryPage };
});

/**
 * Loads one job's labour data (entries, budget, tasks) instead of the whole
 * company's history. Everything starts in one parallel wave; for a lead the
 * job queries simply come back empty. cache() dedupes calls within a request.
 */
export const getProjectData = cache(async (projectId: string) => {
  const now = Date.now();
  const [
    presentation,
    profile,
    project,
    entries,
    payRates,
    budgets,
    assignments,
    labourTasks,
    employees,
    feed,
  ] = await Promise.all([
    getProjectPresentation(projectId),
    requireStaff(),
    getProjectById(projectId),
    getProjectTimeEntries(projectId, new Date(now - 180 * DAY).toISOString()),
    getEmployeePayRates(),
    getProjectBudgetRows(projectId),
    getProjectAssignments(projectId),
    getLabourTasksForProject(projectId),
    getEmployees(),
    createClient().then((supabase) =>
      supabase
        .from("job_feed")
        .select("budget_minutes,used_minutes,budget_hourly_rate_cents")
        .eq("id", projectId)
        .maybeSingle(),
    ),
  ]);
  if (feed.error) throw new Error(`job budget: ${feed.error.message}`);
  if (!presentation) return null;
  if (presentation.isLead) {
    return {
      canManage: false,
      project: emptyLeadRollup(projectId, presentation),
      budgetUse: null,
      detail: {
        entryCount: 0,
        activeEntryCount: 0,
        crew: [],
        entries: [],
      },
      taskProgress: [],
    };
  }
  if (!project) return null;

  const rows = rollupProjects(
    entries,
    [project],
    budgets,
    assignments,
    payRates,
    now,
  );
  const rollup = rows.find((row) => row.projectId === projectId);
  if (!rollup) return null;

  // The crew app's numbers; hidden jobs are not in job_feed and keep plain hours.
  const budgetUse: BudgetUse = feed.data
    ? {
        budgetHours: feed.data.budget_minutes == null ? null : Number(feed.data.budget_minutes) / 60,
        usedHours: Number(feed.data.used_minutes ?? 0) / 60,
        rate: feed.data.budget_hourly_rate_cents == null ? null : Number(feed.data.budget_hourly_rate_cents) / 100,
      }
    : { budgetHours: rollup.budgetedHours, usedHours: rollup.loggedHours, rate: rollup.hourlyRate };

  return {
    canManage: ["admin", "manager"].includes(profile.role),
    project: rollup,
    budgetUse,
    detail: projectDetails(entries, payRates, now)[projectId],
    taskProgress: projectTaskProgress(labourTasks, employees)[projectId] ?? [],
  };
});

/** The task list only needs the tasks and who completed them, not labour data. */
export const getProjectTasks = cache(async (projectId: string) => {
  const [presentation, profile, labourTasks, employees] = await Promise.all([
    getProjectPresentation(projectId),
    requireStaff(),
    getLabourTasksForProject(projectId),
    getEmployees(),
  ]);
  if (!presentation) return null;
  if (presentation.isLead) {
    return { name: presentation.name, canManage: false, taskProgress: [] };
  }
  return {
    name: presentation.name,
    canManage: ["admin", "manager"].includes(profile.role),
    taskProgress: projectTaskProgress(labourTasks, employees)[projectId] ?? [],
  };
});

/** Just enough to paint the job header instantly: auth + one project row. */
export const getProjectShell = cache(async (projectId: string) => {
  const supabase = await createClient();
  const [presentation, { count, error }] = await Promise.all([
    getProjectPresentation(projectId),
    supabase
      .from("job_media")
      .select("id", { count: "exact", head: true })
      .or(`job_id.eq.${projectId},lead_id.eq.${projectId}`),
  ]);
  if (!presentation) return null;
  if (error) throw new Error(`project media count: ${error.message}`);
  return {
    name: presentation.name,
    address: presentation.address,
    status: presentation.status,
    photoCount: count ?? 0,
    isLead: presentation.isLead,
    canonicalJobId: presentation.canonicalJobId,
  };
});
