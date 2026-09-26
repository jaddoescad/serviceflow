"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function changeProjectLifecycle(
  id: string,
  action: "archive" | "unarchive" | "trash" | "restore",
) {
  await requireStaff();
  const client = await createClient();
  const { error } = await client.rpc("set_project_lifecycle", {
    requested_id: id,
    requested_action: action,
  });
  if (error) return { error: error.message };
  revalidatePath("/projects");
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/photos");
  return {};
}
export type ProjectEdit = {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  description: string;
  notes: string;
  labels: string[];
};
export async function saveWorkspaceProject(input: ProjectEdit) {
  await requireStaff();
  if (!input.name.trim() || !input.contactName.trim())
    return { error: "Project and contact names are required." };
  if (
    input.name.length > 200 ||
    input.contactName.length > 160 ||
    input.email.length > 320 ||
    input.phone.length > 60 ||
    input.address.length > 500 ||
    input.description.length > 10000 ||
    input.notes.length > 10000 ||
    input.labels.length > 30
  )
    return { error: "One or more fields exceed their length limit." };
  const client = await createClient();
  const { error } = await client.rpc("save_workspace_project", {
    requested_id: input.id,
    requested_name: input.name,
    requested_contact_name: input.contactName,
    requested_email: input.email,
    requested_phone: input.phone,
    requested_address: input.address,
    requested_description: input.description,
    requested_notes: input.notes,
    requested_labels: input.labels,
  });
  if (error) return { error: error.message };
  for (const path of ["/projects", `/jobs/${input.id}`, "/contacts", "/photos"])
    revalidatePath(path);
  return {};
}
export async function saveProjectLabel(input: {
  id?: string;
  name: string;
  color: string;
}) {
  await requireStaff();
  if (
    !input.name.trim() ||
    input.name.trim().length > 60 ||
    !/^#[0-9a-f]{6}$/i.test(input.color)
  )
    return { error: "Enter a label name and color." };
  const client = await createClient();
  const values = { name: input.name.trim(), color: input.color };
  const query = input.id
    ? client.from("project_labels").update(values).eq("id", input.id)
    : client.from("project_labels").insert(values);
  const { data, error } = await query
    .select("id,name,color,updated_at")
    .single();
  if (error)
    return {
      error:
        error.code === "23505"
          ? "That label already exists."
          : "Could not save label.",
    };
  revalidatePath("/", "layout");
  return { label: data };
}

export async function findProjectContacts(query: string) {
  await requireStaff();
  const client = await createClient();
  const { data, error } = await client
    .from("contacts")
    .select("id,name,email")
    .ilike(
      "name",
      `%${query
        .trim()
        .slice(0, 120)
        .replace(/[\\%_]/g, "\\$&")}%`,
    )
    .order("name")
    .limit(20);
  if (error) throw new Error("Could not find contacts.");
  return data ?? [];
}

export async function createWorkspaceProject(input: {
  id: string;
  name: string;
  contactId: string;
  address: string;
}) {
  await requireStaff();
  if (!input.contactId || !input.name.trim())
    return { error: "Choose a contact and enter a project name." };
  const client = await createClient();
  const { data, error } = await client.rpc("create_workspace_project", {
    requested_id: input.id,
    requested_name: input.name,
    requested_contact: input.contactId,
    requested_address: input.address,
  });
  if (error) return { error: error.message };
  revalidatePath("/projects");
  return { id: data as string };
}

export async function setProjectLabels(id: string, labels: string[]) {
  await requireStaff();
  const client = await createClient();
  const { error } = await client.rpc("set_project_labels", {
    requested_id: id,
    requested_labels: labels,
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {};
}

export async function deleteProjectLabel(id: string) {
  await requireStaff();
  const client = await createClient();
  const { error } = await client.from("project_labels").delete().eq("id", id);
  if (error) return { error: "Could not delete label." };
  revalidatePath("/", "layout");
  return {};
}
