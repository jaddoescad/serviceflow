"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import type { QuoLine } from "@/lib/messaging-types";
import { callEdge } from "./edge";
import type { ActionResult } from "./rpc";

// Connecting Quo goes through the quo edge function, which checks the caller
// manages the company. The saved API key never comes back to the browser.

async function quo<T>(body: Record<string, unknown>): Promise<ActionResult & { data?: T }> {
  await requireStaff();
  try {
    return { ok: true, data: await callEdge<T>("quo", body) };
  } catch (reason) {
    return { ok: false, error: reason instanceof Error ? reason.message : "Could not reach Quo." };
  }
}

function refresh() {
  for (const path of ["/settings", "/inbox", "/drips"]) revalidatePath(path, "layout");
}

/** The numbers this API key can text from. */
export async function listQuoLines(apiKey: string): Promise<ActionResult & { lines?: QuoLine[] }> {
  const result = await quo<{ lines: QuoLine[] }>({ action: "lines", apiKey });
  return result.ok ? { ok: true, lines: result.data?.lines ?? [] } : { ok: false, error: result.error };
}

/** Saves the key and number, adds ServiceFlow's webhooks in Quo and starts importing the number's texts and calls. */
export async function connectQuo(input: { apiKey: string; phoneNumberId: string }): Promise<ActionResult> {
  const result = await quo({ action: "connect", ...input });
  if (result.ok) refresh();
  return { ok: result.ok, error: result.error };
}

/** Fetches texts sent since the last import finished (or the whole number again after a failed one). */
export async function syncQuo(): Promise<ActionResult> {
  const result = await quo({ action: "sync" });
  if (result.ok) refresh();
  return { ok: result.ok, error: result.error };
}

/** Removes the webhooks from Quo and forgets the key; imported texts and calls stay in the inbox. */
export async function disconnectQuo(): Promise<ActionResult> {
  const result = await quo({ action: "disconnect" });
  if (result.ok) refresh();
  return { ok: result.ok, error: result.error };
}

/** A fresh link to a call's recording, or a missed call's voicemail and its transcript. */
export async function getCallAudio(callId: string): Promise<ActionResult & { url?: string | null; transcript?: string | null }> {
  const result = await quo<{ url: string | null; transcript?: string | null }>({ action: "call-audio", callId });
  return result.ok
    ? { ok: true, url: result.data?.url ?? null, transcript: result.data?.transcript ?? null }
    : { ok: false, error: result.error };
}
