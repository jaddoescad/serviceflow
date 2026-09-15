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
import { requireStaff } from "@/lib/auth";
import {
  projectDetails,
  projectTaskProgress,
  rollupProjects,
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

/** Shared presentation fields for both unconverted leads and operational jobs. */
export const getProjectPresentation = cache(async (projectId: string) => {
  await requireStaff();
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .select(
      "id,name,status,formatted_address,address_line_1,lead_id,contact_id,metadata,contact:contacts(name,email,phone,metadata)",
    )
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw new Error(`project presentation: ${error.message}`);

  if (!job) {
    const [{ data: lead, error: leadError }, { data: quotes, error: quotesError }] =
      await Promise.all([
        supabase
          .from("leads")
          .select(
            "id,status,address,city,province,postal_code,metadata,contact:contacts(name,email,phone,metadata)",
          )
          .eq("id", projectId)
          .maybeSingle(),
        supabase
          .from("quotes")
          .select("id,status,accepted_at,updated_at,job:jobs(id,is_feed_visible)")
          .eq("lead_id", projectId)
          .order("accepted_at", { ascending: false, nullsFirst: false })
          .order("updated_at", { ascending: false }),
      ]);
    if (leadError) throw new Error(`lead presentation: ${leadError.message}`);
    if (quotesError) throw new Error(`lead project jobs lookup: ${quotesError.message}`);
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
      name: contact.name ?? "Unnamed lead",
      status: firstText(lead.status),
      address: contact.address,
      description: firstText(
        metadata.project_description,
        metadata.companycam_description,
        metadata.description,
        metadata.scope_description,
      ),
      notes: firstText(metadata.project_notes),
      contact,
      isLead: true,
      canonicalJobId: selectCanonicalJobId(candidates),
    };
  }

  let sourceLead: JsonRecord = {};
  let leadMetadata: JsonRecord = {};
  if (job.lead_id) {
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select(
        "address,city,province,postal_code,metadata,contact:contacts(name,email,phone,metadata)",
      )
      .eq("id", job.lead_id)
      .maybeSingle();
    if (leadError) throw new Error(`project lead presentation: ${leadError.message}`);
    sourceLead = asRecord(lead);
    leadMetadata = asRecord(lead?.metadata);
  }

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
    name: job.name,
    status: firstText(job.status),
    address,
    description: firstText(
      metadata.project_description,
      metadata.companycam_description,
      metadata.description,
      metadata.scope_description,
      leadMetadata.project_description,
      leadMetadata.companycam_description,
      leadMetadata.description,
    ),
    notes: firstText(metadata.project_notes, leadMetadata.project_notes),
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
 * Loads one job's data (entries, budget, tasks) instead of the whole
 * company's history. cache() dedupes calls within a request.
 */
export const getProjectData = cache(async (projectId: string) => {
  const presentation = await getProjectPresentation(projectId);
  if (!presentation) return null;
  if (presentation.isLead) {
    return {
      canManage: false,
      project: emptyLeadRollup(projectId, presentation),
      detail: {
        entryCount: 0,
        activeEntryCount: 0,
        crew: [],
        recentEntries: [],
      },
      taskProgress: [],
    };
  }

  const now = Date.now();
  const [
    profile,
    project,
    entries,
    payRates,
    budgets,
    assignments,
    labourTasks,
    employees,
  ] = await Promise.all([
    requireStaff(),
    getProjectById(projectId),
    getProjectTimeEntries(projectId, new Date(now - 180 * DAY).toISOString()),
    getEmployeePayRates(),
    getProjectBudgetRows(projectId),
    getProjectAssignments(projectId),
    getLabourTasksForProject(projectId),
    getEmployees(),
  ]);

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

  return {
    canManage: ["admin", "manager"].includes(profile.role),
    project: rollup,
    detail: projectDetails(entries, payRates, now)[projectId],
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
