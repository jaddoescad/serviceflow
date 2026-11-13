"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { staffRead, staffWrite, type ActionResult } from "./rpc";

// Settings › Integrations › AI lead agent: the MCP server's address and the
// keys an outside agent (Grok Bot, Claude, ...) connects with.

export type AgentKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type LeadAgentSettings = { serverUrl: string; keys: AgentKey[] };

function serverUrl() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
  return `${base}/functions/v1/lead-agent`;
}

/** Managers only; others get an error, which the page shows as nothing. */
export async function getLeadAgentSettings(): Promise<LeadAgentSettings> {
  const keys = await staffRead<AgentKey[]>("list_agent_keys");
  return { serverUrl: serverUrl(), keys };
}

/** A new key, returned once: only its hash is kept. */
export async function createAgentKey(name: string): Promise<ActionResult & { key?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_agent_key", { requested_name: name });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings", "layout");
  return { ok: true, key: (data as { key: string }).key };
}

export async function revokeAgentKey(id: string): Promise<ActionResult> {
  return staffWrite("revoke_agent_key", { requested_id: id }, ["/settings"]);
}
