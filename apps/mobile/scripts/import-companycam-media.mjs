import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const COMPANYCAM_API_BASE = "https://api.companycam.com/v2";
const R2_BUCKET = "ottawa-painters-project-media";
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 8;
const COMPANYCAM_PAGE_SIZE = 100;
const SUPABASE_PAGE_SIZE = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPANYCAM_ID_PATTERN = /^\d+$/;
const MIME_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = fileURLToPath(new URL("..", import.meta.url));
const workerDir = fileURLToPath(new URL("../cloudflare/project-media-worker", import.meta.url));
const wranglerPath = fileURLToPath(
  new URL("../cloudflare/project-media-worker/node_modules/.bin/wrangler", import.meta.url),
);

function parseArguments(argv) {
  const options = { apply: false, concurrency: DEFAULT_CONCURRENCY, limit: null };
  for (const argument of argv) {
    if (argument === "--apply") options.apply = true;
    else if (argument.startsWith("--concurrency=")) options.concurrency = Number(argument.split("=")[1]);
    else if (argument.startsWith("--limit=")) options.limit = Number(argument.split("=")[1]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 16) {
    throw new Error("--concurrency must be an integer from 1 to 16.");
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }
  return options;
}

function requireEnvironment(name, fallbackName = null) {
  const value = process.env[name] || (fallbackName ? process.env[fallbackName] : "");
  if (!value) throw new Error(`Missing ${name}${fallbackName ? ` (or ${fallbackName})` : ""}.`);
  return value;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url, init, label, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        const retryAfter = Math.max(1, Number(response.headers.get("retry-after")) || attempt * 2);
        await response.body?.cancel().catch(() => {});
        await sleep(retryAfter * 1000);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(attempt * 1500);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError?.message || "network error"}`);
}

async function requireJson(response, label) {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error(`${label} failed (${response.status}): ${detail}`);
  }
  return response.json();
}

function supabaseHeaders(serviceRoleKey, additional = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...additional,
  };
}

async function fetchSupabasePages(supabaseUrl, serviceRoleKey, path) {
  const rows = [];
  for (let offset = 0; ; offset += SUPABASE_PAGE_SIZE) {
    const response = await fetchWithRetry(
      `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${path}`,
      {
        headers: supabaseHeaders(serviceRoleKey, {
          Range: `${offset}-${offset + SUPABASE_PAGE_SIZE - 1}`,
        }),
      },
      `Supabase ${path.split("?")[0]}`,
    );
    const page = await requireJson(response, `Supabase ${path.split("?")[0]}`);
    if (!Array.isArray(page)) throw new Error("Supabase returned a non-array response.");
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }
  return rows;
}

async function loadMappings(supabaseUrl, serviceRoleKey) {
  const [jobs, leads, contacts] = await Promise.all([
    fetchSupabasePages(
      supabaseUrl,
      serviceRoleKey,
      "jobs?select=id,lead_id,name,status,is_feed_visible,companycam_project_ids,created_at,updated_at",
    ),
    fetchSupabasePages(
      supabaseUrl,
      serviceRoleKey,
      "leads?select=id,contact_id,dripjobs_deal_id,status,address,city,province,postal_code,metadata",
    ),
    fetchSupabasePages(supabaseUrl, serviceRoleKey, "contacts?select=id,name"),
  ]);
  const contactById = new Map(contacts.map((contact) => [String(contact.id), contact]));
  const jobsByLeadId = new Map();
  for (const job of jobs) {
    if (!job.lead_id) continue;
    const leadId = String(job.lead_id);
    const relatedJobs = jobsByLeadId.get(leadId) || [];
    relatedJobs.push(job);
    jobsByLeadId.set(leadId, relatedJobs);
  }
  const dealByLeadId = new Map(leads.map((lead) => [String(lead.id), lead.dripjobs_deal_id || null]));
  const leadsByDealId = new Map();
  for (const lead of leads) {
    if (!lead.dripjobs_deal_id) continue;
    const dealId = String(lead.dripjobs_deal_id);
    const matchingLeads = leadsByDealId.get(dealId) || [];
    matchingLeads.push(lead);
    leadsByDealId.set(dealId, matchingLeads);
  }
  const projectMap = new Map();
  const conflicts = [];

  for (const job of jobs) {
    if (!UUID_PATTERN.test(String(job.id))) continue;
    for (const rawProjectId of job.companycam_project_ids || []) {
      const projectId = String(rawProjectId);
      if (!COMPANYCAM_ID_PATTERN.test(projectId)) continue;
      if (projectMap.has(projectId) && projectMap.get(projectId).jobId !== job.id) {
        conflicts.push(projectId);
        continue;
      }
      projectMap.set(projectId, {
        sourceProjectId: projectId,
        projectKind: "jobs",
        projectId: String(job.id),
        jobId: String(job.id),
        leadId: job.lead_id ? String(job.lead_id) : null,
        dealId: job.lead_id ? dealByLeadId.get(String(job.lead_id)) || null : null,
        evidence: "existing_job_companycam_project_id",
        persist: false,
        job,
      });
    }
  }

  if (conflicts.length) {
    throw new Error(`CompanyCam projects map to multiple jobs: ${[...new Set(conflicts)].join(", ")}`);
  }

  for (const lead of leads) {
    const metadata = asObject(lead.metadata);
    const metadataProjectIds = [
      metadata.companycam_project_id,
      ...(Array.isArray(metadata.companycam_project_ids) ? metadata.companycam_project_ids : []),
    ]
      .map(String)
      .filter((projectId) => COMPANYCAM_ID_PATTERN.test(projectId));
    for (const projectId of metadataProjectIds) {
      if (projectMap.has(projectId)) continue;
      const mapping = mappingForLead(lead, jobsByLeadId, "existing_lead_companycam_project_id");
      if (mapping) projectMap.set(projectId, { ...mapping, sourceProjectId: projectId, persist: false });
    }
  }

  return {
    projectMap,
    jobs,
    leads: leads.map((lead) => ({
      ...lead,
      contactName: contactById.get(String(lead.contact_id))?.name || null,
    })),
    leadsByDealId,
    jobsByLeadId,
  };
}

async function loadExistingSourceIds(supabaseUrl, serviceRoleKey) {
  const rows = await fetchSupabasePages(
    supabaseUrl,
    serviceRoleKey,
    "job_media?select=source_id&source_provider=eq.companycam&source_id=not.is.null",
  );
  return new Set(rows.map((row) => String(row.source_id)));
}

async function loadCompanyCamPhotos(apiKey) {
  const photosById = new Map();
  let after = "";
  for (let page = 1; ; page += 1) {
    const url = new URL(`${COMPANYCAM_API_BASE}/photos`);
    url.searchParams.set("per_page", String(COMPANYCAM_PAGE_SIZE));
    if (after) url.searchParams.set("after", after);
    const response = await fetchWithRetry(
      url,
      { headers: { accept: "application/json", Authorization: `Bearer ${apiKey}` } },
      `CompanyCam photos page ${page}`,
    );
    const payload = await requireJson(response, `CompanyCam photos page ${page}`);
    const pagePhotos = Array.isArray(payload) ? payload : payload?.photos || payload?.data || [];
    if (!Array.isArray(pagePhotos)) throw new Error("CompanyCam returned an invalid photo list.");
    for (const photo of pagePhotos) {
      const sourceId = String(photo?.id || "");
      if (sourceId && !photosById.has(sourceId)) photosById.set(sourceId, photo);
    }
    if (page % 10 === 0) console.log(`Indexed ${photosById.size} CompanyCam photos...`);
    const next = response.headers.get("x-next-cursor") || "";
    if (!pagePhotos.length || !next || next === after) break;
    after = next;
  }
  return [...photosById.values()];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeIdentity(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function projectNameKey(value) {
  return normalizeIdentity(
    String(value || "")
      .replace(/\s+-\s*20\d{2}-\d{2}-\d{2}T.*$/i, "")
      .replace(/\s+—\s+proposal\s+\d+.*$/i, ""),
  );
}

function streetKey(value) {
  return normalizeIdentity(String(value || "").split(",")[0]);
}

function addressesMatch(left, right) {
  const leftKey = streetKey(left);
  const rightKey = streetKey(right);
  if (leftKey.length < 8 || rightKey.length < 8) return false;
  return leftKey === rightKey || leftKey.startsWith(`${rightKey} `) || rightKey.startsWith(`${leftKey} `);
}

function mappingForLead(lead, jobsByLeadId, evidence) {
  const jobs = jobsByLeadId.get(String(lead.id)) || [];
  let job = null;
  if (jobs.length === 1) {
    [job] = jobs;
  } else if (jobs.length > 1) {
    const operational = jobs.filter(
      (candidate) =>
        candidate.is_feed_visible !== false &&
        ["scheduled", "active"].includes(String(candidate.status || "").toLowerCase()),
    );
    if (operational.length !== 1) return null;
    [job] = operational;
  }
  if (job) {
    return {
      projectKind: "jobs",
      projectId: String(job.id),
      jobId: String(job.id),
      leadId: String(lead.id),
      dealId: lead.dripjobs_deal_id || null,
      evidence,
      persist: true,
      job,
      lead,
    };
  }
  return {
    projectKind: "leads",
    projectId: String(lead.id),
    jobId: null,
    leadId: String(lead.id),
    dealId: lead.dripjobs_deal_id || null,
    evidence,
    persist: true,
    lead,
  };
}

function companyCamRelationIds(project) {
  return [
    project?.integration_relation_id,
    ...(Array.isArray(project?.integrations)
      ? project.integrations.map((integration) => integration?.relation_id)
      : []),
  ]
    .filter(Boolean)
    .map(String);
}

async function loadCompanyCamProject(apiKey, projectId) {
  const response = await fetchWithRetry(
    `${COMPANYCAM_API_BASE}/projects/${encodeURIComponent(projectId)}`,
    { headers: { accept: "application/json", Authorization: `Bearer ${apiKey}` } },
    `CompanyCam project ${projectId}`,
  );
  const payload = await requireJson(response, `CompanyCam project ${projectId}`);
  return payload?.project || payload?.data || payload;
}

async function inferProjectMappings(projectIds, mappingContext, apiKey) {
  const details = await runPool(projectIds, Math.min(DEFAULT_CONCURRENCY, 8), async (projectId) => ({
    projectId,
    project: await loadCompanyCamProject(apiKey, projectId),
  }));
  const inferred = [];
  const ambiguous = [];

  for (const detail of details) {
    const relationIds = companyCamRelationIds(detail.project);
    const relationLeads = [
      ...new Map(
        relationIds
          .flatMap((relationId) => mappingContext.leadsByDealId.get(relationId) || [])
          .map((lead) => [String(lead.id), lead]),
      ).values(),
    ];
    let lead = relationLeads.length === 1 ? relationLeads[0] : null;
    let evidence = lead ? "companycam_dripjobs_integration_relation_id" : null;

    if (!lead && relationLeads.length === 0) {
      const nameKey = projectNameKey(detail.project?.name);
      const projectAddress = detail.project?.address?.street_address_1 || "";
      const candidates = mappingContext.leads.filter((candidate) => {
        const nameMatches =
          nameKey.length >= 8 && projectNameKey(candidate.contactName) === nameKey;
        const addressMatches = addressesMatch(projectAddress, candidate.address);
        return nameMatches || addressMatches;
      });
      if (candidates.length === 1) {
        [lead] = candidates;
        const nameMatches = projectNameKey(lead.contactName) === nameKey;
        evidence = nameMatches && addressesMatch(projectAddress, lead.address)
          ? "unique_companycam_name_and_address"
          : nameMatches
            ? "unique_companycam_name"
            : "unique_companycam_address";
      }
    }

    const mapping = lead
      ? mappingForLead(lead, mappingContext.jobsByLeadId, evidence)
      : null;
    if (!mapping) {
      ambiguous.push({
        sourceProjectId: detail.projectId,
        name: toNullableText(detail.project?.name, 300),
        relationIds,
        reason: relationLeads.length > 1 ? "multiple_relation_leads" : "no_unique_project_target",
      });
      continue;
    }
    const completeMapping = { ...mapping, sourceProjectId: detail.projectId };
    mappingContext.projectMap.set(detail.projectId, completeMapping);
    inferred.push(completeMapping);
  }
  return { inferred, ambiguous };
}

function toNullableText(value, maxLength = 2000) {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value.trim() : JSON.stringify(value);
  return text ? text.slice(0, maxLength) : null;
}

function toCapturedAt(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function chooseSourceUrl(photo) {
  const uris = Array.isArray(photo?.uris) ? photo.uris : [];
  const preferred = ["original_annotation", "original", "web_annotation", "web"];
  for (const type of preferred) {
    const match = uris.find((item) => String(item?.type || "").toLowerCase() === type);
    const value = match?.uri || match?.url;
    if (value) return String(value);
  }
  return null;
}

function sniffMimeType(bytes, headerValue) {
  const header = String(headerValue || "").split(";")[0].trim().toLowerCase();
  if (MIME_TYPES[header]) return header;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
  if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
  if (["mif1", "msf1"].includes(brand)) return "image/heif";
  return null;
}

function runWrangler(args, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerPath, ...args], {
      cwd: workerDir,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-4000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`wrangler exited ${code}: ${(stderr || stdout).trim()}`));
    });
    if (input) {
      child.stdin.on("error", (error) => {
        if (error.code !== "EPIPE") reject(error);
      });
      child.stdin.end(input);
    }
  });
}

async function putR2Object(objectKey, bytes, mimeType) {
  await runWrangler([
    "r2", "object", "put", `${R2_BUCKET}/${objectKey}`,
    "--remote", "--pipe", "--content-type", mimeType,
    "--cache-control", "private, max-age=300", "--force",
  ], bytes);
}

async function deleteR2Object(objectKey) {
  await runWrangler([
    "r2", "object", "delete", `${R2_BUCKET}/${objectKey}`,
    "--remote", "--force",
  ]).catch(() => {});
}

async function sourceAlreadyExists(supabaseUrl, serviceRoleKey, sourceId) {
  const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/job_media`);
  url.searchParams.set("select", "id");
  url.searchParams.set("source_provider", "eq.companycam");
  url.searchParams.set("source_id", `eq.${sourceId}`);
  url.searchParams.set("limit", "1");
  const response = await fetchWithRetry(
    url,
    { headers: supabaseHeaders(serviceRoleKey) },
    `Supabase duplicate check ${sourceId}`,
  );
  const rows = await requireJson(response, `Supabase duplicate check ${sourceId}`);
  return Array.isArray(rows) && rows.length > 0;
}

async function insertMetadata(supabaseUrl, serviceRoleKey, row) {
  const response = await fetchWithRetry(
    `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/job_media`,
    {
      method: "POST",
      headers: supabaseHeaders(serviceRoleKey, {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify(row),
    },
    `Supabase metadata insert ${row.source_id}`,
  );
  if (response.status === 409) return { duplicate: true };
  const rows = await requireJson(response, `Supabase metadata insert ${row.source_id}`);
  if (!Array.isArray(rows) || rows[0]?.id !== row.id) {
    throw new Error(`Supabase did not return imported media ${row.id}.`);
  }
  return { duplicate: false };
}

async function patchSupabaseRow(supabaseUrl, serviceRoleKey, table, id, payload) {
  const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${table}`);
  url.searchParams.set("id", `eq.${id}`);
  const response = await fetchWithRetry(
    url,
    {
      method: "PATCH",
      headers: supabaseHeaders(serviceRoleKey, {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify(payload),
    },
    `Supabase ${table} mapping update ${id}`,
  );
  const rows = await requireJson(response, `Supabase ${table} mapping update ${id}`);
  if (!Array.isArray(rows) || rows.length !== 1 || String(rows[0]?.id) !== String(id)) {
    throw new Error(`Supabase did not return updated ${table} row ${id}.`);
  }
}

async function persistMapping(mapping, context) {
  if (!mapping.persist) return;
  if (mapping.projectKind === "jobs") {
    const projectIds = [
      ...(Array.isArray(mapping.job?.companycam_project_ids)
        ? mapping.job.companycam_project_ids.map(String)
        : []),
      mapping.sourceProjectId,
    ];
    const uniqueProjectIds = [...new Set(projectIds.filter((id) => COMPANYCAM_ID_PATTERN.test(id)))];
    await patchSupabaseRow(
      context.supabaseUrl,
      context.serviceRoleKey,
      "jobs",
      mapping.projectId,
      { companycam_project_ids: uniqueProjectIds },
    );
    mapping.job.companycam_project_ids = uniqueProjectIds;
  } else {
    const metadata = asObject(mapping.lead?.metadata);
    const projectIds = [
      metadata.companycam_project_id,
      ...(Array.isArray(metadata.companycam_project_ids)
        ? metadata.companycam_project_ids.map(String)
        : []),
      mapping.sourceProjectId,
    ]
      .filter(Boolean)
      .map(String);
    const uniqueProjectIds = [...new Set(projectIds.filter((id) => COMPANYCAM_ID_PATTERN.test(id)))];
    const nextMetadata = {
      ...metadata,
      companycam_project_id: metadata.companycam_project_id || mapping.sourceProjectId,
      companycam_project_ids: uniqueProjectIds,
    };
    await patchSupabaseRow(
      context.supabaseUrl,
      context.serviceRoleKey,
      "leads",
      mapping.projectId,
      { metadata: nextMetadata },
    );
    mapping.lead.metadata = nextMetadata;
  }
  mapping.persist = false;
}

async function importPhoto(task, context) {
  const sourceId = String(task.photo.id || "");
  const sourceProjectId = String(task.photo.project_id || "");
  if (!COMPANYCAM_ID_PATTERN.test(sourceId) || !COMPANYCAM_ID_PATTERN.test(sourceProjectId)) {
    throw new Error("Photo or project ID is invalid.");
  }
  const sourceUrl = chooseSourceUrl(task.photo);
  if (!sourceUrl) throw new Error("No usable CompanyCam image URL.");
  const parsedSourceUrl = new URL(sourceUrl);
  if (parsedSourceUrl.protocol !== "https:" || parsedSourceUrl.hostname !== "img.companycam.com") {
    throw new Error(`Unexpected CompanyCam image host: ${parsedSourceUrl.hostname}`);
  }

  const response = await fetchWithRetry(sourceUrl, {}, `CompanyCam image ${sourceId}`);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`CompanyCam image download failed (${response.status}): ${detail}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("CompanyCam returned an empty image.");
  if (buffer.length > MAX_SOURCE_BYTES) {
    throw new Error(`Image is larger than ${MAX_SOURCE_BYTES} bytes.`);
  }
  const mimeType = sniffMimeType(buffer, response.headers.get("content-type"));
  if (!mimeType) throw new Error(`Unsupported image type: ${response.headers.get("content-type") || "unknown"}`);

  const mediaId = randomUUID();
  const extension = MIME_TYPES[mimeType];
  const objectKey = `${task.mapping.projectKind}/${task.mapping.projectId}/${mediaId}.${extension}`;
  const metadata = {
    creator_name: toNullableText(task.photo.creator_name, 300),
    creator_id: toNullableText(task.photo.creator_id, 120),
    description: toNullableText(task.photo.description),
    hash: toNullableText(task.photo.hash, 200),
    internal: Boolean(task.photo.internal),
    photo_url: toNullableText(task.photo.photo_url, 1000),
    processing_status: toNullableText(task.photo.processing_status, 80),
    lead_id: task.mapping.leadId,
    dripjobs_deal_id: task.mapping.dealId,
    mapping_evidence: task.mapping.evidence,
  };

  let objectWritten = false;
  try {
    await putR2Object(objectKey, buffer, mimeType);
    objectWritten = true;
    const result = await insertMetadata(context.supabaseUrl, context.serviceRoleKey, {
      id: mediaId,
      job_id: task.mapping.projectKind === "jobs" ? task.mapping.projectId : null,
      lead_id: task.mapping.projectKind === "leads" ? task.mapping.projectId : null,
      object_key: objectKey,
      media_type: "image",
      mime_type: mimeType,
      original_filename: `companycam-${sourceId}.${extension}`,
      byte_size: buffer.length,
      width: null,
      height: null,
      duration_ms: null,
      captured_at: toCapturedAt(task.photo.captured_at || task.photo.created_at),
      uploaded_by: null,
      source_provider: "companycam",
      source_id: sourceId,
      source_project_id: sourceProjectId,
      source_metadata: metadata,
    });
    if (result.duplicate) {
      await deleteR2Object(objectKey);
      return { status: "skipped", bytes: 0 };
    }
    return { status: "imported", bytes: buffer.length };
  } catch (error) {
    if (await sourceAlreadyExists(context.supabaseUrl, context.serviceRoleKey, sourceId).catch(() => false)) {
      if (objectWritten) await deleteR2Object(objectKey);
      return { status: "skipped", bytes: 0 };
    }
    if (objectWritten) await deleteR2Object(objectKey);
    throw error;
  }
}

async function runPool(tasks, concurrency, worker) {
  let cursor = 0;
  const results = [];
  async function consume() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(tasks[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, consume));
  return results;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const companyCamApiKey = requireEnvironment("COMPANYCAM_API_KEY");
  const supabaseUrl = requireEnvironment("SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  if (!scriptPath.startsWith(appRoot)) throw new Error("Importer must run from the app repository.");

  const [mappingContext, existingSourceIds, photos] = await Promise.all([
    loadMappings(supabaseUrl, serviceRoleKey),
    loadExistingSourceIds(supabaseUrl, serviceRoleKey),
    loadCompanyCamPhotos(companyCamApiKey),
  ]);

  const projectIdsToInfer = [
    ...new Set(
      photos
        .map((photo) => String(photo?.project_id || ""))
        .filter(
          (projectId) =>
            COMPANYCAM_ID_PATTERN.test(projectId) && !mappingContext.projectMap.has(projectId),
        ),
    ),
  ];
  const inference = await inferProjectMappings(projectIdsToInfer, mappingContext, companyCamApiKey);
  const projectMap = mappingContext.projectMap;

  const matched = [];
  let unmatched = 0;
  let invalid = 0;
  for (const photo of photos) {
    const sourceId = String(photo?.id || "");
    const projectId = String(photo?.project_id || "");
    const mapping = projectMap.get(projectId);
    if (!mapping) {
      unmatched += 1;
      continue;
    }
    if (!COMPANYCAM_ID_PATTERN.test(sourceId) || !chooseSourceUrl(photo)) {
      invalid += 1;
      continue;
    }
    if (!existingSourceIds.has(sourceId)) matched.push({ photo, mapping });
  }

  const selected = options.limit === null ? matched : matched.slice(0, options.limit);
  console.log(JSON.stringify({
    mode: options.apply ? "apply" : "dry-run",
    companyCamPhotos: photos.length,
    mappedPhotos: photos.length - unmatched,
    alreadyImported: existingSourceIds.size,
    remainingMatchedPhotos: matched.length,
    selectedPhotos: selected.length,
    unmatchedPhotos: unmatched,
    invalidMappedPhotos: invalid,
    mappedCompanyCamProjects: projectMap.size,
    inferredCompanyCamProjects: inference.inferred.length,
    ambiguousCompanyCamProjects: inference.ambiguous,
    concurrency: options.concurrency,
  }, null, 2));

  if (!options.apply) {
    console.log("Dry run only. Re-run with --apply to copy the selected photos.");
    return;
  }
  if (!selected.length) {
    console.log("No matched CompanyCam photos remain to import.");
    return;
  }


  const selectedProjectIds = new Set(selected.map((task) => task.mapping.sourceProjectId));
  const mappingsToPersist = inference.inferred.filter(
    (mapping) => mapping.persist && selectedProjectIds.has(mapping.sourceProjectId),
  );
  if (mappingsToPersist.length) {
    console.log(`Persisting ${mappingsToPersist.length} verified CompanyCam project mappings...`);
    await runPool(mappingsToPersist, Math.min(options.concurrency, 4), (mapping) =>
      persistMapping(mapping, { supabaseUrl, serviceRoleKey }),
    );
  }

  const startedAt = Date.now();
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let uploadedBytes = 0;
  const failures = [];

  await runPool(selected, options.concurrency, async (task) => {
    const sourceId = String(task.photo.id);
    let result;
    try {
      result = await importPhoto(task, { supabaseUrl, serviceRoleKey });
      if (result.status === "imported") {
        imported += 1;
        uploadedBytes += result.bytes;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      if (failures.length < 50) failures.push({ sourceId, error: error.message });
    }
    const completed = imported + skipped + failed;
    if (completed % 25 === 0 || completed === selected.length) {
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      console.log(
        `Progress ${completed}/${selected.length}: imported=${imported}, skipped=${skipped}, failed=${failed}, ` +
        `MiB=${(uploadedBytes / 1024 / 1024).toFixed(1)}, rate=${(completed / elapsedSeconds).toFixed(2)}/s`,
      );
    }
    return result;
  });

  console.log(JSON.stringify({ imported, skipped, failed, uploadedBytes, failures }, null, 2));
  if (failed) process.exitCode = 1;
}

await main();
