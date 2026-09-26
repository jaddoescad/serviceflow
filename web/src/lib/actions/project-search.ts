"use server";

import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function searchProjects(query: string) {
  await requireMember();
  const term = query.trim().slice(0, 200);
  if (!term) return [];
  const client = await createClient();
  const { data, error } = await client
    .from("project_directory")
    .select("id,name,address")
    .is("trashed_at", null)
    .is("archived_at", null)
    .ilike("name", `%${term.replace(/[\\%_]/g, "\\$&")}%`)
    .order("updated_at", { ascending: false })
    .order("id")
    .limit(8);
  if (error) throw new Error("Could not search projects.");
  return data as { id: string; name: string; address: string | null }[];
}
