import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const MAX_BODY_BYTES = 128 * 1024;
const SUPPORTED_EVENT_TYPES = new Set(["lead.created", "proposal.accepted"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type EventBody = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("DRIPJOBS_ZAPIER_WEBHOOK_SECRET") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "DripJobs ingestion is not configured" }, 500);
  }

  const token = (req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token || !timingSafeEqual(token, webhookSecret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const contentLength = Number(req.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: "Request body is too large" }, 413);
  }

  let rawBody = "";
  let body: EventBody;
  try {
    rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
      return json({ error: "Request body is too large" }, 413);
    }
    body = JSON.parse(rawBody) as EventBody;
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }

  let normalized: ReturnType<typeof normalizeEvent>;
  try {
    normalized = normalizeEvent(body);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Invalid request",
    }, 400);
  }

  const payloadSha256 = await sha256(rawBody);
  const eventKey = normalized.isTest
    ? `${normalized.eventType}:${normalized.entityId}:test:${
      payloadSha256.slice(0, 16)
    }`
    : `${normalized.eventType}:${normalized.entityId}`;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("process_dripjobs_zapier_event", {
    p_event_key: eventKey,
    p_event_type: normalized.eventType,
    p_entity_id: normalized.entityId,
    p_occurred_at: normalized.occurredAt,
    p_payload: body,
    p_payload_sha256: payloadSha256,
    p_data: normalized.data,
    p_is_test: normalized.isTest,
  });

  if (error) {
    console.error("DripJobs event processing failed", {
      eventType: normalized.eventType,
      code: error.code || "unknown",
    });
    return json({ error: "DripJobs event processing failed" }, 500);
  }

  if (data?.status === "failed" || data?.ok === false) {
    console.error("DripJobs event processing failed", {
      eventType: normalized.eventType,
      code: data?.error_code || "processing_failed",
    });
    return json({ error: "DripJobs event processing failed" }, 500);
  }

  return json(data ?? { ok: true, status: "processed" });
});

function normalizeEvent(body: EventBody) {
  const version = Number(body.version ?? 1);
  if (version !== 1) throw new Error("Unsupported event version");
  const eventType = requiredText(body.event_type, "event_type", 80);
  if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
    throw new Error("Unsupported event_type");
  }
  const isTest = toBoolean(body.is_test ?? body.test);

  if (eventType === "lead.created") {
    const dealId = requiredText(body.deal_id, "deal_id", 200);
    const createdAt = isoTimestamp(
      body.created_at ?? body.occurred_at,
      "created_at",
    );
    return {
      eventType,
      entityId: dealId,
      occurredAt: createdAt,
      isTest,
      data: {
        deal_id: dealId,
        contact_uuid: optionalText(body.contact_uuid ?? body.contact_id, 200),
        created_at: createdAt,
        contact_name: contactName(body),
        email: optionalText(body.email, 320),
        phone: optionalText(body.phone, 80),
        lead_source: optionalText(body.lead_source, 300),
        address: fullAddress(body),
        postal_code: optionalText(body.postal_code ?? body.zip, 40),
      },
    };
  }

  const proposalId = requiredText(body.proposal_id, "proposal_id", 200);
  const acceptedAt = isoTimestamp(
    body.accepted_at ?? body.occurred_at,
    "accepted_at",
  );
  return {
    eventType,
    entityId: proposalId,
    occurredAt: acceptedAt,
    isTest,
    data: {
      proposal_id: proposalId,
      deal_id: optionalText(body.deal_id, 200),
      contact_uuid: optionalText(body.contact_uuid ?? body.contact_id, 200),
      accepted_at: acceptedAt,
      contact_name: contactName(body),
      email: optionalText(body.email, 320),
      phone: optionalText(body.phone, 80),
      job_name: optionalText(body.job_name ?? body.deal_name, 500),
      status: optionalText(body.status, 200),
      label: optionalText(body.label, 300),
      deal_stage: optionalText(body.deal_stage, 300),
      salesperson: optionalText(body.salesperson, 300),
      amount: nonnegativeMoney(body.amount ?? body.proposal_amount),
      street_address_1: optionalText(
        body.street_address_1 ?? body.job_address,
        500,
      ),
      address: fullAddress(body),
      city: optionalText(body.city ?? body.job_city, 200),
      state: optionalText(body.state ?? body.province ?? body.job_state, 100),
      postal_code: optionalText(
        body.postal_code ?? body.zip ?? body.job_zip,
        40,
      ),
      country: optionalText(body.country, 100),
    },
  };
}

function contactName(body: EventBody) {
  const direct = optionalText(body.contact_name ?? body.name, 500);
  if (direct) return direct;
  return [optionalText(body.first_name, 200), optionalText(body.last_name, 200)]
    .filter(Boolean)
    .join(" ") || null;
}

function fullAddress(body: EventBody) {
  const direct = optionalText(body.address ?? body.formatted_address, 1000);
  if (direct) return direct;
  return [
    optionalText(body.street_address_1 ?? body.job_address, 500),
    optionalText(body.city ?? body.job_city, 200),
    optionalText(body.state ?? body.province ?? body.job_state, 100),
    optionalText(body.postal_code ?? body.zip ?? body.job_zip, 40),
  ].filter(Boolean).join(", ") || null;
}

function requiredText(value: unknown, field: string, maxLength: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${field}`);
  if (text.length > maxLength) throw new Error(`${field} is too long`);
  return text;
}

function optionalText(value: unknown, maxLength: number) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > maxLength) throw new Error("A text field is too long");
  return text;
}

function isoTimestamp(value: unknown, field: string) {
  const text = requiredText(value, field, 100);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${field}`);
  return date.toISOString();
}

function nonnegativeMoney(value: unknown) {
  const normalized = String(value ?? "")
    .replaceAll("$", "")
    .replaceAll(",", "")
    .trim();
  if (!normalized) return 0;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid amount");
  return Math.round(amount * 100) / 100;
}

function toBoolean(value: unknown) {
  return value === true || ["true", "1", "yes"].includes(
    String(value ?? "").toLowerCase(),
  );
}

function timingSafeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index] ^ rightBytes[index];
  }
  return mismatch === 0;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
