import { cache } from "react";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type JsonRecord = Record<string, unknown>;

export type PhotoFeedItem = {
  id: string;
  ownerProjectId: string;
  ownerKind: "job" | "lead";
  projectName: string;
  address: string | null;
  mediaType: "image" | "video";
  mimeType: string;
  durationMs: number | null;
  capturedAt: string;
  creatorName: string;
  description: string | null;
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

function relatedRow(value: unknown): JsonRecord {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function leadAddress(lead: JsonRecord): string | null {
  const direct = firstText(lead.address);
  if (direct && !/^(ca|canada)$/i.test(direct)) return direct;
  return firstText(
    [lead.city, lead.province, lead.postal_code]
      .filter((value) => typeof value === "string" && value.trim())
      .join(", "),
  );
}

export const getPhotoFeed = cache(async (): Promise<PhotoFeedItem[]> => {
  await requireStaff();
  const supabase = await createClient();
  const { data: mediaRows, error: mediaError } = await supabase
    .from("job_media")
    .select(
      "id,job_id,lead_id,uploaded_by,media_type,mime_type,duration_ms,captured_at,created_at,source_metadata",
    )
    .order("captured_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(600);

  if (mediaError) throw new Error(`photo feed: ${mediaError.message}`);

  const jobIds = [...new Set((mediaRows ?? []).flatMap((row) => row.job_id ? [String(row.job_id)] : []))];
  const leadIds = [...new Set((mediaRows ?? []).flatMap((row) => row.lead_id ? [String(row.lead_id)] : []))];
  const uploaderIds = [...new Set((mediaRows ?? []).flatMap((row) => row.uploaded_by ? [String(row.uploaded_by)] : []))];

  const [jobsResult, leadsResult, uploadersResult] = await Promise.all([
    jobIds.length
      ? supabase
          .from("jobs")
          .select("id,name,formatted_address,address_line_1")
          .in("id", jobIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length
      ? supabase
          .from("leads")
          .select("id,address,city,province,postal_code,contact:contacts(name)")
          .in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
    uploaderIds.length
      ? supabase
          .from("employees")
          .select("id,full_name,email")
          .in("id", uploaderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (jobsResult.error) throw new Error(`photo feed jobs: ${jobsResult.error.message}`);
  if (leadsResult.error) throw new Error(`photo feed leads: ${leadsResult.error.message}`);
  if (uploadersResult.error) throw new Error(`photo feed uploaders: ${uploadersResult.error.message}`);

  const jobsById = new Map(
    (jobsResult.data ?? []).map((job: any) => [String(job.id), asRecord(job)]),
  );
  const leadsById = new Map(
    (leadsResult.data ?? []).map((lead: any) => [String(lead.id), asRecord(lead)]),
  );
  const uploadersById = new Map(
    (uploadersResult.data ?? []).map((uploader: any) => [String(uploader.id), asRecord(uploader)]),
  );

  return (mediaRows ?? []).flatMap((row: any): PhotoFeedItem[] => {
    const ownerProjectId = firstText(row.job_id, row.lead_id);
    if (!ownerProjectId) return [];

    const ownerKind = row.job_id ? "job" : "lead";
    const sourceMetadata = asRecord(row.source_metadata);
    const uploader = uploadersById.get(String(row.uploaded_by ?? "")) ?? {};
    const creatorName = firstText(
      sourceMetadata.creator_name,
      uploader.full_name,
      uploader.email,
    ) ?? "Ottawa Painters";
    const capturedAt = firstText(row.captured_at, row.created_at);
    if (!capturedAt) return [];

    if (ownerKind === "job") {
      const job = jobsById.get(ownerProjectId) ?? {};
      return [{
        id: String(row.id),
        ownerProjectId,
        ownerKind,
        projectName: firstText(job.name) ?? "Unnamed job",
        address: firstText(job.formatted_address, job.address_line_1),
        mediaType: row.media_type === "video" ? "video" : "image",
        mimeType: firstText(row.mime_type) ?? "image/jpeg",
        durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
        capturedAt,
        creatorName,
        description: firstText(sourceMetadata.description),
      } satisfies PhotoFeedItem];
    }

    const lead = leadsById.get(ownerProjectId) ?? {};
    const contact = relatedRow(lead.contact);
    return [{
      id: String(row.id),
      ownerProjectId,
      ownerKind,
      projectName: firstText(contact.name) ?? "Unnamed lead",
      address: leadAddress(lead),
      mediaType: row.media_type === "video" ? "video" : "image",
      mimeType: firstText(row.mime_type) ?? "image/jpeg",
      durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
      capturedAt,
      creatorName,
      description: firstText(sourceMetadata.description),
    } satisfies PhotoFeedItem];
  });
});
