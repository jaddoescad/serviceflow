"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { callEdge } from "@/lib/actions/edge";

export type ActionResult = { ok: boolean; error?: string };

function ok(): ActionResult {
  revalidatePath("/timesheets");
  revalidatePath("/jobs");
  revalidatePath("/");
  return { ok: true };
}

function fail(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : "Request failed" };
}

export async function updateEntry(input: {
  id: string;
  startedAt?: string;
  endedAt?: string | null;
  notes?: string | null;
}): Promise<ActionResult> {
  await requireStaff();
  try {
    await callEdge("admin-time-entries", { action: "updateEntry", ...input });
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function clockOutEntry(input: {
  id: string;
  endedAt: string;
  notes?: string | null;
}): Promise<ActionResult> {
  await requireStaff();
  const endedAt = new Date(input.endedAt);
  if (Number.isNaN(endedAt.getTime())) return fail(new Error("Choose a valid clock-out time"));

  try {
    await callEdge("admin-time-entries", {
      action: "updateEntry",
      id: input.id,
      endedAt: endedAt.toISOString(),
      notes: input.notes,
    });
    return ok();
  } catch (e) {
    return fail(e);
  }
}

export async function deleteEntry(id: string): Promise<ActionResult> {
  await requireStaff();
  try {
    await callEdge("admin-time-entries", { action: "deleteEntry", id });
    return ok();
  } catch (e) {
    return fail(e);
  }
}
