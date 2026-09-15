import { cache } from "react";
import { selectCanonicalJobId } from "@/lib/project-routing";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, any>;

export type ContactSummary = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  jobCount: number;
  leadCount: number;
  projectCount: number;
  lastActivityAt: string;
};

export type ContactProjectMedia = {
  id: string;
  ownerProjectId: string;
  mediaType: "image" | "video";
};

export type ContactProject = {
  id: string;
  kind: "lead" | "job";
  name: string;
  status: string;
  address: string | null;
  source: string | null;
  proposalNumber: string | null;
  amount: number | null;
  createdAt: string;
  updatedAt: string;
  media: ContactProjectMedia[];
  mediaCount: number;
};

export type ContactDetail = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  address: string | null;
  createdAt: string;
  projects: ContactProject[];
};

function relation(value: unknown): Row | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && typeof value === "object" ? (value as Row) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function leadAddress(lead: Row): string | null {
  return (
    text(lead.address) ??
    text(
      [lead.city, lead.province, lead.postal_code]
        .filter((part) => typeof part === "string" && part.trim())
        .join(", "),
    )
  );
}

function jobAddress(job: Row): string | null {
  return (
    text(job.formatted_address) ??
    text(job.address_line_1) ??
    text(
      [job.city, job.province, job.postal_code]
        .filter((part) => typeof part === "string" && part.trim())
        .join(", "),
    )
  );
}

function milliseconds(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function projectJobRank(job: Row): number {
  return ["archived", "cancelled"].includes(String(job.status).toLowerCase()) ? 0 : 1;
}

function currentJob(jobs: Row[]): Row | null {
  const visible = jobs.filter((job) => job.is_feed_visible !== false);
  if (!visible.length) return null;
  const canonicalId = selectCanonicalJobId(
    visible.map((job) => {
      const quote = relation(job.accepted_quote);
      return {
        jobId: String(job.id),
        acceptedAt: quote?.accepted_at ?? null,
        updatedAt: job.updated_at,
        isFeedVisible: job.is_feed_visible,
        quoteStatus: quote?.status ?? null,
      };
    }),
  );
  const canonical = visible.find((job) => job.id === canonicalId) ?? null;
  if (canonical && projectJobRank(canonical) > 0) return canonical;
  return (
    [...visible].sort(
      (left, right) =>
        projectJobRank(right) - projectJobRank(left) ||
        milliseconds(right.updated_at) - milliseconds(left.updated_at),
    )[0] ??
    canonical
  );
}

export async function getCustomerContactsPage(search: string, page: number): Promise<{ rows: ContactSummary[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_contacts_page", { search_text: search, page_number: page });
  if (error) throw new Error(`contacts: ${error.message}`);
  return data;
}

export const getContactDetail = cache(
  async (contactId: string): Promise<ContactDetail | null> => {
    const supabase = await createClient();
    const [{ data: contact, error: contactError }, { data: leads, error: leadError }] =
      await Promise.all([
        supabase
          .from("contacts")
          .select("id,name,email,phone,metadata,created_at")
          .eq("id", contactId)
          .eq("kind", "customer")
          .maybeSingle(),
        supabase
          .from("leads")
          .select(
            "id,contact_id,dripjobs_deal_id,status,source,address,city,province,postal_code,created_at,updated_at,metadata",
          )
          .eq("contact_id", contactId)
          .order("updated_at", { ascending: false }),
      ]);
    if (contactError) throw new Error(`contact: ${contactError.message}`);
    if (leadError) throw new Error(`contact leads: ${leadError.message}`);
    if (!contact) return null;

    const leadIds = (leads ?? []).map((lead) => lead.id);
    let jobQuery = supabase
      .from("jobs")
      .select(
        "id,contact_id,lead_id,name,status,contract_amount_cents,formatted_address,address_line_1,city,province,postal_code,started_on,created_at,updated_at,is_feed_visible,source,accepted_quote:quotes(id,lead_id,dripjobs_proposal_id,status,accepted_at)",
      )
      .eq("contact_id", contactId);
    if (leadIds.length) {
      jobQuery = supabase
        .from("jobs")
        .select(
          "id,contact_id,lead_id,name,status,contract_amount_cents,formatted_address,address_line_1,city,province,postal_code,started_on,created_at,updated_at,is_feed_visible,source,accepted_quote:quotes(id,lead_id,dripjobs_proposal_id,status,accepted_at)",
        )
        .or(`contact_id.eq.${contactId},lead_id.in.(${leadIds.join(",")})`);
    }
    const { data: jobs, error: jobError } = await jobQuery.order("updated_at", {
      ascending: false,
    });
    if (jobError) throw new Error(`contact jobs: ${jobError.message}`);

    const knownLeadIds = new Set((leads ?? []).map((lead) => lead.id));
    const jobsByLead = new Map<string, Row[]>();
    const orphanJobs: Row[] = [];
    for (const job of jobs ?? []) {
      const projectLeadId = relation(job.accepted_quote)?.lead_id ?? job.lead_id;
      if (projectLeadId && knownLeadIds.has(projectLeadId)) {
        const list = jobsByLead.get(projectLeadId) ?? [];
        list.push(job);
        jobsByLead.set(projectLeadId, list);
      } else if (job.is_feed_visible !== false) {
        orphanJobs.push(job);
      }
    }

    const projects: ContactProject[] = [];
    for (const lead of leads ?? []) {
      const job = currentJob(jobsByLead.get(lead.id) ?? []);
      if (job) {
        const quote = relation(job.accepted_quote);
        projects.push({
          id: job.id,
          kind: "job",
          name: text(job.name) ?? text(contact.name) ?? "Unnamed job",
          status: text(job.status) ?? "job",
          address: jobAddress(job) ?? leadAddress(lead),
          source: text(lead.source) ?? text(job.source),
          proposalNumber: text(quote?.dripjobs_proposal_id),
          amount:
            job.contract_amount_cents == null
              ? null
              : Number(job.contract_amount_cents) / 100,
          createdAt: text(job.started_on ?? job.created_at) ?? lead.created_at,
          updatedAt: text(job.updated_at) ?? job.created_at,
          media: [],
          mediaCount: 0,
        });
      } else {
        const metadata = lead.metadata ?? {};
        projects.push({
          id: lead.id,
          kind: "lead",
          name: text(contact.name) ?? "Unnamed lead",
          status: text(lead.status) ?? "lead",
          address: leadAddress(lead),
          source: text(lead.source),
          proposalNumber: text(metadata.proposal_number),
          amount:
            metadata.proposal_amount == null ? null : Number(metadata.proposal_amount),
          createdAt: lead.created_at,
          updatedAt: lead.updated_at ?? lead.created_at,
          media: [],
          mediaCount: 0,
        });
      }
    }
    for (const job of orphanJobs) {
      const quote = relation(job.accepted_quote);
      projects.push({
        id: job.id,
        kind: "job",
        name: text(job.name) ?? text(contact.name) ?? "Unnamed job",
        status: text(job.status) ?? "job",
        address: jobAddress(job),
        source: text(job.source),
        proposalNumber: text(quote?.dripjobs_proposal_id),
        amount:
          job.contract_amount_cents == null
            ? null
            : Number(job.contract_amount_cents) / 100,
        createdAt: text(job.started_on ?? job.created_at) ?? contact.created_at,
        updatedAt: text(job.updated_at) ?? job.created_at,
        media: [],
        mediaCount: 0,
      });
    }

    const jobIds = projects.filter((project) => project.kind === "job").map((project) => project.id);
    const projectLeadIds = projects
      .filter((project) => project.kind === "lead")
      .map((project) => project.id);
    const mediaResults = await Promise.all([
      jobIds.length
        ? supabase
            .from("job_media")
            .select("id,job_id,lead_id,media_type,captured_at,created_at")
            .in("job_id", jobIds)
            .order("captured_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      projectLeadIds.length
        ? supabase
            .from("job_media")
            .select("id,job_id,lead_id,media_type,captured_at,created_at")
            .in("lead_id", projectLeadIds)
            .order("captured_at", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    const mediaByOwner = new Map<string, ContactProjectMedia[]>();
    for (const result of mediaResults) {
      if (result.error) throw new Error(`contact media: ${result.error.message}`);
      for (const item of result.data ?? []) {
        const ownerProjectId = item.job_id ?? item.lead_id;
        if (!ownerProjectId) continue;
        const list = mediaByOwner.get(ownerProjectId) ?? [];
        list.push({
          id: item.id,
          ownerProjectId,
          mediaType: item.media_type === "video" ? "video" : "image",
        });
        mediaByOwner.set(ownerProjectId, list);
      }
    }

    const hydratedProjects = projects
      .map((project) => {
        const media = mediaByOwner.get(project.id) ?? [];
        return { ...project, media, mediaCount: media.length };
      })
      .sort((left, right) => milliseconds(right.updatedAt) - milliseconds(left.updatedAt));
    const metadata = contact.metadata ?? {};
    return {
      address: text(contact.metadata?.address),
      id: contact.id,
      name: text(contact.name) ?? "Unnamed contact",
      email: text(contact.email),
      phone: text(contact.phone),
      notes: text(metadata.customer_notes),
      createdAt: contact.created_at,
      projects: hydratedProjects,
    };
  },
);
