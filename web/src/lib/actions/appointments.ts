"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AppointmentKind, AppointmentStatus } from "@/lib/appointment-types";

export async function saveAppointment(input: {
  id: string;
  projectId: string;
  title: string;
  kind: AppointmentKind;
  startsAt: string;
  endsAt: string;
  assignedTo: string | null;
  location: string;
  notes: string;
  status: AppointmentStatus;
  /** Queue the customer's confirmation, when booking or moving it. */
  notify: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_appointment", {
    requested_id: input.id,
    requested_project: input.projectId,
    requested_title: input.title,
    requested_starts_at: input.startsAt,
    requested_ends_at: input.endsAt,
    requested_assigned_to: input.assignedTo,
    requested_location: input.location,
    requested_notes: input.notes,
    requested_status: input.status,
    requested_kind: input.kind,
    requested_notify: input.notify,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/appointments");
  revalidatePath("/pipeline", "layout");
  return { ok: true };
}
