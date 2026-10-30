"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { callEdge } from "@/lib/actions/edge";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/types";

export type ActionResult = { ok: boolean; error?: string };

function done(): ActionResult {
  revalidatePath("/employees");
  revalidatePath("/");
  return { ok: true };
}

export async function setPayRate(input: {
  userId: string;
  hourlyRate: number;
  effectiveFrom: string;
  notes?: string | null;
}): Promise<ActionResult> {
  await requireStaff();
  if (!Number.isFinite(input.hourlyRate) || input.hourlyRate <= 0) {
    return { ok: false, error: "Enter an hourly rate greater than zero." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    return { ok: false, error: "Choose a valid effective date." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("employee_pay_rates").upsert(
    {
      id: crypto.randomUUID(),
      employee_id: input.userId,
      hourly_rate_cents: Math.round(input.hourlyRate * 100),
      effective_from: input.effectiveFrom,
      notes: input.notes?.trim() || null,
    },
    { onConflict: "employee_id,effective_from" },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/employees");
  revalidatePath("/jobs");
  revalidatePath("/");
  return { ok: true };
}

function fail(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Request failed",
  };
}

export async function createEmployee(input: {
  email: string;
  fullName: string;
  password?: string;
  role?: Role;
}): Promise<ActionResult & { temporaryPassword?: string | null }> {
  await requireStaff();
  try {
    const res = await callEdge<{ temporaryPassword?: string | null }>(
      "project-assignments",
      {
        action: "createEmployee",
        email: input.email,
        fullName: input.fullName,
        full_name: input.fullName,
        password: input.password || undefined,
        role: input.role,
      },
    );
    return { ...done(), temporaryPassword: res?.temporaryPassword ?? null };
  } catch (e) {
    return fail(e);
  }
}

export async function setRole(
  userId: string,
  role: Role,
): Promise<ActionResult> {
  await requireStaff();
  try {
    await callEdge("project-assignments", {
      action: "setRole",
      userId,
      user_id: userId,
      role,
    });
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function setActive(
  userId: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireStaff();
  try {
    await callEdge("project-assignments", {
      action: "setActive",
      userId,
      user_id: userId,
      isActive,
      is_active: isActive,
    });
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function editTeamProfile(input: {
  userId: string;
  fullName: string;
  phone: string;
  jobTitle: string;
  expectedUpdatedAt: string;
}): Promise<ActionResult> {
  const actor = await requireStaff();
  if (actor.role !== "admin")
    return { ok: false, error: "Admin access required." };
  const client = await createClient();
  const { error } = await client.rpc("edit_team_profile", {
    requested_user: input.userId,
    requested_name: input.fullName,
    requested_phone: input.phone,
    requested_job_title: input.jobTitle,
    expected_updated_at: input.expectedUpdatedAt,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/employees/${input.userId}`);
  return done();
}
