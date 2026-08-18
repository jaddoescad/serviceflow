"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ProjectProfileActionResult = { ok: boolean; error?: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value: string): string {
  return value.trim();
}

function invalidLength(value: string, max: number): boolean {
  return value.trim().length > max;
}

function revalidateProject(projectId: string) {
  revalidatePath(`/jobs/${projectId}`);
  revalidatePath("/jobs");
  revalidatePath("/leads");
}

async function saveProjectSection(
  projectId: string,
  section: "contact" | "description" | "notes",
  values: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    customerNotes?: string;
    description?: string;
    projectNotes?: string;
  },
): Promise<ProjectProfileActionResult> {
  if (!UUID_PATTERN.test(projectId)) return { ok: false, error: "Project not found." };

  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_project_profile", {
    requested_project_id: projectId,
    requested_section: section,
    requested_name: values.name == null ? null : clean(values.name),
    requested_email: values.email == null ? null : clean(values.email),
    requested_phone: values.phone == null ? null : clean(values.phone),
    requested_address: values.address == null ? null : clean(values.address),
    requested_customer_notes:
      values.customerNotes == null ? null : clean(values.customerNotes),
    requested_description:
      values.description == null ? null : clean(values.description),
    requested_project_notes:
      values.projectNotes == null ? null : clean(values.projectNotes),
  });

  if (error) return { ok: false, error: error.message };
  revalidateProject(projectId);
  return { ok: true };
}

export async function updateProjectContact(input: {
  projectId: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  customerNotes: string;
}): Promise<ProjectProfileActionResult> {
  if (!input.name.trim()) return { ok: false, error: "Enter a contact name." };
  if (invalidLength(input.name, 160)) return { ok: false, error: "Contact name is too long." };
  if (invalidLength(input.email, 320)) return { ok: false, error: "Email is too long." };
  if (invalidLength(input.phone, 60)) return { ok: false, error: "Phone number is too long." };
  if (invalidLength(input.address, 500)) return { ok: false, error: "Address is too long." };
  if (invalidLength(input.customerNotes, 10_000)) {
    return { ok: false, error: "Customer notes are too long." };
  }
  return saveProjectSection(input.projectId, "contact", input);
}

export async function updateProjectDescription(input: {
  projectId: string;
  description: string;
}): Promise<ProjectProfileActionResult> {
  if (invalidLength(input.description, 20_000)) {
    return { ok: false, error: "Description is too long." };
  }
  return saveProjectSection(input.projectId, "description", input);
}

export async function updateProjectNotes(input: {
  projectId: string;
  projectNotes: string;
}): Promise<ProjectProfileActionResult> {
  if (invalidLength(input.projectNotes, 20_000)) {
    return { ok: false, error: "Notes are too long." };
  }
  return saveProjectSection(input.projectId, "notes", input);
}
