import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ServiceClient = SupabaseClient;

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPT_URL = "https://exp.host/--/api/v2/push/getReceipts";
const BATCH_SIZE = 100;
const REMINDERS = {
  clock_in: {
    title: "Don't forget to clock in",
    body: "Clock in before you start work today.",
    dataType: "daily_clock_in_reminder",
  },
  clock_out: {
    title: "Don't forget to clock out",
    body: "Clock out before you leave for the day.",
    dataType: "daily_clock_out_reminder",
  },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CLOCK_IN_REMINDER_CRON_SECRET");

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing Supabase service environment" }, 500);
  }

  if (!cronSecret) return json({ error: "Missing CLOCK_IN_REMINDER_CRON_SECRET" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token !== cronSecret) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const requestBody = await req.json().catch(() => ({}));
    const reminder = getReminder(requestBody?.reminder_type);
    const tokens = await fetchActiveTokens(supabase);
    let sent = 0;
    const receiptTickets: { id: string; token: string }[] = [];
    const failedTokens: string[] = [];

    for (const batch of chunkRows(tokens, BATCH_SIZE)) {
      const messages = batch.map((row) => ({
        to: row.expo_push_token,
        sound: "default",
        title: reminder.title,
        body: reminder.body,
        data: { type: reminder.dataType },
      }));

      const tickets = await sendExpoBatch(messages);
      tickets.forEach((ticket, index) => {
        const token = batch[index]?.expo_push_token;
        if (ticket?.status === "ok" && ticket.id && token) {
          receiptTickets.push({ id: ticket.id, token });
          sent += 1;
        } else if (token && isExpoDeviceError(ticket?.details?.error)) {
          failedTokens.push(token);
        }
      });
    }

    const receiptFailures = await collectReceiptFailures(receiptTickets);
    failedTokens.push(...receiptFailures);

    const deactivated = await deactivateTokens(
      supabase,
      Array.from(new Set(failedTokens)),
    );

    return json({
      tokens: tokens.length,
      sent,
      deactivated,
      receiptsChecked: receiptTickets.length,
      reminderType: reminder.dataType,
    });
  } catch (error) {
    return json({ error: error?.message || "Daily reminder send failed" }, 500);
  }
});

function getReminder(value: unknown) {
  return value === "clock_out" ? REMINDERS.clock_out : REMINDERS.clock_in;
}

async function fetchActiveTokens(supabase: ServiceClient) {
  const { data, error } = await supabase
    .from("push_tokens")
    .select("expo_push_token,employee_id,platform")
    .eq("is_active", true)
    .order("last_registered_at", { ascending: false });

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  return (data || []).filter((row) => {
    const token = String(row.expo_push_token || "");
    if (!token || seen.has(token)) return false;
    seen.add(token);
    return true;
  });
}

async function sendExpoBatch(messages: Record<string, unknown>[]) {
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Expo push returned ${response.status}: ${JSON.stringify(payload)}`);
  }

  return Array.isArray(payload?.data) ? payload.data : [];
}

async function collectReceiptFailures(receiptTickets: { id: string; token: string }[]) {
  const failedTokens: string[] = [];
  const tokenByReceiptId = new Map<string, string>();
  const receiptIds = receiptTickets.map((ticket) => ticket.id);

  receiptTickets.forEach((ticket) => {
    tokenByReceiptId.set(ticket.id, ticket.token);
  });

  for (const receiptBatch of chunkRows(receiptIds, BATCH_SIZE)) {
    const response = await fetch(EXPO_RECEIPT_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: receiptBatch }),
    });

    if (!response.ok) continue;
    const payload = await response.json().catch(() => ({}));
    const receipts = payload?.data || {};

    for (const [receiptId, receipt] of Object.entries(receipts)) {
      const errorName = (receipt as Record<string, any>)?.details?.error;
      const token = tokenByReceiptId.get(receiptId);
      if (token && isExpoDeviceError(errorName)) failedTokens.push(token);
    }
  }

  return failedTokens;
}

async function deactivateTokens(supabase: ServiceClient, tokens: string[]) {
  if (!tokens.length) return 0;

  const { error } = await supabase
    .from("push_tokens")
    .update({ is_active: false })
    .in("expo_push_token", tokens);

  if (error) throw new Error(error.message);
  return tokens.length;
}

function isExpoDeviceError(errorName: unknown) {
  return errorName === "DeviceNotRegistered";
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}
